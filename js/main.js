import { CONFIG } from './config.js';
import { Wallet } from './wallet.js';
import { Token } from './token.js';
import { Board } from './board.js';

const els = {
  connectBtn: document.getElementById('connect-wallet'),
  walletStatus: document.getElementById('wallet-status'),
  networkWarning: document.getElementById('network-warning'),
  switchNetworkBtn: document.getElementById('switch-network'),
  turnStatus: document.getElementById('turn-status'),
  gameStatus: document.getElementById('game-status'),
  newGameBtn: document.getElementById('new-game'),
  balance: document.getElementById('token-balance'),
  claimBtn: document.getElementById('claim-reward'),
  claimStatus: document.getElementById('claim-status'),
  board: document.getElementById('board'),
};

const wallet = new Wallet({
  onAccountChanged: (address) => {
    updateWalletUI();
    if (address) refreshBalance();
  },
  onChainChanged: () => {
    wallet.connect().then(updateWalletUI).catch(() => {});
  },
});

const token = new Token(wallet);
let rewardEligible = false;

function updateWalletUI() {
  if (wallet.isConnected()) {
    const short = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
    els.connectBtn.textContent = 'Connected';
    els.connectBtn.disabled = true;
    els.walletStatus.textContent = `Connected as ${short}`;

    const onExpectedNetwork = wallet.isOnExpectedNetwork();
    els.networkWarning.hidden = onExpectedNetwork;
    els.claimBtn.disabled = !onExpectedNetwork || !rewardEligible || !token.isRewardVaultConfigured();
  } else {
    els.connectBtn.textContent = 'Connect MetaMask';
    els.connectBtn.disabled = false;
    els.walletStatus.textContent = 'Not connected';
    els.networkWarning.hidden = true;
    els.balance.textContent = '—';
    els.claimBtn.disabled = true;
  }
}

async function refreshBalance() {
  if (!wallet.isConnected() || !wallet.isOnExpectedNetwork()) return;
  try {
    await token.loadMetadata();
    const balance = await token.getBalance();
    els.balance.textContent = `${Number(balance).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    })} ${token.symbol}`;
  } catch (error) {
    console.warn('Unable to fetch Arcade1870 balance:', error);
    els.balance.textContent = 'Unavailable';
  }
}

els.connectBtn.addEventListener('click', async () => {
  els.walletStatus.textContent = 'Connecting…';
  try {
    await wallet.connect();
    updateWalletUI();
    await refreshBalance();
  } catch (error) {
    els.walletStatus.textContent = error.message;
  }
});

els.switchNetworkBtn.addEventListener('click', async () => {
  try {
    await wallet.switchToExpectedNetwork();
  } catch (error) {
    els.walletStatus.textContent = error.message;
  }
});

els.claimBtn.addEventListener('click', async () => {
  els.claimStatus.textContent = 'Confirm the transaction in MetaMask…';
  els.claimBtn.disabled = true;
  try {
    const txHash = await token.claimPlayReward();
    els.claimStatus.textContent = `Reward claimed! Tx: ${txHash.slice(0, 10)}…`;
    rewardEligible = false;
    await refreshBalance();
  } catch (error) {
    els.claimStatus.textContent = error.message;
    els.claimBtn.disabled = false;
  }
});

const board = new Board(els.board, {
  onMove: () => {
    els.turnStatus.textContent = `${board.game.turn() === 'w' ? 'White' : 'Black'} to move`;
    els.gameStatus.textContent = board.game.in_check() ? 'Check!' : '';
  },
  onGameOver: (reason) => {
    els.gameStatus.textContent = reason;
    els.turnStatus.textContent = 'Game over';
    rewardEligible = true;
    if (wallet.isConnected() && wallet.isOnExpectedNetwork() && token.isRewardVaultConfigured()) {
      els.claimBtn.disabled = false;
    }
    els.claimStatus.textContent = !token.isRewardVaultConfigured()
      ? 'Reward vault setup is pending. The owner must configure its deployed address and secure issuer URL.'
      : wallet.isConnected()
      ? 'You earned an Arcade1870 reward for playing — claim it below!'
      : 'Connect your wallet to claim your Arcade1870 reward for playing!';
  },
});

els.newGameBtn.addEventListener('click', () => {
  board.reset();
  rewardEligible = false;
  els.turnStatus.textContent = 'White to move';
  els.gameStatus.textContent = '';
  els.claimStatus.textContent = '';
  updateWalletUI();
});

// Initial UI state.
updateWalletUI();
els.turnStatus.textContent = 'White to move';
document.getElementById('token-address').textContent = CONFIG.tokenAddress;
document.getElementById('reward-vault-address').textContent =
  CONFIG.rewardVaultAddress || 'Not configured';
