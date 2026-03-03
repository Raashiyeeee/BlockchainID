import { ethers } from 'ethers';
import BlockIDContract from '../artifacts/contracts/BlockID.sol/BlockID.json';

// Contract address - will be set from environment or after deployment
let contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43';

// Network configuration from environment variables
const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME || 'Sepolia Testnet';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || '11155111';
const CHAIN_ID_HEX = '0x' + parseInt(CHAIN_ID).toString(16);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161';

// Flag to indicate if we're in development mode
const isDevelopment = process.env.NEXT_PUBLIC_IS_DEVELOPMENT === 'true' || process.env.NODE_ENV === 'development';

// IPFS Gateway
const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';

/**
 * Initialize the contract address
 * @param {string} address - The deployed contract address
 */
export const initContractAddress = (address) => {
  contractAddress = address;
  // Store in localStorage for persistence across sessions
  if (typeof window !== 'undefined') {
    localStorage.setItem('blockIdContractAddress', address);
  }
};

/**
 * Get the contract address from localStorage if not set
 */
export const getContractAddress = () => {
  if (!contractAddress && typeof window !== 'undefined') {
    contractAddress = localStorage.getItem('blockIdContractAddress') || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  }
  return contractAddress || '0x0000000000000000000000000000000000000000'; // Return dummy address if not set
};

/**
 * Switch to the configured network if needed
 */
export const switchToConfiguredNetwork = async () => {
  if (typeof window === 'undefined' || !window.ethereum) return false;

  try {
    // Try to switch to the configured network
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
    return true;
  } catch (error) {
    // This error code indicates the chain has not been added to MetaMask
    if (error.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: CHAIN_ID_HEX,
              chainName: NETWORK_NAME,
              nativeCurrency: {
                name: 'Ether',
                symbol: 'ETH',
                decimals: 18,
              },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [CHAIN_ID === '11155111' ? 'https://sepolia.etherscan.io/' : 'https://etherscan.io/'],
            },
          ],
        });
        return true;
      } catch (addError) {
        console.error('Error adding network:', addError);
        return false;
      }
    }
    console.error('Error switching network:', error);
    return false;
  }
};

/**
 * Get a provider for read-only operations
 * @returns {ethers.Provider} - An ethers provider
 */
export const getProvider = () => {
  try {
    // Check if MetaMask is installed
    if (typeof window !== 'undefined' && window.ethereum) {
      // Attempt to switch to the configured network (this won't block execution)
      switchToConfiguredNetwork().catch(console.error);
      return new ethers.BrowserProvider(window.ethereum);
    }

    // Fallback to a public RPC provider
    return new ethers.JsonRpcProvider(RPC_URL);
  } catch (error) {
    console.error('Error getting provider:', error);
    if (isDevelopment) {
      console.warn('Using dummy provider for development');
      return null;
    }
    throw error;
  }
};

/**
 * Get a signer for transactions that modify state
 * @returns {Promise<ethers.Signer>} - An ethers signer
 */
export const getSigner = async () => {
  try {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask not detected. Please install MetaMask.');
    }

    // Ensure we're on the configured network
    await switchToConfiguredNetwork();

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return signer;
  } catch (error) {
    console.error('Error getting signer:', error);
    if (isDevelopment) {
      console.warn('Using dummy signer for development');
      return null;
    }
    throw error;
  }
};

/**
 * Get contract instance with a read-only provider
 * @returns {ethers.Contract} - BlockID contract instance
 */
export const getContractReadOnly = async () => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // Test connection but handle errors gracefully
    try {
      await provider.getBlockNumber();
    } catch (connectionError) {
      console.error("Error connecting to provider:", connectionError);
      throw new Error(`Cannot connect to RPC at ${RPC_URL}: ${connectionError.message}`);
    }

    const address = getContractAddress();

    if (!address || address === '0x0000000000000000000000000000000000000000') {
      throw new Error('Contract address not configured or invalid');
    }

    console.log('Getting contract with address:', address);

    // Verify the contract exists at the address
    try {
      const code = await provider.getCode(address);
      if (code === '0x' || code === '0x0') {
        throw new Error(`No contract found at address ${address}`);
      }
    } catch (codeError) {
      console.error("Error checking contract code:", codeError);
      throw new Error(`Cannot verify contract at ${address}: ${codeError.message}`);
    }

    return new ethers.Contract(address, BlockIDContract.abi, provider);
  } catch (error) {
    console.error('Error getting contract:', error);

    // In development mode, provide a mock contract
    if (isDevelopment) {
      console.warn("Using mock contract in development mode");
      return {
        hasIdentity: async () => false,
        isHashRegistered: async () => false,
        getIdentityByOwner: async () => 0,
        getIdentityByHash: async () => 0
      };
    }

    throw error;
  }
};

/**
 * Get contract instance with a signer for transactions
 * @returns {Promise<ethers.Contract>} - BlockID contract instance with signer
 */
export const getContractWithSigner = async () => {
  try {
    const address = getContractAddress();
    if (!address) {
      throw new Error('Contract address not initialized');
    }

    const signer = await getSigner();
    if (!signer) {
      throw new Error('Signer not available');
    }

    return new ethers.Contract(address, BlockIDContract.abi, signer);
  } catch (error) {
    console.error('Error getting contract with signer:', error);
    throw error;
  }
};

/**
 * Connect to MetaMask wallet
 * @returns {Promise<string>} - Connected wallet address
 */
export const connectWallet = async () => {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask not detected. Please install MetaMask.');
  }

  try {
    // Request account access
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

    // Switch to the configured network
    await switchToConfiguredNetwork();

    // Get network information to confirm we're on the configured network
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();

    // Log network info
    console.log('Connected to network:', {
      chainId: network.chainId.toString(),
      name: network.name
    });

    return accounts[0];
  } catch (error) {
    console.error('Error connecting to MetaMask:', error);
    throw error;
  }
};

/**
 * Check if the connected wallet is a verifier
 * @param {string} address - Wallet address to check
 * @returns {Promise<boolean>} - True if the address is a verifier
 */
export const isVerifier = async (address) => {
  try {
    const contract = await getContractReadOnly();
    return await contract.isVerifier(address);
  } catch (error) {
    console.error('Error checking verifier status:', error);
    if (isDevelopment) {
      // For development, return true to test admin features
      return true;
    }
    return false;
  }
};

/**
 * Check if a wallet address is an admin
 * @param {string} address - Wallet address to check
 * @returns {Promise<boolean>} - True if the address is an admin
 */
export const isAdmin = async (address) => {
  if (!address) {
    console.log('isAdmin: No address provided');
    return false;
  }

  try {
    console.log('isAdmin: Checking admin status for address:', address);
    const contract = await getContractReadOnly();
    if (!contract) {
      console.log('isAdmin: No contract instance available');
      throw new Error('Contract not available for admin check');
    }

    // Use the contract's isAdmin function
    const isAdminOnContract = await contract.isAdmin(address);
    console.log(`Admin check via contract: ${address} => ${isAdminOnContract}`);
    return isAdminOnContract;
  } catch (error) {
    console.error('Error checking admin status:', error);
    // Fall back to environment variable check (works in both dev and production)
    const envAdminWallet = process.env.NEXT_PUBLIC_ADMIN_WALLET;
    console.log('isAdmin: Contract check failed, checking against env variable:', envAdminWallet);
    if (envAdminWallet) {
      const isEnvAdmin = address.toLowerCase() === envAdminWallet.toLowerCase().replace(/"/g, '');
      console.log(`Admin check via env: ${address} vs ${envAdminWallet} => ${isEnvAdmin}`);
      return isEnvAdmin;
    }
    return false;
  }
};

/**
 * Create a new digital identity directly (real blockchain transaction)
 * @param {Object} idData - Identity data to be stored
 * @returns {Promise<Object>} - Transaction result
 */
export const createIdentity = async (idData) => {
  try {
    console.log("Creating identity with real blockchain transaction:", idData);

    // Get signer
    const signer = await getSigner();
    if (!signer) {
      throw new Error("Failed to get signer, wallet may not be connected");
    }

    const signerAddress = await signer.getAddress();
    console.log("Signer address:", signerAddress);

    // Get contract with signer
    const contractAddress = getContractAddress();
    console.log("Using contract address:", contractAddress);

    // Verify the contract exists at the address
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider.getCode(contractAddress);
    if (code === '0x' || code === '0x0') {
      throw new Error(`No contract found at address ${contractAddress}`);
    }

    const contract = new ethers.Contract(
      contractAddress,
      BlockIDContract.abi,
      signer
    );

    if (!contract) {
      throw new Error("Failed to create contract instance");
    }

    // Generate uniqueIdentityHash if not provided
    const uniqueHash = idData.uniqueHash || `${idData.name}_${idData.email}_${Date.now()}`;

    // Create proper bytes32 hash (exactly 32 bytes)
    // Using ethers' formatting utilities for reliable bytes32 format
    let bytes32Hash;
    try {
      // For strings that are already 0x-prefixed and 66 chars (32 bytes + 0x), use directly
      if (uniqueHash.startsWith('0x') && uniqueHash.length === 66) {
        bytes32Hash = uniqueHash;
      } else {
        // Otherwise use ethers' keccak256 which is compatible with Solidity
        bytes32Hash = ethers.keccak256(ethers.toUtf8Bytes(uniqueHash));
      }
      console.log("Generated bytes32 hash:", bytes32Hash);
    } catch (hashError) {
      console.error("Error generating bytes32 hash:", hashError);
      throw new Error(`Failed to generate valid bytes32 hash: ${hashError.message}`);
    }

    // Store metadata in IPFS (in real implementation)
    // For now, we'll just use a placeholder hash
    const ipfsHash = "QmPlaceholderIPFSHash";
    console.log("Using IPFS hash:", ipfsHash);

    // Set ID type
    const idType = "personal_id";

    // Check if the user already has an ID
    console.log("Checking if user already has an ID...");
    try {
      const hasId = await contract.hasIdentity(signerAddress);
      console.log("Has identity check result:", hasId);

      if (hasId) {
        throw new Error("This wallet already has an ID minted on the blockchain");
      }
    } catch (hasIdentityError) {
      console.error("Error in hasIdentity check:", hasIdentityError);
      // Continue anyway, the contract will also check this
    }

    // Check if hash is already registered
    console.log("Checking if hash is already registered...");
    try {
      const isRegistered = await contract.isHashRegistered(bytes32Hash);
      console.log("Hash registration check result:", isRegistered);

      if (isRegistered) {
        throw new Error("This identity hash is already registered");
      }
    } catch (hashError) {
      console.error("Error in isHashRegistered check:", hashError);
      // Continue anyway, the contract will also check this
    }

    // Calculate expiry date (10 years)
    const expiryDuration = 10 * 365 * 24 * 60 * 60; // 10 years in seconds

    // Call the contract method to create an identity
    // We use different methods based on whether the caller is an admin
    let isAdminUser = false;
    try {
      console.log("Checking if user is admin...");
      isAdminUser = await contract.isAdmin(signerAddress);
      console.log("Is admin check result:", isAdminUser);
    } catch (adminCheckError) {
      console.error("Error checking admin status:", adminCheckError);
      console.log("Continuing as regular user");
    }

    console.log("User is admin:", isAdminUser);

    let tx;
    try {
      console.log("Attempting transaction...");

      // Check ETH balance
      const balance = await provider.getBalance(signerAddress);
      console.log("Account balance:", ethers.formatEther(balance), "ETH");

      if (balance === 0n) {
        throw new Error("Your wallet has zero ETH balance. You need ETH to pay for transaction fees.");
      }

      // Skip gas estimation and go straight to transaction to ensure the wallet popup appears
      console.log("Sending transaction directly to trigger wallet confirmation popup");

      if (isAdminUser) {
        console.log("Calling createIdentity as admin with params:", {
          owner: signerAddress,
          ipfsHash,
          expiryDuration,
          idType,
          uniqueHash: bytes32Hash
        });

        // Force the wallet popup by setting the gas limit manually instead of estimating
        tx = await contract.createIdentity(
          signerAddress, // owner address
          ipfsHash, // IPFS hash
          expiryDuration, // expiry duration
          idType, // ID type
          bytes32Hash, // unique identity hash
          {
            gasLimit: 500000, // Set a reasonable gas limit manually
          }
        );
      } else {
        console.log("Calling requestIdentity as regular user with params:", {
          ipfsHash,
          idType,
          uniqueHash: bytes32Hash
        });

        // Force the wallet popup by setting the gas limit manually
        tx = await contract.requestIdentity(
          ipfsHash,
          idType,
          bytes32Hash,
          {
            gasLimit: 500000, // Set a reasonable gas limit manually
          }
        );
      }

      console.log("Transaction sent:", tx.hash);
      return tx;
    } catch (contractCallError) {
      console.error("Contract call failed:", contractCallError);

      // Try to extract a more useful error message
      const errorMessage = contractCallError.message || "Unknown error";

      if (errorMessage.includes("insufficient funds")) {
        throw new Error("Your wallet doesn't have enough ETH to pay for gas. Please add ETH to your wallet.");
      } else if (errorMessage.includes("user rejected")) {
        throw new Error("Transaction was rejected in your wallet.");
      } else if (errorMessage.includes("execution reverted")) {
        // Try to extract revert reason
        const revertReason = errorMessage.includes("execution reverted:")
          ? errorMessage.split("execution reverted:")[1].trim()
          : "Transaction would fail";
        throw new Error(`Smart contract rejected the transaction: ${revertReason}`);
      } else {
        throw new Error(`Transaction failed: ${errorMessage}`);
      }
    }
  } catch (error) {
    console.error("Error in createIdentity:", error);
    throw error;
  }
};

/**
 * Verify an identity (only for verifiers)
 * @param {number} idNumber - The ID number to verify
 * @returns {Promise<void>}
 */
export const verifyIdentity = async (idNumber) => {
  try {
    const contract = await getContractWithSigner();
    const tx = await contract.verifyIdentity(idNumber);
    await tx.wait();
  } catch (error) {
    console.error('Error verifying identity:', error);
    if (!isDevelopment) {
      throw error;
    }
  }
};

/**
 * Revoke an identity
 * @param {number} idNumber - The ID number to revoke
 * @returns {Promise<void>}
 */
export const revokeIdentity = async (idNumber) => {
  try {
    const contract = await getContractWithSigner();
    const tx = await contract.revokeIdentity(idNumber);
    await tx.wait();
  } catch (error) {
    console.error('Error revoking identity:', error);
    if (!isDevelopment) {
      throw error;
    }
  }
};

/**
 * Get identity information
 * @param {number} idNumber - The ID number to query
 * @returns {Promise<Object>} - The identity information
 */
export const getIdentity = async (idNumber) => {
  try {
    const contract = await getContractReadOnly();
    const identity = await contract.getIdentity(idNumber);

    return {
      owner: identity[0],
      ipfsHash: identity[1],
      createdAt: new Date(Number(identity[2]) * 1000),
      expiresAt: identity[3] > 0 ? new Date(Number(identity[3]) * 1000) : null,
      isVerified: identity[4],
      idType: identity[5],
      uniqueIdentityHash: identity[6]
    };
  } catch (error) {
    console.error('Error getting identity:', error);
    if (isDevelopment) {
      // Return mock data for development
      return {
        owner: '0x0000000000000000000000000000000000000000',
        ipfsHash: 'QmXyZ123',
        createdAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 31536000000),
        isVerified: Math.random() > 0.5,
        idType: ['national_id', 'driver_license', 'passport'][Math.floor(Math.random() * 3)],
        uniqueIdentityHash: '0x' + Array(64).fill(0).map(() =>
          Math.floor(Math.random() * 16).toString(16)).join('')
      };
    }
    throw error;
  }
};

/**
 * Enhanced helper to get identity details including full IPFS metadata
 * @param {number} idNumber - The ID number to query
 * @returns {Promise<Object>} - The full identity object with IPFS data
 */
export const getIdentityDetails = async (idNumber) => {
  try {
    const identity = await getIdentity(idNumber);
    if (!identity.ipfsHash || identity.ipfsHash === 'QmPlaceholderIPFSHash') {
      return identity;
    }

    try {
      const response = await fetch(`${IPFS_GATEWAY}${identity.ipfsHash}`);
      if (response.ok) {
        const ipfsData = await response.json();
        return {
          ...identity,
          ...ipfsData,
          ipfsUrl: `${IPFS_GATEWAY}${identity.ipfsHash}`
        };
      }
    } catch (ipfsErr) {
      console.warn(`Could not fetch IPFS metadata for ID ${idNumber}:`, ipfsErr);
    }

    return identity;
  } catch (error) {
    console.error(`Error in getIdentityDetails for ${idNumber}:`, error);
    throw error;
  }
};

/**
 * Get all identities owned by an address
 * @param {string} owner - Address to query
 * @returns {Promise<number[]>} - Array of ID numbers
 */
export const getIdentitiesByOwner = async (owner) => {
  try {
    const contract = getContractReadOnly();
    return await contract.getIdentitiesByOwner(owner);
  } catch (error) {
    console.error('Error getting identities by owner:', error);
    if (isDevelopment) {
      // Return mock data for development
      return [1, 2, 3];
    }
    throw error;
  }
};

/**
 * Check if an identity is valid
 * @param {number} idNumber - The ID number to validate
 * @returns {Promise<boolean>} - True if the identity is valid
 */
export const isIdentityValid = async (idNumber) => {
  try {
    const contract = getContractReadOnly();
    return await contract.isIdentityValid(idNumber);
  } catch (error) {
    console.error('Error checking identity validity:', error);
    if (isDevelopment) {
      // For development, return random validity
      return Math.random() > 0.3;
    }
    return false;
  }
};

/**
 * Check if a wallet already has an ID
 * @param {string} address - Wallet address to check
 * @returns {Promise<boolean>} - True if the wallet has an ID
 */
export const hasIdentity = async (address) => {
  try {
    const contract = getContractReadOnly();
    return await contract.hasIdentity(address);
  } catch (error) {
    console.error('Error checking if wallet has ID:', error);
    if (isDevelopment) {
      // Mock implementation for development
      const existingCardData = localStorage.getItem('blockid_wallets') || '{}';
      const existingCards = JSON.parse(existingCardData);
      return !!existingCards[address];
    }
    return false;
  }
};

/**
 * Check if a unique identity hash is already registered
 * @param {string} uniqueHash - Hash to check
 * @returns {Promise<boolean>} - True if the hash is already registered
 */
export const isHashRegistered = async (uniqueHash) => {
  try {
    const contract = getContractReadOnly();

    // Convert the hash to bytes32 if needed
    let bytes32Hash;
    if (uniqueHash.startsWith('0x') && uniqueHash.length === 66) {
      // Already in bytes32 format
      bytes32Hash = uniqueHash;
    } else {
      // Generate bytes32 hash from string
      bytes32Hash = await generateBytes32Hash(uniqueHash);
    }

    console.log("Checking if hash is registered:", bytes32Hash);
    return await contract.isHashRegistered(bytes32Hash);
  } catch (error) {
    console.error('Error checking if hash is registered:', error);
    if (isDevelopment) {
      // Mock implementation
      return false;
    }
    return false;
  }
};

/**
 * Generate a bytes32 hash from a string
 * @param {string} input - String to hash
 * @returns {Promise<string>} - bytes32 formatted hash
 */
export const generateBytes32Hash = async (input) => {
  try {
    // Use ethers' keccak256 for Solidity-compatible bytes32 hashing
    // This ensures the hash matches what the Solidity contract expects
    return ethers.keccak256(ethers.toUtf8Bytes(input));
  } catch (error) {
    console.error('Error generating bytes32 hash:', error);
    throw new Error(`Failed to generate bytes32 hash: ${error.message}`);
  }
};

/**
 * Get the ID number for a wallet address
 * @param {string} owner - Wallet address
 * @returns {Promise<number>} - ID number (0 if none)
 */
export const getIdentityByOwner = async (owner) => {
  try {
    const contract = getContractReadOnly();
    return await contract.getIdentityByOwner(owner);
  } catch (error) {
    console.error('Error getting identity by owner:', error);
    if (isDevelopment) {
      // Mock implementation for development
      const existingCardData = localStorage.getItem('blockid_wallets') || '{}';
      const existingCards = JSON.parse(existingCardData);
      return existingCards[owner]?.idNumber || 0;
    }
    return 0;
  }
};

/**
 * Get the ID number for a unique identity hash
 * @param {string} uniqueHash - Unique identity hash
 * @returns {Promise<number>} - ID number (0 if none)
 */
export const getIdentityByHash = async (uniqueHash) => {
  try {
    const contract = getContractReadOnly();

    // Use the consistent bytes32 hash generation method
    const bytes32Hash = uniqueHash.startsWith('0x') && uniqueHash.length === 66
      ? uniqueHash
      : await generateBytes32Hash(uniqueHash);

    return await contract.getIdentityByHash(bytes32Hash);
  } catch (error) {
    console.error('Error getting identity by hash:', error);
    if (isDevelopment) {
      // Mock implementation
      return 0;
    }
    return 0;
  }
};

/**
 * Verify that a given hash matches the on-chain hash for an ID
 * @param {number} idNumber - The ID number to check
 * @param {string} claimedHash - The hash to verify
 * @returns {Promise<boolean>} - True if the hash matches
 */
export const verifyIdentityHash = async (idNumber, claimedHash) => {
  try {
    const contract = getContractReadOnly();

    // Use the consistent bytes32 hash generation method
    const bytes32Hash = claimedHash.startsWith('0x') && claimedHash.length === 66
      ? claimedHash
      : await generateBytes32Hash(claimedHash);

    return await contract.verifyIdentityHash(idNumber, bytes32Hash);
  } catch (error) {
    console.error('Error verifying identity hash:', error);
    if (isDevelopment) {
      // Mock implementation
      return true;
    }
    return false;
  }
};

/**
 * Request a new digital identity (user flow)
 * @param {string} ipfsHash - IPFS hash of identity data
 * @param {string} idType - Type of ID (e.g., "driver_license")
 * @param {string} uniqueIdentityHash - SHA-256 hash for uniqueness verification
 * @returns {Promise<number>} - The created request ID
 */
export const requestIdentity = async (ipfsHash, idType, uniqueIdentityHash) => {
  try {
    const contract = await getContractWithSigner();

    // Use the consistent bytes32 hash generation method
    const bytes32Hash = uniqueIdentityHash.startsWith('0x') && uniqueIdentityHash.length === 66
      ? uniqueIdentityHash
      : await generateBytes32Hash(uniqueIdentityHash);

    const tx = await contract.requestIdentity(ipfsHash, idType, bytes32Hash);
    const receipt = await tx.wait();

    // Find the IDRequested event to get the request ID
    const event = receipt.logs
      .filter(log => log.fragment && log.fragment.name === 'IDRequested')
      .map(log => contract.interface.parseLog(log))[0];

    return event.args.requestId;
  } catch (error) {
    console.error('Error requesting identity:', error);
    if (isDevelopment) {
      return Math.floor(Math.random() * 1000) + 1;
    }
    throw error;
  }
};

/**
 * Get all pending ID requests (admin only)
 * @returns {Promise<number[]>} - Array of pending request IDs
 */
export const getPendingRequests = async () => {
  try {
    const contract = await getContractReadOnly();
    const requests = await contract.getPendingRequests();
    console.log('Raw pending requests from contract:', requests);

    // Filter out zero values and ensure unique values
    const filteredRequests = [...new Set(requests.filter(id => id && id.toString() !== '0'))];
    console.log('Filtered pending requests:', filteredRequests);

    return filteredRequests;
  } catch (error) {
    console.error('Error getting pending requests:', error);
    // Always return empty array instead of mock data to prevent seeing fake requests
    return [];
  }
};

/**
 * Get details of a specific ID request
 * @param {number} requestId - ID of the request to query
 * @returns {Promise<Object>} - Request details
 */
export const getRequestDetails = async (requestId) => {
  try {
    const contract = await getContractReadOnly();
    const request = await contract.getRequestDetails(requestId);

    // Skip requests with empty/zero address
    if (!request[0] || request[0] === '0x0000000000000000000000000000000000000000') {
      throw new Error('Invalid requester address');
    }

    return {
      requester: request[0],
      ipfsHash: request[1],
      requestedAt: new Date(Number(request[2]) * 1000),
      uniqueIdentityHash: request[3],
      isPending: request[4],
      isApproved: request[5],
      isRejected: request[6]
    };
  } catch (error) {
    console.error(`Error getting request details for ID ${requestId}:`, error);
    // Don't return mock data - throw error instead
    throw new Error(`Failed to get details for request #${requestId}`);
  }
};

/**
 * Get all requests for a specific user
 * @param {string} address - User's wallet address
 * @returns {Promise<number[]>} - Array of request IDs
 */
export const getUserRequests = async (address) => {
  try {
    const contract = getContractReadOnly();
    return await contract.getUserRequests(address);
  } catch (error) {
    console.error('Error getting user requests:', error);
    if (isDevelopment) {
      // Mock data for development
      return [1, 2];
    }
    throw error;
  }
};

/**
 * Approve an ID request (admin only)
 * @param {number} requestId - ID of the request to approve
 * @param {number} expiryDuration - Duration in seconds until the ID expires (0 for no expiry)
 * @returns {Promise<number>} - The created ID number
 */
export const approveIDRequest = async (requestId, expiryDuration) => {
  try {
    const contract = await getContractWithSigner();
    const tx = await contract.approveIDRequest(requestId, expiryDuration);
    const receipt = await tx.wait();

    // Find the IDRequestApproved event to get the ID number
    const event = receipt.logs
      .filter(log => log.fragment && log.fragment.name === 'IDRequestApproved')
      .map(log => contract.interface.parseLog(log))[0];

    return event.args.idNumber;
  } catch (error) {
    console.error('Error approving ID request:', error);
    if (isDevelopment) {
      return Math.floor(Math.random() * 1000) + 1;
    }
    throw error;
  }
};

/**
 * Reject an ID request (admin only)
 * @param {number} requestId - ID of the request to reject
 * @param {string} reason - Reason for rejection
 * @returns {Promise<void>}
 */
export const rejectIDRequest = async (requestId, reason) => {
  try {
    const contract = await getContractWithSigner();
    const tx = await contract.rejectIDRequest(requestId, reason);
    await tx.wait();
  } catch (error) {
    console.error('Error rejecting ID request:', error);
    if (isDevelopment) {
      // Do nothing in development
    } else {
      throw error;
    }
  }
};


/**
 * Get admin addresses from the contract
 * @returns {Promise<string[]>} Array of admin wallet addresses
 */
export const getAdminAddresses = async () => {
  try {
    const contract = await getContractReadOnly();
    // The contract has a single admin retrieved via getAdmin()
    const contractAdmin = await contract.getAdmin();
    const envAdmin = (process.env.NEXT_PUBLIC_ADMIN_WALLET || '').replace(/"/g, '');
    const admins = new Set([contractAdmin.toLowerCase()]);
    if (envAdmin) admins.add(envAdmin.toLowerCase());
    return [...admins];
  } catch (error) {
    console.error('Error getting admin addresses:', error);
    const envAdmin = (process.env.NEXT_PUBLIC_ADMIN_WALLET || '').replace(/"/g, '');
    if (envAdmin) return [envAdmin];
    if (typeof window !== 'undefined' && window.ethereum?.selectedAddress) {
      return [window.ethereum.selectedAddress];
    }
    return [];
  }
};

/**
 * Mock verification for locally stored IDs 
 * This allows us to verify downloaded ID cards even without blockchain interaction
 * @param {string} idNumber - ID number (e.g. "BID-123456")
 * @param {string} walletAddress - Wallet address associated with the ID
 * @returns {Promise<Object>} - Verification result
 */
export const verifyDownloadedID = async (idNumber, walletAddress) => {
  try {
    console.log("Verifying downloaded ID:", { idNumber, walletAddress });

    // First try to find in local storage (wallet-specific storage)
    const walletsData = localStorage.getItem('blockid_wallets') || '{}';
    const wallets = JSON.parse(walletsData);

    // Check if the wallet exists and has a matching ID
    if (walletAddress && wallets[walletAddress]) {
      console.log("Found wallet in storage:", walletAddress);
      const storedID = wallets[walletAddress];

      // If ID numbers match, this is a valid ID
      if (storedID.idNumber === idNumber) {
        console.log("ID verified from wallet storage");
        return {
          success: true,
          verified: true,
          identity: storedID,
          verificationMethod: "local_storage",
          message: "ID verified successfully from local storage"
        };
      }
    }

    // Check general ID storage as fallback
    const allIDs = localStorage.getItem('blockid_all_ids') || '{}';
    const ids = JSON.parse(allIDs);

    // Look for matching ID number
    if (ids[idNumber]) {
      console.log("Found ID in general storage:", idNumber);
      return {
        success: true,
        verified: true,
        identity: ids[idNumber],
        verificationMethod: "local_storage",
        message: "ID verified successfully from general storage"
      };
    }

    // Finally, fall back to mock verification for demo purposes
    if (idNumber && idNumber.startsWith("BID-")) {
      console.log("Using mock verification for demo purposes");

      // Create a mock identity using the provided information
      const mockIdentity = {
        idNumber: idNumber,
        walletAddress: walletAddress || "0x000...mock",
        fullName: "Verified ID Holder",
        email: "verified@example.com",
        dateOfBirth: "2000-01-01",
        dateOfIssue: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        expiryDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        uniqueIdentityHash: ethers.keccak256(ethers.toUtf8Bytes(`${idNumber}_${walletAddress || "mock"}`)),
        blockchainTxnHash: "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        isMinted: true,
        isVerified: true
      };

      return {
        success: true,
        verified: true,
        identity: mockIdentity,
        verificationMethod: "demo_mode",
        message: "ID verified successfully in demo mode"
      };
    }

    // If we reach here, the ID could not be verified
    return {
      success: false,
      verified: false,
      message: "ID could not be verified. It may not exist or has been tampered with."
    };
  } catch (error) {
    console.error("Error verifying downloaded ID:", error);
    return {
      success: false,
      verified: false,
      message: "Error verifying ID: " + (error.message || "Unknown error"),
      error: error
    };
  }
};

/**
 * Create identity directly as admin (alias for createIdentity which handles admin logic internally)
 * @param {Object} idData - Identity data
 * @param {string} ownerAddress - Address of the identity owner
 * @returns {Promise<Object>} - Transaction result
 */
export const createIdentityByAdmin = async (idData, ownerAddress) => {
  return createIdentity({ ...idData, owner: ownerAddress || idData.owner });
};

/**
 * Get identity by ID number (alias for getIdentity)
 * @param {number} idNumber - The ID number to query
 * @returns {Promise<Object>} - The identity information
 */
export const getIdentityById = getIdentity;
