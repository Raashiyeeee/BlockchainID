"use client";
import { ethers } from "ethers";
import BlockIDContract from '../artifacts/contracts/BlockID.sol/BlockID.json';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from './contexts/AuthContext';
import useWalletAuth from './hooks/useWalletAuth';
import Navbar from './components/Navbar';
import ParticleNebula from './components/ParticleNebula';
import { AnimatedText, AnimatedTitle } from './components/animations/AnimatedText';
import { AnimatedSection, AnimatedButton } from './components/animations/AnimatedSection';
import WalletConnectModal from './components/WalletConnectModal';
import { smoothScrollTo, handleHashNavigation } from './utils/scrollHelper';
import IDCardDisplay from './components/IDCardDisplay';
import { hasIdentity, getIdentityByOwner, getIdentityDetails } from '../utils/blockchain';

// Features data
const features = [
  {
    title: 'Decentralized Identity',
    description: 'Own your identity with blockchain-powered verification that puts you in control.',
    icon: 'shield-lock'
  },
  {
    title: 'Universal Access',
    description: 'One identity to access all your services with secure, passwordless authentication.',
    icon: 'key'
  },
  {
    title: 'Privacy Focused',
    description: 'Share only what you want, when you want, with zero-knowledge proofs.',
    icon: 'eye-off'
  },
  {
    title: 'Fraud Resistant',
    description: 'Immutable records and biometric verification prevent identity theft.',
    icon: 'fingerprint'
  }
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const {
    connect,
    disconnect,
    isConnecting,
    isSigning,
    address,
    availableWallets,
    error: walletError
  } = useWalletAuth();

  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [mintedIDCard, setMintedIDCard] = useState(null);
  const [hasWalletID, setHasWalletID] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [walletHasId, setWalletHasId] = useState(false);
  const [idData, setIdData] = useState(null);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    setMounted(true);

    // Initialize provider if window.ethereum is available
    if (typeof window !== 'undefined' && window.ethereum) {
      const ethersProvider = new ethers.BrowserProvider(window.ethereum);
      setProvider(ethersProvider);
    }

    // Handle hash navigation when page loads
    if (typeof window !== 'undefined') {
      // Check if there's a hash in the URL
      const hash = window.location.hash;
      if (hash && hash.includes('features')) {
        // Wait for everything to render properly
        setTimeout(() => {
          smoothScrollTo('features', 30);
        }, 500);
      }
    }

    // Initialize hash navigation on page load
    handleHashNavigation();

    // Check for hash navigation
    if (address) {
      checkWalletForId();
    }
  }, [address]);

  // Check if connected wallet has an ID card
  useEffect(() => {
    const checkForExistingID = async () => {
      if (address) {
        // First check localStorage for wallet-specific ID
        try {
          const existingCardData = localStorage.getItem('blockid_wallets') || '{}';
          const existingCards = JSON.parse(existingCardData);

          if (existingCards[address]) {
            console.log(`Found existing ID in wallet-specific storage for ${address}`);
            setMintedIDCard(existingCards[address]);
            setHasWalletID(true);
            return;
          }

          // Also check if there's a general card in local storage that matches this wallet
          const savedCard = localStorage.getItem('blockid_card');
          if (savedCard) {
            const cardData = JSON.parse(savedCard);
            if (cardData.walletAddress === address && cardData.isMinted) {
              console.log(`Found minted ID in general storage for ${address}`);
              setMintedIDCard(cardData);
              setHasWalletID(true);
              return;
            }
          }

          // If no ID found in localStorage, check blockchain
          const hasId = await hasIdentity(address);
          if (hasId) {
            // User has an existing ID on blockchain
            const idNumber = await getIdentityByOwner(address);
            if (idNumber > 0) {
              console.log(`Found ID #${idNumber} on chain for ${address}`);

              // Try to fetch full card data from IPFS
              let fullCard = null;
              try {
                const details = await getIdentityDetails(Number(idNumber));
                if (details && details.ipfsHash !== 'QmPlaceholderIPFSHash') {
                  fullCard = {
                    ...details,
                    idNumber: `BID-${idNumber.toString().padStart(6, '0')}`,
                    walletAddress: address,
                    isMinted: true
                  };
                  console.log('Home page: full card loaded from IPFS:', fullCard.fullName);
                  // Cache it so next load is instant
                  try {
                    const walletsData = JSON.parse(localStorage.getItem('blockid_wallets') || '{}');
                    walletsData[address] = fullCard;
                    localStorage.setItem('blockid_wallets', JSON.stringify(walletsData));
                  } catch (_) { }
                }
              } catch (ipfsErr) {
                console.warn('Home page: could not fetch IPFS data:', ipfsErr.message);
              }

              const cardToShow = fullCard || {
                idNumber: `BID-${idNumber.toString().padStart(6, '0')}`,
                walletAddress: address,
                createdAt: new Date().toISOString(),
                role: 'Personal ID',
                organization: 'Sepolia Network Authority',
                isMinted: true,
              };
              setMintedIDCard(cardToShow);
              setHasWalletID(true);
              return;
            }
          }

          // No ID found
          setHasWalletID(false);
          setMintedIDCard(null);
        } catch (error) {
          console.error("Error checking for existing ID:", error);
          setHasWalletID(false);
          setMintedIDCard(null);
        }
      } else {
        // No wallet connected
        setHasWalletID(false);
        setMintedIDCard(null);
      }
    };

    checkForExistingID();
  }, [address]);

  // Function to handle wallet connection / dashboard navigation
  const handleConnectWallet = async () => {
    try {
      if (isAuthenticated || address) {
        // User is already connected — go to dashboard
        router.push('/dashboard');
        return;
      }

      // Clear any previous connection error
      setConnectionError(null);

      // Open wallet selection modal if multiple wallets available
      if (availableWallets.length > 1) {
        setIsWalletModalOpen(true);
      } else {
        // Connect with default wallet (single wallet or no explicit list yet)
        const result = await connect();
        if (result?.cancelled) {
          // User pressed Cancel in MetaMask — do nothing, don't show an error banner
          return;
        }
        if (!result?.success && result?.availableWallets?.length > 0) {
          setIsWalletModalOpen(true);
        } else if (!result?.success) {
          setConnectionError(result?.error || 'Failed to connect wallet');
        } else if (result?.success) {
          // Successfully connected — navigate to dashboard
          router.push('/dashboard');
        }
      }
    } catch (err) {
      // Catch any unexpected synchronous throw from wallet extensions
      const isRejection =
        err?.code === 4001 ||
        err?.code === 'ACTION_REJECTED' ||
        err?.message?.toLowerCase().includes('user rejected') ||
        err?.message?.toLowerCase().includes('user denied') ||
        err?.message?.toLowerCase().includes('rejected connection');

      if (!isRejection) {
        console.error('handleConnectWallet unexpected error:', err);
        setConnectionError(err?.message || 'Could not connect wallet. Please try again.');
      }
      // Rejections are silently ignored (user just clicked Cancel)
    }
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

  // Handle smooth scrolling to features section
  const handleScrollToFeatures = (e) => {
    e.preventDefault();
    smoothScrollTo('features', 30);
  };

  // Check if wallet has an existing ID
  const checkWalletForId = async () => {
    if (!address) return;

    try {
      // First check localStorage
      const storedIDs = JSON.parse(localStorage.getItem('blockid_wallets') || '{}');
      if (storedIDs[address]) {
        setWalletHasId(true);
        setIdData(storedIDs[address]);
        return;
      }

      // Then check blockchain if provider is available
      if (provider) {
        const contract = new ethers.Contract(
          process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
          BlockIDContract.abi,
          provider
        );

        const hasID = await contract.hasIdentity(address);
        if (hasID) {
          setWalletHasId(true);
          // If possible, fetch ID data from blockchain
          try {
            const idHash = await contract.getIdentityHash(address);
            if (idHash) {
              // Try to get from IPFS or other storage if available
              // For now, just set a placeholder
              setIdData({
                fullName: "ID Owner",
                idNumber: "ID on blockchain",
                dateOfBirth: new Date().toISOString().split('T')[0],
                expiryDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                photoUrl: "/placeholder-photo.jpg",
                walletAddress: address,
                isMinted: true
              });
            }
          } catch (error) {
            console.error("Error fetching ID data:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error checking wallet for ID:", error);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--background)] relative overflow-hidden">
      <Navbar />

      {/* Particle Nebula Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
        <ParticleNebula expandTop={true} className="z-0" />
      </div>

      {/* Hero Section */}
      <section className="relative pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden px-4">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="w-full md:w-1/2 mb-10 md:mb-0">
              <AnimatedTitle className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
                <span>Secure Digital</span>
                <span className="gradient-text">Identity</span>
                <span>on the Blockchain</span>
              </AnimatedTitle>

              <AnimatedText className="text-lg md:text-xl text-[var(--muted-foreground)] mb-8 max-w-lg">
                Take control of your digital identity with BlockID. Secure, portable, and privacy-focused authentication for the Web3 era.
              </AnimatedText>

              <div className="flex flex-col sm:flex-row gap-4">
                <AnimatedButton delay={0.1}>
                  <button
                    onClick={handleConnectWallet}
                    disabled={isConnecting || isSigning}
                    className={`btn-primary px-8 py-3 text-center flex items-center justify-center ${(isConnecting || isSigning) ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isConnecting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Connecting...
                      </>
                    ) : isSigning ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Signing...
                      </>
                    ) : isAuthenticated ? (
                      <>
                        Go to Dashboard
                        <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    ) : (
                      <>
                        Connect Wallet
                        <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </button>
                </AnimatedButton>

                <AnimatedButton delay={0.2}>
                  <a href="#features" onClick={handleScrollToFeatures} className="btn-secondary px-8 py-3 text-center">
                    Learn More
                  </a>
                </AnimatedButton>
              </div>
            </div>

            <div className="w-full md:w-1/2 flex justify-center md:justify-end">
              <div className="relative w-full max-w-md">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-600 to-violet-600 opacity-20 blur-2xl"></div>
                <div className="relative glass-card p-6 rounded-2xl float-animation">
                  <div className="bg-gradient-to-br from-purple-600 to-violet-800 p-1 rounded-xl overflow-hidden">
                    <div className="bg-[var(--card)] rounded-lg overflow-hidden">
                      {/* Demo card header */}
                      <div className="p-4">
                        <div className="flex items-center mb-3">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center mr-3">
                            <span className="text-white font-bold text-lg">ID</span>
                          </div>
                          <div>
                            <h3 className="text-lg font-bold">BlockID</h3>
                            <p className="text-xs text-[var(--muted-foreground)]">Blockchain Verified Digital Identity</p>
                          </div>
                        </div>

                        {/* Card demo content */}
                        <div className="flex items-start">
                          <div className="flex-shrink-0 h-20 w-20 rounded-lg overflow-hidden mr-3 border border-[var(--border)]">
                            {/* Demo photo placeholder */}
                            <div className="h-full w-full bg-gradient-to-br from-purple-900/30 to-violet-900/30 flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-purple-300/50" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </div>

                          <div>
                            <h3 className="text-base font-semibold">Alex Johnson</h3>
                            <p className="text-xs text-[var(--muted-foreground)]">Personal ID</p>
                            <p className="text-xs mt-1">Sepolia Network Authority</p>
                            <div className="mt-2 flex items-center">
                              <div className="h-4 w-4 bg-green-500 rounded-full flex items-center justify-center mr-1">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <span className="text-[10px] text-green-400">Verified</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card footer */}
                      <div className="h-2 bg-gradient-to-r from-purple-600 via-violet-600 to-violet-800"></div>
                    </div>
                  </div>
                  <div className="text-center mt-2 text-sm text-[var(--muted-foreground)]">
                    Build your secure blockchain identity today
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Minted ID Card Display - only visible when wallet is connected and has a minted ID */}
      {address && hasWalletID && mintedIDCard && (
        <section className="py-12 relative z-10">
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-2">Your Digital ID</h2>
              <p className="text-[var(--muted-foreground)]">Your wallet has a minted BlockID card</p>
            </div>
            <div className="max-w-2xl mx-auto">
              <IDCardDisplay idData={mintedIDCard} />
              <div className="mt-6 text-center">
                <Link href="/dashboard" className="inline-flex items-center btn-primary px-6 py-2">
                  View in Dashboard
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Features Section */}
      <section id="features" className="py-20 bg-[var(--background-secondary)] relative z-10">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Why Choose <span className="gradient-text">BlockID</span>
            </h2>
            <p className="text-[var(--muted-foreground)] max-w-2xl mx-auto">
              Our blockchain-based identity solution provides security and convenience without compromising your privacy.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="glass-card p-6 rounded-xl hover:shadow-lg transition-all duration-300">
                <div className="bg-gradient-to-br from-purple-600 to-violet-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                  <span className="text-white text-xl">
                    <IconByName name={feature.icon} />
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-[var(--muted-foreground)]">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <AnimatedSection className="relative py-16 md:py-24 px-4 bg-[var(--card)]/50">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              How <span className="gradient-text">BlockID</span> Works
            </h2>
            <p className="text-[var(--muted-foreground)] max-w-2xl mx-auto">
              Experience a seamless authentication process with our blockchain-powered identity solution.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-card p-6 rounded-xl relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white font-bold">1</div>
              <h3 className="text-xl font-semibold mb-3 mt-2">Connect Your Wallet</h3>
              <p className="text-[var(--muted-foreground)]">Link your cryptocurrency wallet to establish your unique blockchain identity.</p>
            </div>

            <div className="glass-card p-6 rounded-xl relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white font-bold">2</div>
              <h3 className="text-xl font-semibold mb-3 mt-2">Verify Your Identity</h3>
              <p className="text-[var(--muted-foreground)]">Complete a one-time verification process to secure your digital identity.</p>
            </div>

            <div className="glass-card p-6 rounded-xl relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-white font-bold">3</div>
              <h3 className="text-xl font-semibold mb-3 mt-2">Authenticate Anywhere</h3>
              <p className="text-[var(--muted-foreground)]">Use your BlockID to securely access supported websites and services.</p>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* CTA Section */}
      <AnimatedSection className="relative py-16 md:py-24 px-4">
        <div className="container mx-auto">
          <div className="glass-card p-8 md:p-12 rounded-2xl bg-gradient-to-br from-[rgba(139,92,246,0.1)] to-[rgba(124,58,237,0.05)]">
            <div className="flex flex-col md:flex-row items-center justify-between">
              <div className="mb-8 md:mb-0 md:mr-8">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  Ready to take control of your <span className="gradient-text">digital identity</span>?
                </h2>
                <p className="text-[var(--muted-foreground)] max-w-xl">
                  Join thousands of users who have already secured their online presence with BlockID.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleConnectWallet}
                  disabled={isConnecting || isSigning}
                  className={`btn-primary px-8 py-3 text-center whitespace-nowrap flex items-center justify-center ${(isConnecting || isSigning) ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isConnecting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </>
                  ) : isSigning ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Signing...
                    </>
                  ) : isAuthenticated ? (
                    <>
                      Go to Dashboard
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  ) : (
                    <>
                      Connect Wallet
                      <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>

                <a href="#features" onClick={handleScrollToFeatures} className="btn-secondary px-8 py-3 text-center whitespace-nowrap">
                  Learn More
                </a>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* Footer */}
      <footer className="relative py-12 px-4 border-t border-[var(--border)]">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-8 md:mb-0">
              <Link href="/" className="flex items-center space-x-2 mb-4">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">ID</span>
                </div>
                <span className="text-lg font-bold">BlockID</span>
              </Link>
              <p className="text-[var(--muted-foreground)] max-w-md">
                Secure, portable, and privacy-focused blockchain identity for the Web3 era.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
              <div>
                <h3 className="font-semibold mb-4">Product</h3>
                <ul className="space-y-2">
                  <li><Link href="/features" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Features</Link></li>
                  <li><Link href="/pricing" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Pricing</Link></li>
                  <li><Link href="/docs" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Documentation</Link></li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold mb-4">Company</h3>
                <ul className="space-y-2">
                  <li><Link href="/about" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">About Us</Link></li>
                  <li><Link href="/blog" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Blog</Link></li>
                  <li><Link href="/careers" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Careers</Link></li>
                </ul>
              </div>

              <div className="col-span-2 md:col-span-1">
                <h3 className="font-semibold mb-4">Connect</h3>
                <ul className="space-y-2">
                  <li><Link href="/contact" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Contact Us</Link></li>
                  <li><Link href="https://twitter.com/blockid" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Twitter</Link></li>
                  <li><Link href="https://github.com/blockid" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">GitHub</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border)] mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-[var(--muted-foreground)] mb-4 md:mb-0">
              © {new Date().getFullYear()} BlockID. All rights reserved.
            </p>

            <div className="flex space-x-6">
              <Link href="/privacy" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        wallets={availableWallets}
        onSelectWallet={handleWalletSelection}
        isConnecting={isConnecting}
        error={connectionError || walletError}
      />
    </main>
  );
}

// Helper component for icons
function IconByName({ name }) {
  switch (name) {
    case 'shield-lock':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          <rect x="8" y="11" width="8" height="5" rx="1"></rect>
          <path d="M12 8v3"></path>
        </svg>
      );
    case 'key':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
        </svg>
      );
    case 'eye-off':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      );
    case 'fingerprint':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      );
    default:
      return null;
  }
} 