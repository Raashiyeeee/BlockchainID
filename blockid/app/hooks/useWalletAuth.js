"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import { ethers } from 'ethers';

// Message to sign for authentication
const SIGN_MESSAGE = "Welcome to BlockID! Sign this message to authenticate your identity on the Sepolia testnet. This request will not trigger a blockchain transaction or cost any gas fees.";

// Sepolia testnet chain ID (11155111 in hex)
const SEPOLIA_CHAIN_ID = '0xaa36a7';

/**
 * Ensures the wallet is connected to the Sepolia testnet.
 * Triggers a MetaMask network-switch popup if the user is on a different network.
 * If Sepolia hasn't been added to MetaMask yet, it adds it automatically.
 */
async function ensureSepoliaNetwork(provider) {
  try {
    const currentChainId = await provider.request({ method: 'eth_chainId' });
    if (currentChainId.toLowerCase() === SEPOLIA_CHAIN_ID) {
      return { success: true }; // Already on Sepolia
    }

    // Prompt the MetaMask popup to switch to Sepolia
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
      return { success: true };
    } catch (switchError) {
      // 4902 = chain not added to wallet yet
      if (switchError.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: SEPOLIA_CHAIN_ID,
            chainName: 'Sepolia Testnet',
            nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: [
              process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.sepolia.org',
            ],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        return { success: true };
      }
      // User rejected the switch — propagate so the caller can handle it
      throw switchError;
    }
  } catch (err) {
    console.error('ensureSepoliaNetwork error:', err);
    return { success: false, error: err };
  }
}

export function useWalletAuth() {
  const { login, logout } = useAuth();

  // Connection states
  const [address, setAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState(null);

  // Wallet detection states
  const [availableWallets, setAvailableWallets] = useState([]);
  const [hasSession, setHasSession] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize and detect available wallets + silently restore address
  useEffect(() => {
    // Check for stored session first
    const storedSession = localStorage.getItem('blockid_wallet_session');
    if (storedSession) {
      try {
        const session = JSON.parse(storedSession);
        setHasSession(true);
        // Don't auto-connect, just remember we have a session
      } catch (err) {
        console.error("Failed to parse stored session:", err);
        localStorage.removeItem('blockid_wallet_session');
      }
    }

    // Detect available wallets
    const detectWallets = async () => {
      const detected = [];

      if (!window.ethereum) {
        setAvailableWallets([]);
        return;
      }

      // ── EIP-5749: multiple providers array ───────────────────────────────
      // When multiple wallet extensions are installed (e.g. MetaMask + Rabby),
      // each registers itself in window.ethereum.providers so they each get
      // their own isolated provider object instead of fighting over window.ethereum.
      const providers = window.ethereum.providers ?? [window.ethereum];

      for (const p of providers) {
        // MetaMask: isMetaMask=true AND NOT Rabby (Rabby sets isMetaMask=true to fake
        // compatibility, so we must explicitly exclude it to show real MetaMask only).
        if (p.isMetaMask && !p.isRabby) {
          detected.push({
            name: 'MetaMask',
            icon: '/images/wallets/metamask.svg',
            provider: p,
          });
          continue;
        }

        // Rabby Wallet
        if (p.isRabby) {
          detected.push({
            name: 'Rabby Wallet',
            icon: '/images/wallets/ethereum.svg', // use generic if no Rabby icon
            provider: p,
          });
          continue;
        }

        // Coinbase Wallet
        if (p.isCoinbaseWallet) {
          detected.push({
            name: 'Coinbase Wallet',
            icon: '/images/wallets/coinbase.svg',
            provider: p,
          });
          continue;
        }

        // Trust Wallet
        if (p.isTrust) {
          detected.push({
            name: 'Trust Wallet',
            icon: '/images/wallets/trust.svg',
            provider: p,
          });
          continue;
        }
      }

      // If nothing specific was detected but ethereum exists, add a generic entry
      if (detected.length === 0 && window.ethereum) {
        detected.push({
          name: 'Browser Wallet',
          icon: '/images/wallets/ethereum.svg',
          provider: window.ethereum,
        });
      }

      // Always sort MetaMask to the top so it's pre-selected by default
      detected.sort((a, b) => (a.name === 'MetaMask' ? -1 : b.name === 'MetaMask' ? 1 : 0));

      setAvailableWallets(detected);
    };

    detectWallets();

    // Suppress unhandled promise rejections that originate from wallet extensions
    // (e.g. Rabby fires its own unhandledrejection event when the user clicks Cancel
    // in addition to rejecting the provider promise — this prevents the Next.js
    // dev error overlay from showing a red screen for a normal user action).
    const handleUnhandledRejection = (event) => {
      const reason = event?.reason;
      const msg = reason?.message?.toLowerCase() ?? '';
      const isWalletNoise =
        // User cancelled / rejected
        reason?.code === 4001 ||
        reason?.code === 'ACTION_REJECTED' ||
        msg.includes('user rejected') ||
        msg.includes('user denied') ||
        msg.includes('rejected connection') ||
        // MetaMask internal errors (extension ID: nkbihfbeogaeaoehlefnkodbefgpgknn)
        msg.includes('failed to connect to metamask') ||
        msg.includes('already processing eth_requestaccounts') ||
        msg.includes('metamask is not connected') ||
        msg.includes('metamask not connected') ||
        msg.includes('wallet not connected') ||
        // Generic wallet guard messages
        msg.includes('accounts not found') ||
        msg.includes('eth_requestaccounts');
      if (isWalletNoise) {
        event.preventDefault(); // stops Next.js from showing the error overlay
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Silently restore wallet address using eth_accounts (never shows a popup).
    // This means components that check `address` get the real value on first render
    // instead of null, preventing spurious "Connect Wallet" redirects.
    const silentRestore = async () => {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          console.log("useWalletAuth: silently restored address", accounts[0]);
          setAddress(accounts[0]);
          setHasSession(true);
          setIsConnected(true);
          sessionStorage.setItem('blockid_active_session', 'true');
          sessionStorage.setItem('blockid_full_auth', 'complete');
          login(accounts[0]);
          // Refresh the localStorage session timestamp
          const session = { address: accounts[0], timestamp: new Date().getTime() };
          localStorage.setItem('blockid_wallet_session', JSON.stringify(session));
          // Prompt network switch to Sepolia if needed (silent check, popup only if wrong network)
          ensureSepoliaNetwork(window.ethereum).catch(() => { });
        }
      } catch (err) {
        console.warn("useWalletAuth: silent restore failed", err);
      }
    };

    silentRestore();

    // Cleanup: remove the unhandledrejection listener when hook unmounts
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Listen for account changes and disconnection
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        // User disconnected their wallet
        handleDisconnect();
      } else if (address && accounts[0] !== address) {
        // Account was changed to a different one
        console.log("useWalletAuth: account changed from", address, "to", accounts[0]);
        setAddress(accounts[0]);

        // Update the stored session with the new address
        if (hasSession) {
          const session = {
            address: accounts[0],
            timestamp: new Date().getTime()
          };
          localStorage.setItem('blockid_wallet_session', JSON.stringify(session));
        }
      }
    };

    const handleChainChanged = () => {
      // Reload the page when chain changes
      window.location.reload();
    };

    const handleDisconnect = () => {
      setAddress(null);
      setHasSession(false);
      localStorage.removeItem('blockid_wallet_session');
      logout();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
      window.ethereum.removeListener('disconnect', handleDisconnect);
    };
  }, [address, hasSession, logout]);

  // Check session status and automatically reconnect
  const checkSession = useCallback(async () => {
    console.log("Checking wallet session...");

    // Most aggressive session check - directly look for active session marker
    const sessionActive = sessionStorage.getItem('blockid_active_session');
    if (sessionActive === 'true' && window.ethereum) {
      console.log("Active session marker found, attempting immediate reconnect");
      try {
        // Try to get accounts without prompting
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          console.log("Found active accounts:", accounts[0]);
          setAddress(accounts[0]);
          setHasSession(true);

          // Update session storage & auth context
          sessionStorage.setItem('blockid_active_session', 'true');
          login(accounts[0]);

          // Force full auth completion
          sessionStorage.setItem('blockid_full_auth', 'complete');

          return true;
        }

        // If that fails, try a more aggressive approach by requesting accounts directly
        console.log("No active accounts, trying requestAccounts");
        const requestedAccounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (requestedAccounts && requestedAccounts.length > 0) {
          console.log("Got accounts after request:", requestedAccounts[0]);
          setAddress(requestedAccounts[0]);
          setHasSession(true);

          // Update session storage & auth context
          sessionStorage.setItem('blockid_active_session', 'true');
          login(requestedAccounts[0]);

          // Force full auth completion
          sessionStorage.setItem('blockid_full_auth', 'complete');

          return true;
        }
      } catch (error) {
        console.error("Failed to reconnect with active session:", error);
      }
    }

    // Fall back to the regular localStorage check
    console.log("Checking localStorage for wallet session");
    const storedSession = localStorage.getItem('blockid_wallet_session');
    if (!storedSession) {
      console.log("No stored wallet session found");
      return false;
    }

    try {
      const session = JSON.parse(storedSession);
      const now = new Date().getTime();

      // Session expiration check
      if (now - session.timestamp > 7 * 24 * 60 * 60 * 1000) {
        console.log("Stored session expired");
        localStorage.removeItem('blockid_wallet_session');
        sessionStorage.removeItem('blockid_active_session');
        return false;
      }

      console.log("Valid stored session found, attempting reconnect");

      // If still has wallet provider and wallet is unlocked, we can reconnect
      if (window.ethereum) {
        try {
          // Try aggressive reconnect since we have a session
          console.log("Requesting wallet accounts");
          const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts' // This may show a popup
          });

          if (accounts && accounts.length > 0) {
            console.log("Wallet reconnected with account:", accounts[0]);
            // Even if the stored address is different, update with the current one
            setAddress(accounts[0]);
            setHasSession(true);

            // Update auth context
            login(accounts[0]);

            // Update session with latest address
            const updatedSession = {
              address: accounts[0],
              timestamp: new Date().getTime()
            };
            localStorage.setItem('blockid_wallet_session', JSON.stringify(updatedSession));

            // Also update session storage for quick checks during page navigation
            sessionStorage.setItem('blockid_active_session', 'true');
            sessionStorage.setItem('blockid_full_auth', 'complete');

            return true;
          }
        } catch (error) {
          console.error("Error during wallet reconnection:", error);
        }
      }

      // Keep the session alive even if we couldn't reconnect right now
      return false;
    } catch (err) {
      console.error("Failed to verify session:", err);
      localStorage.removeItem('blockid_wallet_session');
      sessionStorage.removeItem('blockid_active_session');
      return false;
    }
  }, [login]);

  // Check session on mount with auto-reconnect
  useEffect(() => {
    // Don't attempt reconnect if we already have an address
    if (!address) {
      checkSession();
    }
  }, [checkSession, address]);

  // Updated connect function that persists better
  const connect = useCallback(async (walletIndex = 0) => {
    setError(null);

    // If already connected, return success
    if (address) {
      return { success: true, address };
    }

    try {
      setIsConnecting(true);

      if (!window.ethereum) {
        setError("No Ethereum wallet found. Please install MetaMask or another web3 wallet.");
        return { success: false, error: "No Ethereum wallet found" };
      }

      // Select the wallet to use (if multiple detected)
      const provider = availableWallets.length > 0
        ? availableWallets[walletIndex]?.provider
        : window.ethereum;

      if (!provider) {
        setError("Selected wallet provider not available");
        return { success: false, error: "Provider not available" };
      }

      const accounts = await provider.request({ method: 'eth_requestAccounts' });

      if (!accounts || accounts.length === 0) {
        setError("No accounts found or user rejected");
        return { success: false, error: "No accounts found" };
      }

      // ── Network check: switch to Sepolia if needed ──────────────────────
      const networkResult = await ensureSepoliaNetwork(provider);
      if (!networkResult.success) {
        const rejected =
          networkResult.error?.code === 4001 ||
          networkResult.error?.code === 'ACTION_REJECTED';
        const msg = rejected
          ? 'Please switch to the Sepolia Testnet to use BlockID.'
          : 'Could not switch to Sepolia Testnet. Please switch manually in your wallet.';
        setError(msg);
        return { success: false, error: msg };
      }
      // ─────────────────────────────────────────────────────────────────────

      // Store wallet connection
      const newAddress = accounts[0];
      setAddress(newAddress);
      setHasSession(true);

      // Store in localStorage for persistence
      const session = {
        address: newAddress,
        timestamp: new Date().getTime()
      };
      localStorage.setItem('blockid_wallet_session', JSON.stringify(session));

      // Store in sessionStorage for navigation persistence
      sessionStorage.setItem('blockid_active_session', 'true');

      // Set full auth completion so dashboard grants access
      sessionStorage.setItem('blockid_full_auth', 'complete');

      // Update auth context
      login(newAddress);

      return { success: true, address: newAddress };
    } catch (error) {
      // Detect user rejection or MetaMask internal guard errors — these are normal
      // user-action outcomes and should NOT crash the page with a red error overlay.
      const msg = error?.message?.toLowerCase() ?? '';
      const isRejection =
        error?.code === 4001 ||
        error?.code === 'ACTION_REJECTED' ||
        msg.includes('user rejected') ||
        msg.includes('user denied') ||
        // MetaMask-specific guard messages
        msg.includes('failed to connect to metamask') ||
        msg.includes('already processing eth_requestaccounts') ||
        msg.includes('metamask is not connected') ||
        msg.includes('metamask not connected');

      if (isRejection) {
        // Soft handling — log info only, return clean cancelled result
        console.log('useWalletAuth: wallet connection blocked or cancelled:', error?.message);
        const friendlyMsg = msg.includes('failed to connect')
          ? 'MetaMask is locked or busy. Please unlock MetaMask and try again.'
          : 'Connection cancelled. Click "Connect Wallet" again whenever you are ready.';
        setError(friendlyMsg);
        return { success: false, error: friendlyMsg, cancelled: true };
      }

      console.error('Error connecting wallet:', error);
      setError(error.message || 'Failed to connect wallet');
      return { success: false, error: error.message };
    } finally {
      setIsConnecting(false);
    }
  }, [address, availableWallets, login]);

  // Disconnect function
  const disconnect = useCallback(() => {
    // Clean up local state
    setAddress(null);
    setHasSession(false);

    // Remove session from storage
    localStorage.removeItem('blockid_wallet_session');
    sessionStorage.removeItem('blockid_active_session');

    // Log out from auth context
    logout();

    // Force refresh provider state
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        // Request to deactivate the current account
        window.ethereum.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        }).catch(err => {
          // This may fail, but that's okay, we're just trying to force MetaMask to prompt 
          // for account selection on the next connect
          console.log("Permission request failed, this is expected:", err);
        });

        // Clear any cached provider state
        if (window.ethereum._state && window.ethereum._state.accounts) {
          window.ethereum._state.accounts = [];
        }

        // Force a manual disconnect event
        window.ethereum.emit('disconnect');

        console.log("Wallet disconnected successfully");
      } catch (err) {
        console.error("Error during disconnect cleanup:", err);
      }
    }

    return { success: true };
  }, [logout]);

  // Sign a message
  const signMessage = async (message = '') => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsSigning(true);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      return await signer.signMessage(message || `Verify wallet ownership at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("Signing error:", err);
      throw err;
    } finally {
      setIsSigning(false);
    }
  };

  return {
    address,
    isConnecting,
    isSigning,
    connect,
    disconnect,
    error,
    availableWallets,
    hasSession,
    isConnected,
    signMessage
  };
}

// Default export for modules that expect it
export default useWalletAuth;
