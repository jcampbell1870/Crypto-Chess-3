import { CONFIG } from './config.js';
import { Wallet } from './wallet.js';
import { Token } from './token.js';
import { Board } from './board.js';
import { findBestMove } from './ai.js';

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
  vsComputer: document.getElementById('vs-computer'),
  aiDifficulty: document.getElementById('ai-difficulty'),
  aiSide: document.getElementById('ai-side'),
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
let rewardGame = null;
let vsComputer = false;
let humanColor = 'w';

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
    const txHash = await token.claimPlayReward(rewardGame);
    rewardEligible = false;
    let walletAssetAdded = false;
    try {
      walletAssetAdded = await token.addToWallet();
    } catch (error) {
      console.warn('Unable to add Arcade1870 to MetaMask:', error);
    }
    try {
      await refreshBalance();
    } catch (error) {
      console.warn('Unable to refresh Arcade1870 balance:', error);
    }
    els.claimStatus.textContent = walletAssetAdded
      ? `Reward claimed and ARC added to MetaMask! Tx: ${txHash.slice(0, 10)}…`
      : `Reward claimed! Add ARC token ${CONFIG.tokenAddress} to MetaMask if it is not visible. Tx: ${txHash.slice(0, 10)}…`;
  } catch (error) {
    els.claimStatus.textContent = error.message;
    els.claimBtn.disabled = false;
  }
});

function aiColor() {
  return humanColor === 'w' ? 'b' : 'w';
}

// If it's the computer's turn, let it "think" briefly (so the status
// message is visible) and then play a move via the built-in AI.
function maybeTriggerAiMove() {
  if (!vsComputer) return;
  if (board.game.game_over()) return;
  if (board.game.turn() !== aiColor()) return;

  els.turnStatus.textContent = 'Computer is thinking…';
  els.newGameBtn.disabled = true;
  setTimeout(() => {
    const move = findBestMove(board.game.fen(), els.aiDifficulty.value);
    if (move) board.applyMove(move);
    els.newGameBtn.disabled = false;
  }, 250);
}

const board = new Board(els.board, {
  onMove: () => {
    els.turnStatus.textContent = `${board.game.turn() === 'w' ? 'White' : 'Black'} to move`;
    els.gameStatus.textContent = board.game.in_check() ? 'Check!' : '';
    maybeTriggerAiMove();
  },
  onGameOver: (reason) => {
    els.gameStatus.textContent = reason;
    els.turnStatus.textContent = 'Game over';
    rewardEligible = true;
    rewardGame = {
      pgn: board.game.pgn(),
      fen: board.game.fen(),
    };
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

function startNewGame() {
  board.reset();
  rewardEligible = false;
  rewardGame = null;
  els.turnStatus.textContent = 'White to move';
  els.gameStatus.textContent = '';
  els.claimStatus.textContent = '';
  updateWalletUI();
  maybeTriggerAiMove();
}

els.newGameBtn.addEventListener('click', startNewGame);

els.vsComputer.addEventListener('change', () => {
  vsComputer = els.vsComputer.checked;
  els.aiDifficulty.disabled = !vsComputer;
  els.aiSide.disabled = !vsComputer;
  maybeTriggerAiMove();
});

els.aiSide.addEventListener('change', () => {
  humanColor = els.aiSide.value;
  startNewGame();
});

// Initial UI state.
updateWalletUI();
els.turnStatus.textContent = 'White to move';
document.getElementById('token-address').textContent = CONFIG.tokenAddress;
document.getElementById('reward-vault-address').textContent =
  CONFIG.rewardVaultAddress || 'Not configured';
