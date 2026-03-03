"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import useWalletAuth from '@/app/hooks/useWalletAuth';
import Navbar from '@/app/components/Navbar';
import { QRCodeCanvas } from 'qrcode.react';
import {
  createIdentity,
  hasIdentity,
  isHashRegistered,
  getIdentityByOwner,
  getIdentityDetails,
  verifyIdentityHash,
  requestIdentity,
  getUserRequests,
  getRequestDetails,
  isAdmin,
  getPendingRequests,
  approveIDRequest,
  rejectIDRequest,
  createIdentityByAdmin,
  getAdminAddresses,
  generateBytes32Hash
} from '@/utils/blockchain';
import IDCard from '@/app/components/IDCard';
import DigitalIDCard from '@/app/components/IDCardDisplay';
import { generateUIDHash } from '@/utils/identity';
import { ethers } from 'ethers';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast, Toaster } from 'react-hot-toast';
import LoadingScreenWrapper from '@/app/components/LoadingScreenWrapper';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Helper function to safely generate blockchain-compatible bytes32 hashes 
 * Used to prevent "missing revert data" errors during transactions
 */
const safeBytes32 = async (input) => {
  try {
    // Use ethers' keccak256 for Solidity-compatible bytes32 hashing
    return ethers.keccak256(ethers.toUtf8Bytes(input));
  } catch (error) {
    console.error("Error generating blockchain hash:", error);
    // Fallback method if there's an error
    return "0x" + Array(64).fill("0").join("");
  }
};

/** Sepolia testnet chain ID */
const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111

/**
 * Ensures the connected wallet is on Sepolia testnet.
 * Triggers a MetaMask popup to switch if needed.
 * Returns { success: true } or { success: false, message: string }
 */
async function switchToSepolia() {
  if (!window.ethereum) {
    return { success: false, message: 'No Ethereum wallet found. Please install MetaMask.' };
  }
  try {
    const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
    if (currentChain.toLowerCase() === SEPOLIA_CHAIN_ID) {
      return { success: true }; // Already on Sepolia
    }

    // Try switching — this fires the MetaMask network-switch popup
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
      return { success: true };
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        // Sepolia not in wallet yet — add it first, then switch
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: SEPOLIA_CHAIN_ID,
            chainName: 'Sepolia Testnet',
            nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        return { success: true };
      }
      // User rejected the switch (code 4001)
      return {
        success: false,
        message: 'Please switch to the Sepolia Testnet to mint your ID card.',
        rejected: true,
      };
    }
  } catch (err) {
    console.error('switchToSepolia error:', err);
    return { success: false, message: 'Could not switch network. Please switch to Sepolia manually in your wallet.' };
  }
}

/**
 * Test function to confirm file editing is working
 */
const testBlockchainFunction = () => {
  console.log("Test function for blockchain integration");
  return "Test successful";
};

export default function Dashboard() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const { address, connect, disconnect, hasSession, isConnecting, isSigning, error: walletError } = useWalletAuth();

  // Form state
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    idNumber: '',
    expiryDate: '',
    photoUrl: '',
    uniqueIdentityHash: '',
    dateOfIssue: new Date().toISOString().split('T')[0],
    blockchainTxnHash: '',
    dateOfBirth: '',
    age: null
  });

  // UI states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [cardPreview, setCardPreview] = useState(null);
  const [showWalletPrompt, setShowWalletPrompt] = useState(false);
  // State for authentication flow
  const [fullAuthCompleted, setFullAuthCompleted] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [walletHasId, setWalletHasId] = useState(false);
  const [requestStatus, setRequestStatus] = useState(null);
  const [userRequests, setUserRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestDetails, setRequestDetails] = useState(null);
  const [hasExistingID, setHasExistingID] = useState(false);
  const [existingID, setExistingID] = useState(null);
  // Admin-specific states
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPendingRequests, setAdminPendingRequests] = useState([]);
  const [adminRequestDetails, setAdminRequestDetails] = useState({});
  const [expiryDuration, setExpiryDuration] = useState('30'); // Default 30 days
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [identityExists, setIdentityExists] = useState(false);
  const [digitalID, setDigitalID] = useState(null);
  const [requests, setRequests] = useState([]);

  // Calculate age from date of birth
  const calculateAge = (dateOfBirth) => {
    try {
      const dob = new Date(dateOfBirth);
      const today = new Date();

      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();

      // Adjust age if birthday hasn't occurred yet this year
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }

      return age;
    } catch (error) {
      console.error("Error calculating age:", error);
      return null;
    }
  };

  // Check for full authentication on initial load
  // Also silently auto-detects already-connected MetaMask wallet so users
  // don't see the "Connect Wallet" screen after a page refresh.
  useEffect(() => {
    console.log("DASHBOARD DEBUG: Component mounted");

    const checkFullAuth = async () => {
      console.log("DASHBOARD DEBUG: Checking full auth");
      const isFullyAuthenticated = sessionStorage.getItem('blockid_full_auth') === 'complete';
      const hasWalletSession = localStorage.getItem('blockid_wallet_session') !== null;

      if (isFullyAuthenticated && address) {
        console.log("DASHBOARD DEBUG: Session intact, setting fullAuthCompleted");
        setFullAuthCompleted(true);
        setIsCheckingAuth(false);
        return;
      }

      // Only attempt silent auto-restore if we have a valid session in localStorage
      // This prevents re-connecting immediately after a manual disconnect
      if (hasWalletSession && typeof window !== 'undefined' && window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts && accounts.length > 0) {
            console.log("DASHBOARD DEBUG: MetaMask already connected and session exists, auto-restoring", accounts[0]);
            // Restore sessionStorage flags
            sessionStorage.setItem('blockid_full_auth', 'complete');
            sessionStorage.setItem('blockid_active_session', 'true');
            setFullAuthCompleted(true);
            setIsCheckingAuth(false);

            // Also fire the wallet connect flow if address state isn't set yet
            if (!address) {
              connect();
            }
            return;
          }
        } catch (err) {
          console.warn("DASHBOARD DEBUG: eth_accounts check failed", err);
        }
      }

      console.log("DASHBOARD DEBUG: Auth requirements not met or no session, showing connect prompt");
      setIsCheckingAuth(false);
    };

    checkFullAuth();
  }, [address, connect]);

  // Check if wallet already has an ID when address changes
  useEffect(() => {
    const checkWalletId = async () => {
      if (address) {
        try {
          const hasId = await hasIdentity(address);
          setWalletHasId(hasId);

          if (hasId) {
            // Fetch existing ID info if available
            const idNumber = await getIdentityByOwner(address);
            if (idNumber > 0) {
              setSuccessMessage('This wallet already has an ID registered. You can update your information but cannot mint a new ID.');
            }
          }
        } catch (error) {
          console.error('Error checking wallet ID:', error);
        }
      }
    };

    if (fullAuthCompleted) {
      checkWalletId();
    }
  }, [address, fullAuthCompleted]);

  // Auto-reconnect wallet if needed
  useEffect(() => {
    if (isAuthenticated && !address && !isConnecting) {
      // If authenticated but wallet not connected, try to reconnect
      const attemptReconnect = async () => {
        try {
          const result = await connect();
          if (result.success) {
            // Check if we have a previous signature
            const hasAuth = sessionStorage.getItem('blockid_full_auth') === 'complete';
            if (!hasAuth) {
              // Request new signature on reconnect
              const message = `Welcome back to BlockID!\n\nPlease sign this message to verify your wallet ownership.\n\nThis signature is required for security purposes and does not incur any gas fees.\n\nTimestamp: ${Date.now()}`;
              const provider = new ethers.BrowserProvider(window.ethereum);
              const signer = await provider.getSigner();
              const signature = await signer.signMessage(message);

              console.log('Reconnection signature verified:', signature);
              sessionStorage.setItem('blockid_full_auth', 'complete');
            }
            setFullAuthCompleted(true);
          }
        } catch (error) {
          console.error("Failed to auto-reconnect wallet:", error);
          setShowWalletPrompt(true);
          setFullAuthCompleted(false);
          sessionStorage.removeItem('blockid_full_auth');
        }
      };

      attemptReconnect();
    }
  }, [isAuthenticated, address, connect, isConnecting]);

  // Monitor signing and connection states
  useEffect(() => {
    // When a wallet is connected and not in signing state
    if (address && !isConnecting && !isSigning) {
      setFullAuthCompleted(true);
      setWalletAddress(address);
      console.log(`Setting wallet address to ${address}`);
    }
  }, [address, isConnecting, isSigning]);

  // Auto-connect wallet on dashboard load
  useEffect(() => {
    // Only try to connect if we don't already have an address
    if (!address && !isConnecting) {
      console.log("Dashboard loaded without connected wallet, attempting to connect");

      const attemptWalletConnection = async () => {
        try {
          // Check if we have a session before trying to connect
          const hasWalletSession = localStorage.getItem('blockid_wallet_session') !== null;

          if (hasWalletSession) {
            console.log("Found wallet session, connecting wallet");
            const result = await connect();

            if (result.success) {
              console.log("Auto-connected wallet successfully:", result.address);
              setWalletAddress(result.address);
              setFullAuthCompleted(true);
              sessionStorage.setItem('blockid_full_auth', 'complete');
            } else {
              console.log("Failed to auto-connect wallet:", result.error);
              setShowWalletPrompt(true);
            }
          } else {
            console.log("No wallet session found, showing wallet prompt");
            setShowWalletPrompt(true);
          }
        } catch (error) {
          console.error("Error during auto wallet connection:", error);
          setShowWalletPrompt(true);
        }
      };

      attemptWalletConnection();
    }
  }, [address, isConnecting, connect]);

  // Reset all ID state so the mint form is shown again
  const resetToMintForm = () => {
    setHasExistingID(false);
    setExistingID(null);
    setWalletHasId(false);
    setCardPreview(null);
    setRequestStatus(null);
    setUserRequests([]);
    setSelectedRequest(null);
    setRequestDetails(null);
    // Clear localStorage entries so the check doesn't re-trigger immediately
    if (address) {
      localStorage.removeItem(`blockIdCard_${address}`);
    }
    localStorage.removeItem('blockid_card');
    clearFormData();
  };

  // Clear form data
  const clearFormData = () => {
    setFormData({
      fullName: '',
      email: '',
      dateOfBirth: '',
      idNumber: generateRandomId(true),
      expiryDate: (() => {
        const today = new Date();
        const tenYearsLater = new Date(today);
        tenYearsLater.setFullYear(tenYearsLater.getFullYear() + 10);
        return tenYearsLater.toISOString().split('T')[0];
      })(),
      photoUrl: '',
      uniqueIdentityHash: '',
      dateOfIssue: new Date().toISOString().split('T')[0],
      blockchainTxnHash: '',
      age: null
    });
    setCardPreview(null);
    setErrorMessage('');
    setSuccessMessage('');
  };

  // Update walletAddress whenever the address changes
  useEffect(() => {
    if (address) {
      console.log(`Wallet address changed to ${address}`);

      // Update wallet address in state
      setWalletAddress(address);

      // Reset ID states when wallet changes
      setHasExistingID(false);
      setExistingID(null);
      setWalletHasId(false);
      setCardPreview(null);

      // Clear form data
      clearFormData();

      // Immediately check if this wallet has an existing ID
      checkExistingIDAndRequests(address);
    } else {
      // Clear state when wallet disconnects
      setWalletAddress(null);
      setHasExistingID(false);
      setExistingID(null);
      setWalletHasId(false);
      setCardPreview(null);
    }
  }, [address]);

  // Only run once on component mount or when auth state changes
  useEffect(() => {
    // Check if we're in a browser context
    if (typeof window === 'undefined') {
      console.log("DASHBOARD DEBUG: Not in browser context, skipping auth check");
      return;
    }

    console.log("DASHBOARD DEBUG: Auth state detailed check:", {
      isAuthenticated,
      isConnecting,
      isSigning,
      address,
      hasSession,
      walletSession: localStorage.getItem('blockid_wallet_session') !== null,
      sessionStorageAuth: sessionStorage.getItem('blockid_full_auth')
    });

    // Remove the redirect entirely as it's preventing dashboard access
    // This will always allow the dashboard to load, then we can prompt for wallet connection

    // Check if they have an existing ID when an address is available
    if (address) {
      console.log("DASHBOARD DEBUG: Address available, checking for existing ID");
      checkExistingIDAndRequests(address);
    } else {
      console.log("DASHBOARD DEBUG: No address available yet, will attempt connection");
      // If we're here, we must have a session but no active address yet - attempt immediate connection
      const attemptAutoConnect = async () => {
        if (!isConnecting && !isSigning) {
          try {
            console.log("DASHBOARD DEBUG: Attempting auto-connect from session");
            const result = await connect();
            if (result.success) {
              console.log("DASHBOARD DEBUG: Auto-connect successful:", result.address);
              setWalletAddress(result.address);
            } else {
              console.log("DASHBOARD DEBUG: Auto-connect failed, showing wallet prompt");
              setShowWalletPrompt(true);
            }
          } catch (error) {
            console.error("DASHBOARD DEBUG: Auto-connect error:", error);
            setShowWalletPrompt(true);
          }
        }
      };

      // Only try to auto-connect if we have a session
      if (localStorage.getItem('blockid_wallet_session') || sessionStorage.getItem('blockid_active_session')) {
        attemptAutoConnect();
      } else {
        setShowWalletPrompt(true);
      }
    }

    // Initialize form with fresh data
    clearFormData();
  }, [isAuthenticated, isConnecting, isSigning, address, router, connect]);

  // Set error message if wallet connection fails
  useEffect(() => {
    if (walletError) {
      setErrorMessage(`Wallet connection error: ${walletError}`);
      setShowWalletPrompt(true);
      setFullAuthCompleted(false);
    }
  }, [walletError]);

  // Handle wallet account changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = async (accounts) => {
        console.log("Wallet accounts changed:", accounts);

        if (accounts.length === 0) {
          // User disconnected their wallet
          sessionStorage.removeItem('blockid_full_auth');
          setFullAuthCompleted(false);
          setIsAdmin(false);

          // Clear ID states
          setHasExistingID(false);
          setExistingID(null);
          setWalletHasId(false);
          setCardPreview(null);

          router.push('/');
        } else {
          // New account selected, require new signature and reset state
          sessionStorage.removeItem('blockid_full_auth');
          setFullAuthCompleted(false);
          setIsAdmin(false);

          // Clear previous ID data
          setHasExistingID(false);
          setExistingID(null);
          setWalletHasId(false);
          setCardPreview(null);
          setRequestStatus(null);
          setUserRequests([]);

          // Request new signature for new account
          try {
            const message = `Welcome to BlockID!\n\nPlease sign this message to verify your wallet ownership.\n\nThis signature is required for security purposes and does not incur any gas fees.\n\nTimestamp: ${Date.now()}`;
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const signature = await signer.signMessage(message);

            console.log('New account signature verified:', signature);
            setFullAuthCompleted(true);
            sessionStorage.setItem('blockid_full_auth', 'complete');

            // Set the new wallet address and check for IDs for this wallet
            const newAddress = await signer.getAddress();
            setWalletAddress(newAddress);
            await checkExistingIDAndRequests(newAddress);
          } catch (error) {
            console.error('Failed to get signature for new account:', error);
            setErrorMessage('Please sign the message to complete authentication with new account.');
          }
        }
      };

      // Subscribe to accounts change
      window.ethereum.on('accountsChanged', handleAccountsChanged);

      // Cleanup subscription
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [router]);

  // Clear auth on disconnect
  useEffect(() => {
    if (!address) {
      sessionStorage.removeItem('blockid_full_auth');
      setFullAuthCompleted(false);
    }
  }, [address]);

  // Check existing ID and requests
  const checkExistingIDAndRequests = async (walletAddress) => {
    console.log(`Checking existing ID for wallet: ${walletAddress}`);

    if (!walletAddress) {
      console.log("No wallet address provided");
      clearFormData();
      return;
    }

    // Reset ID states before checking
    setHasExistingID(false);
    setExistingID(null);
    setWalletHasId(false);

    try {
      // ── Step 1: Check localStorage first (fast path) ──
      const savedCard = localStorage.getItem(`blockIdCard_${walletAddress}`);
      if (savedCard) {
        try {
          const parsedCard = JSON.parse(savedCard);
          if (parsedCard.walletAddress === walletAddress && parsedCard.isMinted) {
            console.log("Found minted ID in localStorage for wallet:", walletAddress);
            setHasExistingID(true);
            setExistingID(parsedCard);
            setWalletHasId(true);
            return;
          }
        } catch (e) {
          console.error("Error parsing saved card:", e);
        }
      }

      // ── Step 2: Check blockchain ──
      try {
        console.log("Checking blockchain for existing ID...");
        const hasId = await hasIdentity(walletAddress);
        console.log(`Has identity on blockchain: ${hasId}`);

        if (hasId) {
          const idNumber = await getIdentityByOwner(walletAddress);

          if (idNumber > 0) {
            console.log(`Found ID #${idNumber} on chain for ${walletAddress}`);

            // Try to fetch full metadata from IPFS via the contract's stored ipfsHash
            let fullCard = null;
            try {
              const details = await getIdentityDetails(Number(idNumber));
              if (details && details.ipfsHash !== 'QmPlaceholderIPFSHash') {
                fullCard = {
                  ...details,
                  idNumber: `BID-${idNumber.toString().padStart(6, '0')}`,
                  walletAddress,
                  isMinted: true
                };
              }
            } catch (ipfsErr) {
              console.warn('Could not fetch IPFS card data:', ipfsErr.message);
            }

            // Fallback to minimal object if IPFS fetch failed
            const cardObject = fullCard || {
              idNumber: `BID-${idNumber.toString().padStart(6, '0')}`,
              walletAddress,
              createdAt: new Date().toISOString(),
              role: 'Personal ID',
              organization: 'Sepolia Network Authority',
              isMinted: true,
            };

            setExistingID(cardObject);
            setHasExistingID(true);
            setWalletHasId(true);
            // Cache so next visit is instant
            saveIDToLocalStorage(walletAddress, cardObject);
            return;
          }
        }

        // ── Step 3: No ID found — check pending requests ──
        console.log("No ID found, checking for pending requests...");
        const isUserAdmin = await isAdmin(walletAddress);

        if (!isUserAdmin) {
          const userPendingRequests = await getUserRequests(walletAddress);
          if (userPendingRequests.length > 0) {
            setUserRequests(userPendingRequests);
            const latestRequest = userPendingRequests[userPendingRequests.length - 1];
            setSelectedRequest(latestRequest);

            const details = await getRequestDetails(latestRequest);
            setRequestDetails({
              ...details,
              requestedAt: new Date(Number(details.requestedAt) * 1000),
            });

            if (details.isApproved) setRequestStatus('approved');
            else if (details.isRejected) setRequestStatus('rejected');
            else if (details.isPending) setRequestStatus('pending');
            else { setRequestStatus(null); clearFormData(); }
          } else {
            setRequestStatus(null);
            clearFormData();
          }
        } else {
          setRequestStatus(null);
          clearFormData();
        }
      } catch (blockchainError) {
        console.error("Error checking blockchain ID:", blockchainError);
        clearFormData();
      }
    } catch (error) {
      console.error("Error in checkExistingIDAndRequests:", error);
      clearFormData();
    }
  };

  // Handle wallet connection
  const handleConnectWallet = async () => {
    try {
      const result = await connect();
      if (result.success) {
        setWalletAddress(result.address);
        await checkExistingIDAndRequests(result.address);
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  };

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === 'dateOfBirth') {
      const age = calculateAge(value);
      console.log(`Date of birth changed to ${value}, calculated age: ${age}`);
      setFormData(prev => ({
        ...prev,
        [name]: value,
        age: age
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  // Validate email format
  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Handle email tab key
  const handleEmailKeyDown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const email = formData.email;
      if (!isValidEmail(email)) {
        e.preventDefault();
        setErrorMessage('Please enter a valid email address before proceeding');
        setTimeout(() => setErrorMessage(''), 3000);
      }
    }
  };

  // Handle photo upload — compress to keep localStorage under quota
  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('Photo must be less than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Compress via canvas: max 200px, JPEG 60%
      const img = new window.Image();
      img.onload = () => {
        const MAX = 200;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.6);
        setFormData(prev => ({ ...prev, photoUrl: compressed }));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Generate random ID number
  const generateRandomId = (resetForm = false) => {
    const randomId = 'ID' + Math.floor(10000000 + Math.random() * 90000000);
    if (resetForm) {
      setFormData(prev => ({
        ...prev,
        idNumber: randomId
      }));
    }
    return randomId;
  };

  // Generate Unique Identity Hash (UID)
  const generateUID = async () => {
    if (!formData.fullName) {
      setErrorMessage('Please enter your full name to generate a UID');
      return null;
    }

    if (!address) {
      setErrorMessage('Please connect your wallet to generate a UID');
      return null;
    }

    try {
      // Create a unique string from multiple user attributes for stronger uniqueness
      const now = new Date().toISOString();
      const uniqueString = `${formData.fullName}|${formData.email || ''}|${formData.dateOfBirth || ''}|${now}|${address}`;

      // Use Web Crypto API for more secure hashing
      const encoder = new TextEncoder();
      const data = encoder.encode(uniqueString);

      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashHex = '0x' + Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      console.log('Generated hash:', hashHex);

      // Check if this hash is already registered on blockchain
      try {
        const isAlreadyRegistered = await isHashRegistered(hashHex);
        if (isAlreadyRegistered) {
          setErrorMessage('This identity hash is already registered. Please modify your details.');
          return null;
        }
      } catch (hashCheckError) {
        console.error('Error checking if hash is registered:', hashCheckError);
        // Continue anyway as this is just a preliminary check
      }

      setFormData(prev => ({
        ...prev,
        uniqueIdentityHash: hashHex
      }));

      setErrorMessage('');
      return hashHex;
    } catch (error) {
      console.error('Error generating UID:', error);
      setErrorMessage('Error generating a unique identity hash. Please try again.');
      return null;
    }
  };

  // Generate blockchain transaction hash
  const generateMockTxnHash = () => {
    const characters = '0123456789abcdef';
    let hash = '0x';
    for (let i = 0; i < 64; i++) {
      hash += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    setFormData(prev => ({
      ...prev,
      blockchainTxnHash: hash
    }));

    return hash;
  };

  // Set default values
  useEffect(() => {
    // Set default expiry date to 10 years from today
    const today = new Date();
    const tenYearsLater = new Date(today);
    tenYearsLater.setFullYear(tenYearsLater.getFullYear() + 10);
    const formattedExpiryDate = tenYearsLater.toISOString().split('T')[0];

    setFormData(prev => ({
      ...prev,
      expiryDate: formattedExpiryDate,
      dateOfIssue: today.toISOString().split('T')[0]
    }));

    // Generate ID if not present
    if (!formData.idNumber) {
      generateRandomId();
    }
  }, []);

  // Form validation
  const validateForm = () => {
    if (!formData.fullName) {
      setErrorMessage('Please enter your full name');
      return false;
    }

    if (!formData.photoUrl) {
      setErrorMessage('Please upload a photo');
      return false;
    }

    if (!address) {
      setErrorMessage('Please connect your wallet to continue');
      return false;
    }

    setErrorMessage('');
    return true;
  };

  // Preview the ID card based on form data
  const handlePreviewID = async () => {
    // Validate form before previewing
    if (!formData.fullName || !formData.email || !formData.dateOfBirth) {
      setErrorMessage("Please fill out all required fields to preview your ID card.");
      return;
    }

    if (!isValidEmail(formData.email)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (!formData.photoUrl) {
      setErrorMessage("Please upload a photo for your ID card.");
      return;
    }

    // Calculate age if not already set
    if (!formData.age && formData.dateOfBirth) {
      const calculatedAge = calculateAge(formData.dateOfBirth);
      setFormData(prev => ({
        ...prev,
        age: calculatedAge
      }));
    }

    // Generate UID if not already set
    if (!formData.uniqueIdentityHash) {
      const uniqueHash = await generateUID();
      if (!uniqueHash) {
        return; // Error already set by generateUID
      }
    }

    // Create the card preview
    const previewCard = {
      ...formData,
      idNumber: formData.idNumber || generateRandomId(),
      expiryDate: formData.expiryDate,
      dateOfIssue: formData.dateOfIssue || new Date().toISOString().split('T')[0],
      walletAddress: address
    };

    // Update the preview
    setCardPreview(previewCard);
    setErrorMessage("");
  };

  // Mint ID card — real blockchain transaction via server-side API route
  const mintIDCard = async () => {
    if (!fullAuthCompleted) {
      setErrorMessage("Please complete the wallet authentication process first.");
      return;
    }

    if (!address) {
      setErrorMessage("Please connect your wallet to mint an ID card.");
      return;
    }

    if (!formData.fullName || !formData.email || !formData.dateOfBirth || !formData.photoUrl) {
      setErrorMessage("Please complete all required fields (name, email, date of birth, photo) before minting.");
      return;
    }

    // ── Network check: ensure wallet is on Sepolia before doing anything ──
    toast.loading('Checking network…', { id: 'network-check' });
    const networkResult = await switchToSepolia();
    toast.dismiss('network-check');

    if (!networkResult.success) {
      const msg = networkResult.message || 'Please switch to the Sepolia Testnet to mint your ID card.';
      setErrorMessage(msg);
      toast.error(msg, { duration: 5000 });
      return;
    }

    toast.success('Sepolia network confirmed ✓', { id: 'network-ok', duration: 1500 });
    // ── End network check ──────────────────────────────────────────────────

    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("Checking blockchain status...");

    try {
      // ── 1. Pre-flight: block duplicate mints by checking on-chain first ──
      console.log("Pre-checking blockchain for existing ID for:", address);
      try {
        const alreadyHasId = await hasIdentity(address);
        if (alreadyHasId) {
          toast.error("This wallet already has a minted ID card on Sepolia!");
          setSuccessMessage("");
          // Load the existing card and show it
          await checkExistingIDAndRequests(address);
          return;
        }
      } catch (preCheckErr) {
        console.warn("Pre-check warning (continuing):", preCheckErr.message);
      }

      // ── 2. Call the server-side API which handles IPFS + real minting ──
      setSuccessMessage("Uploading your ID to IPFS & submitting to Sepolia blockchain...");
      console.log("Calling /api/mint-id for wallet:", address);

      const response = await fetch('/api/mint-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          fullName: formData.fullName,
          email: formData.email,
          dateOfBirth: formData.dateOfBirth,
          photoUrl: formData.photoUrl,
          idNumber: formData.idNumber,
          expiryDate: formData.expiryDate,
          age: formData.age,
        }),
      });

      const data = await response.json();

      if (response.status === 409 && data.error === 'ALREADY_MINTED') {
        toast.error('This wallet already has a minted ID card on Sepolia!');
        setSuccessMessage("");
        await checkExistingIDAndRequests(address);
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Minting failed — check server logs');
      }

      console.log("Mint successful! Tx:", data.txHash, "IPFS:", data.ipfsHash);

      // ── 3. Build minted card from server response ──
      const mintedCard = {
        ...data.cardData,
        walletAddress: address,
        blockchainTxnHash: data.txHash,
        uniqueIdentityHash: data.uniqueHash,
        ipfsHash: data.ipfsHash,
        ipfsUrl: data.ipfsUrl,
        isMinted: true,
        status: 'confirmed',
        blockNumber: data.blockNumber?.toString() || '',
        mintedAt: new Date().toISOString(),
      };

      // ── 4. Persist to localStorage ──
      saveIDToLocalStorage(address, mintedCard);
      localStorage.setItem('blockid_card', JSON.stringify(mintedCard));
      const walletsData = localStorage.getItem('blockid_wallets') || '{}';
      const wallets = JSON.parse(walletsData);
      wallets[address] = mintedCard;
      localStorage.setItem('blockid_wallets', JSON.stringify(wallets));

      // ── 5. Update UI ──
      setExistingID(mintedCard);
      setHasExistingID(true);
      setWalletHasId(true);
      setCardPreview(mintedCard);
      setSuccessMessage(
        `✅ ID minted on Sepolia! Transaction: ${data.txHash.substring(0, 10)}...`
      );
      toast.success('Your BlockID has been minted on Sepolia!');
      clearFormData();

      return { hash: data.txHash };
    } catch (error) {
      console.error("Minting error:", error);
      setErrorMessage(`Failed to mint ID: ${error.message}`);
      setSuccessMessage("");
      toast.error(`Minting failed: ${error.message}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Handle form submission for ID request
  const handleSubmitRequest = async (e) => {
    if (e) e.preventDefault();

    try {
      setIsLoading(true);

      // Check if wallet is connected
      if (!address) {
        toast.error("Please connect your wallet to create an ID.");
        return;
      }

      // Ensure wallet address is set
      setWalletAddress(address);

      // Validate required fields
      if (!formData.fullName || !formData.email || !formData.photoUrl) {
        toast.error("Please fill all required fields and upload a photo.");
        return;
      }

      // Set issue date to today
      const dateOfIssue = new Date().toISOString();

      // Set expiry date to 10 years after today
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 10);

      // Generate a unique ID Hash if not already present
      const uniqueIdHash = formData.uniqueIdentityHash || await generateUID();

      // Prepare metadata
      const metadata = {
        ...formData,
        walletAddress: address,
        photoUrl: formData.photoUrl,
        dateOfIssue,
        expiryDate: expiryDate.toISOString(),
        idHash: uniqueIdHash,
        idNumber: `BID-${uniqueIdHash.substring(0, 8).toUpperCase()}`
      };

      console.log("Submitting ID request with metadata:", metadata);

      // Check if current user is admin
      const userIsAdmin = await isAdmin(address);

      // Get admin addresses
      let adminAddresses = await getAdminAddresses();
      console.log("Admin addresses:", adminAddresses);

      // If no admins found and user is not admin, make current user admin for testing
      if ((!adminAddresses || adminAddresses.length === 0) && !userIsAdmin) {
        console.warn("No admin addresses found. For testing, treating current user as admin.");
        adminAddresses = [address];

        // Continue with ID creation as if user is admin
        const result = await createIdentityByAdmin(metadata);
        if (result && result.success) {
          toast.success("No admins found. Created ID directly!");

          // Store the ID data in local storage
          localStorage.setItem('blockid_card', JSON.stringify({
            ...metadata,
            blockchainTxnHash: result.transactionHash
          }));

          // Show ID card
          setCardPreview({
            ...metadata,
            blockchainTxnHash: result.transactionHash
          });
          return;
        }
      }

      let result;

      // Admin creates ID directly, normal user makes a request
      if (userIsAdmin) {
        result = await createIdentityByAdmin(metadata);
        if (result && result.success) {
          toast.success("ID created successfully!");

          // Store the ID data in local storage
          localStorage.setItem('blockid_card', JSON.stringify({
            ...metadata,
            blockchainTxnHash: result.transactionHash
          }));

          // Show ID card
          setCardPreview({
            ...metadata,
            blockchainTxnHash: result.transactionHash
          });
        }
      } else {
        // Check if there are active admins
        if (!adminAddresses || adminAddresses.length === 0) {
          toast.error("No active admins found to approve your request. The contract may need admins to be set up.");
          return;
        }

        // Regular user requests identity
        result = await requestIdentity(metadata);
        if (result && result.success) {
          toast.success("ID request sent to admin wallets for approval!");

          // Store the ID data in local storage for requester
          localStorage.setItem('blockid_pending_request', JSON.stringify({
            ...metadata,
            requestId: result.requestId,
            timestamp: Date.now()
          }));

          // Also store all requests in a global requestPool
          const existingRequests = JSON.parse(localStorage.getItem('blockid_all_requests') || '[]');
          existingRequests.push({
            ...metadata,
            requestId: result.requestId,
            timestamp: Date.now()
          });
          localStorage.setItem('blockid_all_requests', JSON.stringify(existingRequests));

          // Show ID card preview
          setCardPreview({
            ...metadata,
            isPending: true
          });
        }
      }

      if (!result || !result.success) {
        toast.error(result?.error || "Failed to create ID");
      }
    } catch (error) {
      console.error("Error creating ID:", error);
      toast.error("Error creating ID: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Save ID card data to localStorage for future verification
  const saveIDToLocalStorage = (walletAddress, idData) => {
    // Helper: try setItem, if quota exceeded retry without the photo
    const safeSet = (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (quotaErr) {
        console.warn(`localStorage quota exceeded for "${key}", retrying without photo`);
        try {
          const parsed = JSON.parse(value);
          delete parsed.photoUrl;
          localStorage.setItem(key, JSON.stringify(parsed));
        } catch (fallbackErr) {
          console.error('Failed to save even without photo:', fallbackErr);
        }
      }
    };

    try {
      const completeIdData = {
        ...idData,
        isMinted: true,
        dateOfIssue: idData.dateOfIssue || new Date().toISOString(),
        createdAt: idData.createdAt || new Date().toISOString()
      };

      console.log("Saving ID to local storage for wallet:", walletAddress, completeIdData);

      if (walletAddress) {
        safeSet(`blockIdCard_${walletAddress}`, JSON.stringify(completeIdData));

        try {
          const walletsData = localStorage.getItem('blockid_wallets') || '{}';
          const wallets = JSON.parse(walletsData);
          wallets[walletAddress] = completeIdData;
          safeSet('blockid_wallets', JSON.stringify(wallets));
        } catch (e) {
          console.warn('Could not update blockid_wallets:', e);
        }

        console.log(`ID saved for wallet ${walletAddress} in multiple formats`);
      }

      safeSet('blockid_card', JSON.stringify(completeIdData));

      try {
        const allIds = JSON.parse(localStorage.getItem('blockid_all_ids') || '{}');
        if (completeIdData.idNumber) {
          allIds[completeIdData.idNumber] = completeIdData;
          safeSet('blockid_all_ids', JSON.stringify(allIds));
          console.log(`ID saved to all_ids under ${completeIdData.idNumber}`);
        }
      } catch (e) {
        console.warn('Could not update blockid_all_ids:', e);
      }
    } catch (error) {
      console.error('Error saving ID to localStorage:', error);
    }
  };

  // Handle expiry duration change
  const handleExpiryChange = (e) => {
    setExpiryDuration(e.target.value);
  };

  // Render the form for ID request
  const renderForm = () => {
    return (
      <form className="space-y-6">
        {errorMessage && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4">
            <p>{errorMessage}</p>
          </div>
        )}

        {successMessage && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4">
            <p>{successMessage}</p>
          </div>
        )}

        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
            Full Name
          </label>
          <div className="mt-1">
            <input
              type="text"
              id="fullName"
              name="fullName"
              required
              value={formData.fullName}
              onChange={handleInputChange}
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email Address
          </label>
          <div className="mt-1">
            <input
              type="email"
              id="email"
              name="email"
              required
              value={formData.email}
              onChange={handleInputChange}
              onKeyDown={handleEmailKeyDown}
              className={`shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md ${!isValidEmail(formData.email) && formData.email ? 'border-red-500' : ''}`}
            />
            {formData.email && !isValidEmail(formData.email) && (
              <p className="mt-1 text-sm text-red-500">Please enter a valid email address</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
            Date of Birth
          </label>
          <div className="mt-1">
            <input
              type="date"
              id="dateOfBirth"
              name="dateOfBirth"
              required
              value={formData.dateOfBirth}
              onChange={handleInputChange}
              max={new Date().toISOString().split('T')[0]} // Prevent future dates
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
            />
          </div>
          {formData.age !== null && (
            <p className="mt-1 text-sm text-gray-500">Age: {formData.age} years</p>
          )}
        </div>

        <div>
          <label htmlFor="idNumber" className="block text-sm font-medium text-gray-700">
            ID Number
          </label>
          <div className="mt-1">
            <input
              type="text"
              id="idNumber"
              name="idNumber"
              readOnly
              value={formData.idNumber || "Will be assigned automatically"}
              className="bg-gray-100 shadow-sm block w-full sm:text-sm border-gray-300 rounded-md"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">This will be assigned automatically upon creation</p>
        </div>

        <div>
          <label htmlFor="expiryDate" className="block text-sm font-medium text-gray-700">
            Expiry Date (10 years validity)
          </label>
          <div className="mt-1">
            <input
              type="date"
              id="expiryDate"
              name="expiryDate"
              value={formData.expiryDate}
              readOnly
              className="bg-gray-100 shadow-sm block w-full sm:text-sm border-gray-300 rounded-md"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Your ID will be valid for 10 years from the date of issue.
          </p>
        </div>

        <div>
          <label htmlFor="photoUrl" className="block text-sm font-medium text-gray-700">
            Photo Upload
          </label>
          <div className="mt-1 flex items-center space-x-2">
            <input
              type="file"
              id="photoFile"
              name="photoFile"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="sr-only"
            />
            <label
              htmlFor="photoFile"
              className="cursor-pointer px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Upload Photo
            </label>
            {formData.photoUrl && (
              <span className="text-sm text-green-600">Photo uploaded successfully</span>
            )}
          </div>
          {formData.photoUrl && (
            <div className="mt-2">
              <img
                src={formData.photoUrl}
                alt="ID Photo"
                className="h-24 w-24 object-cover rounded-md"
              />
            </div>
          )}
        </div>

        <div className="flex space-x-4 pt-2">
          <button
            type="button"
            onClick={handlePreviewID}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="mr-2 h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview ID
          </button>

          <button
            type="button"
            onClick={mintIDCard}
            disabled={isLoading}
            className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-gradient-to-r from-green-600 to-green-800 hover:from-green-700 hover:to-green-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition-all duration-200"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Mint ID Card
              </>
            )}
          </button>
        </div>

        {cardPreview && (
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-900 mb-4">ID Preview</h3>
            <DigitalIDCard idData={cardPreview} />

            {!cardPreview.isMinted && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={mintIDCard}
                  disabled={isLoading}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-lg text-white bg-gradient-to-r from-green-600 to-green-800 hover:from-green-700 hover:to-green-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 transition-all duration-200"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing Transaction...
                    </>
                  ) : (
                    <>
                      <svg className="mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Confirm & Mint ID Card
                    </>
                  )}
                </button>
              </div>
            )}

            {cardPreview.isMinted && (
              <div className="mt-3 flex items-center text-green-600 font-medium">
                <svg className="mr-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                ID Card Minted Successfully
              </div>
            )}
          </div>
        )}
      </form>
    );
  };

  // Render different content based on ID/request status
  const renderContent = () => {
    // Add debug logs to help diagnose rendering issues
    console.log("Rendering dashboard content with status:", {
      address: address,
      isAdmin: isAdmin,
      hasExistingID: hasExistingID,
      existingID: existingID,
      walletHasId: walletHasId,
      cardPreview: cardPreview ? Boolean(cardPreview.isMinted) : false
    });

    // First check if user has an existing ID from localStorage
    if (hasExistingID && existingID) {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Digital ID</h2>

            <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6">
              <p className="font-medium">✅ ID minted on Sepolia Testnet</p>
              <p className="mt-1 text-sm"><strong>Note:</strong> Only one ID card is allowed per wallet address. Your ID is permanent and cannot be changed.</p>
            </div>

            <DigitalIDCard
              idData={{
                ...existingID,
                isMinted: true
              }}
            />

            {/* Etherscan + IPFS links */}
            <div className="mt-4 flex flex-wrap gap-3 justify-center">
              {existingID.blockchainTxnHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${existingID.blockchainTxnHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View on Sepolia Etherscan
                </a>
              )}
              {existingID.ipfsUrl && (
                <a
                  href={existingID.ipfsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                  </svg>
                  View IPFS Metadata
                </a>
              )}
              <button
                onClick={() => downloadAsPDF(existingID)}
                disabled={isLoading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download as PDF
              </button>
            </div>

            {/* Wallet NFT guidance */}
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
              <p className="font-semibold mb-1">📱 Want to see this in Rabby / MetaMask?</p>
              <p>The BlockID contract is a custom identity contract (not ERC-721), so wallets won't auto-show it in the NFT tab. To verify ownership, use the Etherscan link above. Your wallet address is permanently linked to ID <strong>{existingID.idNumber}</strong> on-chain.</p>
            </div>
          </div>
        </div>
      );
    }

    // Check if wallet has an ID from blockchain verification
    if (walletHasId) {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Digital ID</h2>

            <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6">
              <p>This wallet already has an ID on the blockchain. The details cannot be edited.</p>
              <p className="mt-2 text-sm"><strong>Note:</strong> Only one ID card is allowed per wallet address.</p>
            </div>

            {cardPreview ? (
              <DigitalIDCard idData={{ ...cardPreview, isMinted: true }} />
            ) : (
              <div className="text-center p-8 bg-gray-100 rounded-lg">
                <p className="text-gray-700 mb-4">Your ID data is stored on the blockchain but not available locally.</p>
              </div>
            )}
            <div className="mt-4 flex justify-center">
              <button
                onClick={resetToMintForm}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <svg className="mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Mint New ID
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Check if user just minted a new card in this session
    if (cardPreview && cardPreview.isMinted) {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Digital ID</h2>

            <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6">
              <p className="font-medium">✅ ID minted on Sepolia Testnet</p>
              <p className="mt-1 text-sm"><strong>Note:</strong> Only one ID card is allowed per wallet address.</p>
            </div>

            <DigitalIDCard idData={cardPreview} />

            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {cardPreview.blockchainTxnHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${cardPreview.blockchainTxnHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View on Sepolia Etherscan
                </a>
              )}
              {cardPreview.ipfsUrl && (
                <a
                  href={cardPreview.ipfsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                >
                  View IPFS Metadata
                </a>
              )}
              <button
                onClick={() => downloadAsPDF(cardPreview)}
                disabled={isLoading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download as PDF
              </button>
            </div>

            {/* Wallet NFT guidance */}
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
              <p className="font-semibold mb-1">📱 Want to see this in Rabby / MetaMask?</p>
              <p>The BlockID contract is a custom identity contract (not ERC-721), so wallets won't auto-show it in the NFT tab. Use the Etherscan link above as proof of on-chain ownership. Your wallet is permanently linked to ID <strong>{cardPreview.idNumber}</strong>.</p>
            </div>
          </div>
        </div>
      );
    }

    // If none of the above, show the form for creating a new ID
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-md p-6 max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Create Your Digital ID</h2>
          <p className="text-gray-600 mb-6">
            Fill out the form below to mint your BlockID on the <strong>Sepolia Testnet</strong>.
            Gas fees are paid in <strong>Sepolia ETH</strong> (free testnet ETH — no real money needed).
          </p>
          <div className="bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 mb-6">
            <p className="font-medium">Important: Only one ID card is allowed per wallet address.</p>
            <p className="mt-1 text-sm">Once minted, your ID card is permanent and cannot be modified.</p>
          </div>

          {renderForm()}
        </div>
      </div>
    );
  };

  // Function to download ID card as PDF
  const downloadAsPDF = async (idData) => {
    try {
      setIsLoading(true);

      // Import html2canvas and jsPDF dynamically to reduce initial load time
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      // Get the ID card element
      const cardElement = document.querySelector('.max-w-md');
      if (!cardElement) {
        throw new Error('ID card element not found');
      }

      // Create a canvas from the ID card element
      const canvas = await html2canvas(cardElement, {
        scale: 2, // Higher scale for better quality
        useCORS: true, // Allow cross-origin images
        allowTaint: true,
        backgroundColor: '#1a1a1a', // Match the card background
      });

      // Create a new PDF document
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Calculate dimensions to fit the PDF
      const imgWidth = 210 - 40; // A4 width minus margins
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Add the ID card image to the PDF
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 20, 20, imgWidth, imgHeight);

      // Add metadata
      pdf.setProperties({
        title: `BlockID - ${idData.fullName}`,
        subject: 'Digital ID Card',
        author: 'BlockID Platform',
        creator: 'BlockID',
      });

      // Add verification URL with QR code data
      const verifyParams = new URLSearchParams({
        id: idData.idNumber || '',
        address: idData.walletAddress || '',
        hash: idData.uniqueIdentityHash || ''
      }).toString();

      const verifyText = `Verify this ID: ${window.location.origin}/verify?${verifyParams}`;
      pdf.text(verifyText, 20, 20 + imgHeight + 10);

      // Add verification notice
      pdf.setFontSize(8);
      pdf.text("This digital ID can be verified online even without blockchain access. Scan the QR code or visit the verification URL.", 20, 20 + imgHeight + 20);

      // Store ID in all_ids for verification
      try {
        // Store a copy in general ID storage for verification by ID number
        const allIDs = JSON.parse(localStorage.getItem('blockid_all_ids') || '{}');
        allIDs[idData.idNumber] = {
          ...idData,
          downloadedAt: new Date().toISOString()
        };
        localStorage.setItem('blockid_all_ids', JSON.stringify(allIDs));
        console.log(`Saved ID ${idData.idNumber} to all_ids storage for verification`);
      } catch (storageError) {
        console.error("Failed to save ID to localStorage for verification:", storageError);
      }

      // Save the PDF
      pdf.save(`BlockID-${idData.fullName.replace(/\s+/g, '-')}.pdf`);

      setSuccessMessage('ID card downloaded successfully as PDF!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      setErrorMessage(`Failed to generate PDF: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // While we are still doing the initial async wallet check, show a spinner
  // so users never see the "Connect Wallet" prompt just because sessionStorage
  // was cleared by a page refresh.
  if (isCheckingAuth && !fullAuthCompleted) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Navbar />
        <div className="flex flex-col items-center justify-center mt-32">
          <svg className="animate-spin h-10 w-10 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-500">Restoring wallet session...</p>
        </div>
      </main>
    );
  }

  // If wallet not connected (and check is done), show connection prompt
  if (!fullAuthCompleted) {
    return (
      <main className="container mx-auto px-4 py-8">
        <Navbar />
        <div className="text-center max-w-md mx-auto bg-white p-8 rounded-lg shadow-md mt-16">
          <h1 className="text-2xl font-bold mb-6">Access Your Digital ID</h1>
          <p className="mb-6 text-gray-600">
            Connect your Ethereum wallet to access your digital ID dashboard. This allows you to view, create, or download your ID.
          </p>
          <button
            onClick={connect}
            disabled={isConnecting || isSigning}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-md transition duration-300 disabled:bg-gray-400 flex items-center justify-center"
          >
            {isConnecting || isSigning ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                </svg>
                Connect Wallet to Continue
              </>
            )}
          </button>

          {walletError && (
            <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">
              <p className="text-sm">{walletError}</p>
              <p className="text-xs mt-1">Please ensure MetaMask is installed and unlocked.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Main dashboard view
  return (
    <div className="container mx-auto px-4 py-8">
      <Toaster position="top-right" />
      <h1 className="text-3xl font-bold mb-8 text-center">Your Digital ID Dashboard</h1>

      <div className="mb-6 flex items-center justify-between bg-gray-100 p-4 rounded-lg">
        <div>
          <p className="text-sm text-gray-600">Connected Address:</p>
          <p className="font-mono">{address}</p>
        </div>
        <button
          onClick={disconnect}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md text-sm"
        >
          Disconnect
        </button>
      </div>

      {renderContent()}
    </div>
  );
} 