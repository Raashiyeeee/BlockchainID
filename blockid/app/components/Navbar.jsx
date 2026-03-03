"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/contexts/AuthContext';
import useWalletAuth from '@/app/hooks/useWalletAuth';
import WalletConnectModal from './WalletConnectModal';
import { smoothScrollTo } from '@/app/utils/scrollHelper';
import { usePathname } from 'next/navigation';
import { isAdmin } from '@/utils/blockchain';
import { truncateAddress } from '@/utils/formatting';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const { isAuthenticated } = useAuth();
  const {
    connect,
    disconnect,
    isConnecting,
    isSigning,
    address,
    availableWallets,
    hasSession,
    error: walletError
  } = useWalletAuth();

  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [showReconnectTip, setShowReconnectTip] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [showAuthAlert, setShowAuthAlert] = useState(false);

  const dropdownRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();

  // Track scroll position to change navbar appearance
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsProfileDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Show reconnect tip after 3 seconds if has session but no address
  useEffect(() => {
    if (hasSession && !address && !isConnecting && !isSigning) {
      const timer = setTimeout(() => {
        setShowReconnectTip(true);
      }, 3000);

      return () => clearTimeout(timer);
    } else {
      setShowReconnectTip(false);
    }
  }, [hasSession, address, isConnecting, isSigning]);

  // Check if current user is admin
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (address) {
        try {
          const adminStatus = await isAdmin(address);
          setIsAdminUser(adminStatus);
          console.log(`Admin status for ${address}: ${adminStatus}`);
        } catch (err) {
          console.error("Error checking admin status:", err);
          setIsAdminUser(false);
        }
      } else {
        setIsAdminUser(false);
      }
    };

    checkAdminStatus();
  }, [address]);

  // Function to handle wallet connection
  const handleConnectWallet = async () => {
    try {
      await connect();
    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  };

  const handleDisconnectWallet = () => {
    disconnect();
    // Close profile dropdown after disconnecting
    setIsProfileDropdownOpen(false);
    router.push('/'); // Redirect to home after disconnecting
  };

  // Handle wallet selection from modal
  const handleWalletSelection = async (walletIndex) => {
    setConnectionError(null);
    const result = await connect(walletIndex);
    if (!result.success) {
      setConnectionError(result.error || "Failed to connect wallet");
    } else {
      setIsWalletModalOpen(false);
    }
  };

  // Display status text during connection/signing
  const getStatusText = () => {
    if (isConnecting) return "Connecting...";
    if (isSigning) return "Waiting for signature...";
    if (address) return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    return null;
  };

  // Handle features navigation with improved scroll
  const handleFeaturesClick = (e) => {
    e.preventDefault();
    smoothScrollTo('features', 30); // Use 30px extra padding for better visual effect

    // Close mobile menu if open
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  };

  // Function to handle wallet change - disconnect then show wallet selector
  const handleChangeWallet = async () => {
    // First disconnect current wallet
    await disconnect();

    // Small delay to ensure disconnection is processed
    setTimeout(() => {
      // For MetaMask, try to directly access wallet permission UI
      if (window.ethereum?.isMetaMask) {
        try {
          window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          }).catch(err => {
            console.log("Permission request failed, falling back to modal:", err);
            setConnectionError(null);
            setIsWalletModalOpen(true);
          });
        } catch (err) {
          console.error("Error requesting permissions:", err);
          setConnectionError(null);
          setIsWalletModalOpen(true);
        }
      } else {
        // For other wallets, use the modal
        setConnectionError(null);
        setIsWalletModalOpen(true);
      }
    }, 500);
  };

  // Function for direct MetaMask account switching
  const handleDirectAccountSwitch = async () => {
    if (!window.ethereum?.isMetaMask) {
      // Fall back to regular wallet change for non-MetaMask wallets
      handleChangeWallet();
      return;
    }

    try {
      // This will show the MetaMask account selector immediately
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      });

      // The accountsChanged event will handle updating the UI
    } catch (err) {
      console.error("Error switching accounts:", err);
      // Fall back to disconnect/reconnect flow if permission request fails
      handleChangeWallet();
    }
  };

  const toggleMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const isActive = (path) => {
    return pathname === path ? 'bg-blue-900 text-white' : 'text-blue-300 hover:bg-blue-800 hover:text-white';
  };

  const handleNavigation = (e, path) => {
    e.preventDefault();
    router.push(path);
  };

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${isScrolled ? 'py-3 bg-[var(--background)]/90 backdrop-blur-lg shadow-md' : 'py-5'}`}>
        <div className="container mx-auto px-4 flex justify-between items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">ID</span>
            </div>
            <span className="text-lg font-bold">BlockID</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6">
            <a
              href="#features"
              className="text-[var(--foreground)]/80 hover:text-[var(--foreground)] transition-colors"
              onClick={handleFeaturesClick}
            >
              Features
            </a>
            <Link href="/coinbase" className="text-[var(--foreground)]/80 hover:text-[var(--foreground)] transition-colors">
              Coinbase
            </Link>

            {/* Sepolia Testnet Indicator */}
            <div className="bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs px-2.5 py-1 rounded-full flex items-center">
              <span className="w-2 h-2 bg-amber-500 rounded-full mr-1.5 animate-pulse"></span>
              Sepolia Testnet
            </div>

            {/* Desktop Profile/Connect */}
            <div className="hidden md:block relative">
              {address ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      console.log("NAVIGATION DEBUG: Clicked profile dropdown");
                      setIsProfileDropdownOpen(!isProfileDropdownOpen);
                    }}
                    className="flex items-center space-x-2 bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70 rounded-full pr-3 pl-2 py-1.5 transition-all duration-200"
                  >
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center">
                      <span className="text-white font-bold text-xs">ID</span>
                    </div>
                    <span className="text-sm">
                      {truncateAddress(address)}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {isProfileDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-[var(--background)] rounded-md shadow-lg overflow-hidden z-10 border border-[var(--border)]">
                      <div className="py-1">
                        <Link
                          href="/dashboard"
                          className="block px-4 py-2 text-sm hover:bg-[var(--accent)]/10 hover:text-purple-500 transition-colors"
                          onClick={(e) => handleNavigation(e, '/dashboard')}
                        >
                          Dashboard
                        </Link>
                        {isAdminUser && (
                          <Link
                            href="/admin"
                            className="block px-4 py-2 text-sm hover:bg-[var(--accent)]/10 hover:text-purple-500 transition-colors"
                            onClick={(e) => handleNavigation(e, '/admin')}
                          >
                            <span className="flex items-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-purple-500" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              Admin Panel
                            </span>
                          </Link>
                        )}
                        <button
                          onClick={(e) => {
                            handleChangeWallet();
                            setIsProfileDropdownOpen(false);
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-blue-500 hover:text-blue-400 hover:bg-[var(--accent)]/10 transition-colors"
                        >
                          <span className="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                            Change Wallet
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            handleDirectAccountSwitch();
                            setIsProfileDropdownOpen(false);
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-indigo-500 hover:text-indigo-400 hover:bg-[var(--accent)]/10 transition-colors"
                        >
                          <span className="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Switch Account
                          </span>
                        </button>
                        <button
                          onClick={handleDisconnectWallet}
                          className="block w-full text-left px-4 py-2 text-sm text-red-500 hover:text-red-400 hover:bg-[var(--accent)]/10 transition-colors"
                        >
                          Disconnect Wallet
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    onClick={handleConnectWallet}
                    disabled={isConnecting || isSigning}
                    className={`bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-md 
                    transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 
                    focus:ring-purple-500 focus:ring-opacity-50 flex items-center ${(isConnecting || isSigning) ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {(isConnecting || isSigning) ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {isSigning ? "Signing..." : "Connecting..."}
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        {hasSession ? "Reconnect Wallet" : "Connect Wallet"}
                      </>
                    )}
                  </button>

                  {/* Reconnect Tip */}
                  {showReconnectTip && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-3 text-xs text-amber-800 dark:text-amber-200 shadow-lg">
                      <p className="flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Your wallet was disconnected. Please reconnect to continue your session.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden flex items-center"
            onClick={toggleMenu}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-[var(--background)]/95 backdrop-blur-lg shadow-lg py-4">
            <div className="container mx-auto px-4 flex flex-col space-y-4">
              <a
                href="#features"
                className="text-[var(--foreground)]/80 hover:text-[var(--foreground)] transition-colors py-2"
                onClick={handleFeaturesClick}
              >
                Features
              </a>
              <Link
                href="/coinbase"
                className="text-[var(--foreground)]/80 hover:text-[var(--foreground)] transition-colors py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Coinbase
              </Link>

              {/* Mobile Sepolia Indicator */}
              <div className="bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs px-2.5 py-1 rounded-full flex items-center self-start">
                <span className="w-2 h-2 bg-amber-500 rounded-full mr-1.5 animate-pulse"></span>
                Sepolia Testnet
              </div>

              {/* Mobile profile section */}
              {address && (
                <div className="py-2 border-t border-[var(--border)]">
                  <div className="flex items-center space-x-2 mb-3">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center">
                      <span className="text-white font-bold text-xs">ID</span>
                    </div>
                    <span className="text-sm text-green-400">
                      {truncateAddress(address)}
                    </span>
                  </div>
                  <Link
                    href="/dashboard"
                    className="block w-full text-left py-2 text-sm hover:text-purple-500 transition-colors"
                    onClick={(e) => handleNavigation(e, '/dashboard')}
                  >
                    Dashboard
                  </Link>
                  {isAdminUser && (
                    <Link
                      href="/admin"
                      className="block w-full text-left py-2 text-sm hover:text-purple-500 transition-colors"
                      onClick={(e) => handleNavigation(e, '/admin')}
                    >
                      <span className="flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-purple-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Admin Panel
                      </span>
                    </Link>
                  )}
                  <button
                    onClick={(e) => {
                      handleChangeWallet();
                      setIsMobileMenuOpen(false);
                    }}
                    className="block w-full text-left py-2 text-sm text-blue-500 hover:text-blue-400 transition-colors"
                  >
                    <span className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                      Change Wallet
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      handleDirectAccountSwitch();
                      setIsMobileMenuOpen(false);
                    }}
                    className="block w-full text-left py-2 text-sm text-indigo-500 hover:text-indigo-400 transition-colors"
                  >
                    <span className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Switch Account
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      handleDisconnectWallet();
                      setIsMobileMenuOpen(false);
                    }}
                    className="block w-full text-left py-2 text-sm text-red-500 hover:text-red-400 transition-colors"
                  >
                    Disconnect Wallet
                  </button>
                </div>
              )}

              {/* Auth buttons for mobile (when not connected) */}
              {!address && (
                <div className="pt-2 border-t border-[var(--border)]">
                  <button
                    onClick={(e) => {
                      setIsMobileMenuOpen(false);
                      handleConnectWallet();
                    }}
                    disabled={isConnecting || isSigning}
                    className={`w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-md 
                    transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 
                    focus:ring-purple-500 focus:ring-opacity-50 flex items-center justify-center ${(isConnecting || isSigning) ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {(isConnecting || isSigning) ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {isSigning ? "Signing..." : "Connecting..."}
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        {hasSession ? "Reconnect Wallet" : "Connect Wallet"}
                      </>
                    )}
                  </button>

                  {/* Reconnect explanation for mobile */}
                  {showReconnectTip && (
                    <div className="mt-2 p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded">
                      <p className="flex items-start">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Your wallet was disconnected. Please reconnect to continue your session.</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        wallets={availableWallets}
        onSelectWallet={handleWalletSelection}
        isConnecting={isConnecting}
        error={connectionError || walletError}
        isChangingWallet={!address && hasSession}
      />
    </>
  );
}
