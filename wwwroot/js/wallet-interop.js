// Bridges MetaMask (window.ethereum) into the Blazor Server "WalletService"
// via JS interop, mirroring Crypto Hockey's wwwroot/js/metamask-interop.js.
import { CONFIG } from './config.js';

let currentAccount = null;
let currentChainId = null;

function chainIdToDecimal(hexChainId) {
    return parseInt(hexChainId, 16);
}

function findNetwork(chainId) {
    return CONFIG.supportedNetworks.find((n) => n.chainId === chainId);
}

function toState(address, chainId) {
    const network = findNetwork(chainId);
    return {
        isConnected: !!address,
        address: address || null,
        chainId: chainId || 0,
        chainName: network ? network.chainName : `Chain ${chainId}`,
        balance: 0,
    };
}

async function refreshAccountAndChain() {
    if (!window.ethereum) return;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    currentAccount = accounts && accounts.length > 0 ? accounts[0] : null;
    const hexChainId = await window.ethereum.request({ method: 'eth_chainId' });
    currentChainId = chainIdToDecimal(hexChainId);
}

window.metamaskInterop = {
    isMetaMaskInstalled() {
        return typeof window.ethereum !== 'undefined';
    },

    async connectWallet() {
        if (!window.ethereum) {
            return toState(null, null);
        }

        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            currentAccount = accounts && accounts.length > 0 ? accounts[0] : null;
            const hexChainId = await window.ethereum.request({ method: 'eth_chainId' });
            currentChainId = chainIdToDecimal(hexChainId);
            return toState(currentAccount, currentChainId);
        } catch (err) {
            console.error('metamask-interop: connectWallet failed', err);
            return toState(null, null);
        }
    },

    async getWalletState() {
        if (!window.ethereum) {
            return toState(null, null);
        }

        try {
            await refreshAccountAndChain();
            return toState(currentAccount, currentChainId);
        } catch (err) {
            console.error('metamask-interop: getWalletState failed', err);
            return toState(null, null);
        }
    },

    async disconnectWallet() {
        currentAccount = null;
        currentChainId = null;
    },

    async switchNetwork(chainId) {
        if (!window.ethereum) return false;

        const network = findNetwork(chainId);
        const hexChainId = `0x${chainId.toString(16)}`;

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: hexChainId }],
            });
            currentChainId = chainId;
            return true;
        } catch (switchError) {
            // Chain not added to MetaMask yet — add it, then retry the switch.
            if (switchError.code === 4902 && network) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: hexChainId,
                            chainName: network.chainName,
                            nativeCurrency: network.nativeCurrency,
                            rpcUrls: network.rpcUrls,
                            blockExplorerUrls: network.blockExplorerUrls,
                        }],
                    });
                    currentChainId = chainId;
                    return true;
                } catch (addError) {
                    console.error('metamask-interop: addEthereumChain failed', addError);
                    return false;
                }
            }

            console.error('metamask-interop: switchNetwork failed', switchError);
            return false;
        }
    },
};

if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on('accountsChanged', () => {
        // Consumers re-fetch state via getWalletState() on their next render;
        // nothing else to do here since Blazor Server owns UI state.
    });
    window.ethereum.on('chainChanged', () => {
        // Same as above — avoid forcing a full page reload in a Blazor SPA.
    });
}
