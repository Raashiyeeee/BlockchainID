import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import axios from 'axios';
import BlockIDContract from '../../../artifacts/contracts/BlockID.sol/BlockID.json';

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;
const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';

/**
 * Upload metadata JSON to IPFS via Pinata
 */
async function uploadMetadataToIPFS(metadata) {
    try {
        const response = await axios.post(
            'https://api.pinata.cloud/pinning/pinJSONToIPFS',
            JSON.stringify(metadata),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'pinata_api_key': PINATA_API_KEY,
                    'pinata_secret_api_key': PINATA_API_SECRET,
                },
            }
        );
        const ipfsHash = response.data.IpfsHash;
        return { ipfsHash, ipfsUrl: `${IPFS_GATEWAY}${ipfsHash}` };
    } catch (error) {
        console.error('IPFS upload error:', error?.response?.data || error.message);
        throw new Error('Failed to upload metadata to IPFS: ' + (error?.response?.data?.error?.details || error.message));
    }
}

/**
 * POST /api/mint-id
 * Body: { walletAddress, fullName, email, dateOfBirth, photoUrl, idNumber, expiryDate, age }
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { walletAddress, fullName, email, dateOfBirth, photoUrl, idNumber, expiryDate, age } = body;

        // --- Validate required fields ---
        if (!walletAddress || !fullName || !email) {
            return NextResponse.json({ error: 'Missing required fields: walletAddress, fullName, email' }, { status: 400 });
        }

        if (!PRIVATE_KEY || !CONTRACT_ADDRESS || !RPC_URL) {
            return NextResponse.json({ error: 'Server misconfiguration: missing env vars' }, { status: 500 });
        }

        // --- Set up provider and admin signer ---
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const adminWallet = new ethers.Wallet(PRIVATE_KEY, provider);

        // Verify contract exists
        const code = await provider.getCode(CONTRACT_ADDRESS);
        if (code === '0x' || code === '0x0') {
            return NextResponse.json({ error: `No contract found at ${CONTRACT_ADDRESS}` }, { status: 500 });
        }

        const contract = new ethers.Contract(CONTRACT_ADDRESS, BlockIDContract.abi, adminWallet);

        // --- Enforce 1-mint-per-wallet ---
        const alreadyHasId = await contract.hasIdentity(walletAddress);
        if (alreadyHasId) {
            // Fetch existing ID number to return to client
            const existingIdNumber = await contract.getIdentityByOwner(walletAddress);
            return NextResponse.json(
                { error: 'ALREADY_MINTED', idNumber: existingIdNumber.toString() },
                { status: 409 }
            );
        }

        // --- Check admin balance (need at least 0.001 Sepolia ETH for gas) ---
        const balance = await provider.getBalance(adminWallet.address);
        const MIN_BALANCE = ethers.parseEther('0.001');
        if (balance < MIN_BALANCE) {
            const balanceEth = ethers.formatEther(balance);
            return NextResponse.json({
                error: `Admin wallet has insufficient Sepolia ETH for gas. Current balance: ${balanceEth} ETH. Please top up the admin wallet (${adminWallet.address}) with Sepolia ETH from a faucet: https://sepoliafaucet.com or https://faucets.chain.link/sepolia`
            }, { status: 503 });
        }

        // --- Build unique identity hash ---
        const uniqueString = `${fullName}|${email}|${dateOfBirth || ''}|${walletAddress}`;
        const uniqueHash = ethers.keccak256(ethers.toUtf8Bytes(uniqueString));

        // Ensure hash not already registered
        const hashRegistered = await contract.isHashRegistered(uniqueHash);
        if (hashRegistered) {
            return NextResponse.json({ error: 'Identity hash already registered. Modify your details.' }, { status: 409 });
        }

        // --- Upload metadata to IPFS ---
        const metadata = {
            name: `BlockID - ${fullName}`,
            description: 'Blockchain-based Digital Identity Card on Sepolia',
            image: photoUrl || '',
            attributes: [
                { trait_type: 'Full Name', value: fullName },
                { trait_type: 'Email', value: email },
                { trait_type: 'Date of Birth', value: dateOfBirth || 'N/A' },
                { trait_type: 'Age', value: age ? age.toString() : 'N/A' },
                { trait_type: 'ID Number', value: idNumber || `BID-${Date.now()}` },
                { trait_type: 'Expiry Date', value: expiryDate || '' },
                { trait_type: 'Wallet Address', value: walletAddress },
                { trait_type: 'Network', value: 'Sepolia Testnet' },
                { trait_type: 'Issue Date', value: new Date().toISOString() },
                { trait_type: 'Verified', value: 'true' },
            ],
            // Store raw field data for easy retrieval
            fullName,
            email,
            dateOfBirth: dateOfBirth || '',
            age: age || null,
            idNumber: idNumber || `BID-${Date.now()}`,
            expiryDate: expiryDate || new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
            photoUrl: photoUrl || '',
            walletAddress,
            isMinted: true,
            dateOfIssue: new Date().toISOString(),
            organization: 'Sepolia Network Authority',
            role: 'Personal ID',
        };

        let ipfsHash, ipfsUrl;
        try {
            ({ ipfsHash, ipfsUrl } = await uploadMetadataToIPFS(metadata));
            console.log('Metadata uploaded to IPFS:', ipfsHash);
        } catch (ipfsError) {
            return NextResponse.json({ error: ipfsError.message }, { status: 502 });
        }

        // --- Call createIdentity on-chain (admin only) ---
        const expiryDuration = 10 * 365 * 24 * 60 * 60; // 10 years in seconds
        const idType = 'personal_id';

        console.log(`Minting ID for ${walletAddress} with IPFS hash ${ipfsHash}`);

        const tx = await contract.createIdentity(
            walletAddress,
            ipfsHash,
            expiryDuration,
            idType,
            uniqueHash,
            { gasLimit: 500000 }
        );

        console.log('Transaction sent:', tx.hash);

        // Wait for confirmation (1 block)
        const receipt = await tx.wait(1);
        console.log('Transaction confirmed in block:', receipt.blockNumber);

        // Extract ID number from IdentityCreated event
        let mintedIdNumber = null;
        try {
            const iface = new ethers.Interface(BlockIDContract.abi);
            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog(log);
                    if (parsed && parsed.name === 'IdentityCreated') {
                        mintedIdNumber = parsed.args.idNumber.toString();
                        break;
                    }
                } catch (_) { /* skip unparseable logs */ }
            }
        } catch (eventError) {
            console.warn('Could not parse IdentityCreated event:', eventError.message);
        }

        // Fallback: query contract directly
        if (!mintedIdNumber) {
            const onChainId = await contract.getIdentityByOwner(walletAddress);
            mintedIdNumber = onChainId.toString();
        }

        const finalIdNumber = `BID-${mintedIdNumber.padStart(6, '0')}`;

        return NextResponse.json({
            success: true,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            idNumber: finalIdNumber,
            uniqueHash,
            ipfsHash,
            ipfsUrl,
            // Return the full metadata so frontend can save it directly
            cardData: {
                ...metadata,
                idNumber: finalIdNumber,
                blockchainTxnHash: tx.hash,
                uniqueIdentityHash: uniqueHash,
            },
        });
    } catch (error) {
        console.error('Mint API error:', error);

        let userMessage = error.message || 'Unknown server error';
        if (userMessage.includes('user rejected') || userMessage.includes('ACTION_REJECTED')) {
            userMessage = 'Transaction was rejected.';
        } else if (userMessage.includes('insufficient funds')) {
            userMessage = `Admin wallet has insufficient Sepolia ETH for gas fees. Please top up the admin wallet with Sepolia ETH from https://sepoliafaucet.com or https://faucets.chain.link/sepolia (free testnet ETH).`;
        } else if (userMessage.includes('already has an ID')) {
            userMessage = 'This wallet already has a minted ID card.';
        }

        return NextResponse.json({ error: userMessage }, { status: 500 });
    }
}
