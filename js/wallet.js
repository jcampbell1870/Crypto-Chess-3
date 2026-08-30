import { CONFIG } from './config.js';

// Thin wrapper around window.ethereum (MetaMask) connection handling.
export class Wallet {
  constructor({ onAccountChanged, onChainChanged } = {}) {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    this.onAccountChanged = onAccountChanged || (() => {});
    this.onChainChanged = onChainChanged || (() => {});

    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', (accounts) => {
        this.address = accounts[0] || null;
        this.onAccountChanged(this.address);
      });
      window.ethereum.on?.('chainChanged', (chainIdHex) => {
        this.chainId = parseInt(chainIdHex, 16);
        this.onChainChanged(this.chainId);
      });
    }
  }

  static isMetaMaskAvailable() {
    return typeof window.ethereum !== 'undefined';
  }

  async connect() {
    if (!Wallet.isMetaMaskAvailable()) {
      throw new Error(
        'MetaMask was not detected. Please install the MetaMask browser extension to play.'
      );
    }

    // Vendored js/vendor/ethers.esm.min.js is ethers v5.7.2, hence the
    // v5 provider/utils API used here and in token.js.
    const { ethers } = await import('./vendor/ethers.esm.min.js');
    this.provider = new ethers.providers.Web3Provider(window.ethereum, 'any');

    const accounts = await this.provider.send('eth_requestAccounts', []);
    this.address = accounts[0];
    this.signer = this.provider.getSigner();

    const network = await this.provider.getNetwork();
    this.chainId = network.chainId;

    return { address: this.address, chainId: this.chainId };
  }

  disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
  }

  isConnected() {
    return Boolean(this.address);
  }

  isOnExpectedNetwork() {
    return this.chainId === CONFIG.chainId;
  }

  async switchToExpectedNetwork() {
    if (!window.ethereum) return;
    const hexChainId = '0x' + CONFIG.chainId.toString(16);
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (error) {
      // 4902 = chain not added to MetaMask; nothing more we can safely do
      // without knowing RPC details for arbitrary chains.
      throw new Error(
        `Please switch MetaMask to ${CONFIG.chainName} to interact with the Arcade1870 token.`
      );
    }
  }
}
