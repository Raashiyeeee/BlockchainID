"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function WalletConnectModal({
  isOpen,
  onClose,
  wallets,
  onSelectWallet,
  isConnecting,
  error,
  isChangingWallet = false
}) {
  const [selectedWalletIndex, setSelectedWalletIndex] = useState(null);

  // Reset selected wallet when modal opens or autoselect if there's only one / MetaMask is first
  useEffect(() => {
    if (isOpen) {
      if (wallets.length === 1) {
        // Auto-select if there's only one wallet
        setSelectedWalletIndex(0);
      } else if (wallets.length > 1 && wallets[0]?.name === 'MetaMask') {
        // Pre-select MetaMask when it's sorted to the top
        setSelectedWalletIndex(0);
      } else {
        setSelectedWalletIndex(null);
      }
    }
  }, [isOpen, wallets]);

  // Handle wallet selection
  const handleSelectWallet = (index) => {
    setSelectedWalletIndex(index);
  };

  // Handle connect button click
  const handleConnect = () => {
    if (selectedWalletIndex !== null) {
      onSelectWallet(selectedWalletIndex);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative bg-[var(--card)] rounded-xl shadow-xl w-full max-w-md overflow-hidden"
          >
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b border-[var(--border)]">
              <h3 className="text-lg font-semibold">
                {isChangingWallet ? 'Change Wallet' : 'Connect Wallet'}
              </h3>
              <button
                onClick={onClose}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-full p-1 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
                  {error}
                </div>
              )}

              <p className="mb-4 text-[var(--muted-foreground)]">
                {isChangingWallet
                  ? 'Select a different wallet to connect to BlockID.'
                  : 'Select a wallet to connect to BlockID. You will be asked to approve the connection in your wallet.'
                }
              </p>

              {/* Wallet options */}
              <div className="space-y-2 mb-4">
                {wallets.map((wallet, index) => (
                  <button
                    key={wallet.name}
                    onClick={() => handleSelectWallet(index)}
                    className={`w-full flex items-center p-3 rounded-lg transition-colors ${selectedWalletIndex === index
                        ? 'bg-purple-500/10 border border-purple-500/50'
                        : 'bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 border border-transparent'
                      }`}
                  >
                    <img
                      src={wallet.icon || '/images/wallets/ethereum.svg'}
                      alt={wallet.name}
                      className="w-6 h-6 mr-3"
                    />
                    <span className="font-medium">{wallet.name}</span>

                    {selectedWalletIndex === index && (
                      <svg className="ml-auto w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              {/* Connect button */}
              <button
                onClick={handleConnect}
                disabled={selectedWalletIndex === null || isConnecting}
                className={`w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2.5 px-4 rounded-lg 
                transition-all duration-200 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 
                focus:ring-purple-500 focus:ring-opacity-50 flex items-center justify-center 
                ${(selectedWalletIndex === null || isConnecting) ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </button>

              {/* Help text */}
              {wallets.length === 0 && (
                <div className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
                  <p>Don't have a wallet?</p>
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-500 hover:text-purple-600 font-medium inline-flex items-center mt-1"
                  >
                    Install MetaMask
                    <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
} 