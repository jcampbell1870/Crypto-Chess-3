import { CONFIG } from './config.js';
import { Wallet } from './wallet.js';
import { Token } from './token.js';
import { Board } from './board.js';
import { findBestMove } from './ai.js';
import { OnlineService } from './online.js';

const STORAGE_KEYS = {
  playerId: 'cryptoChessPlayerId',
  playerName: 'cryptoChessPlayerName',
  activeMatchId: 'cryptoChessActiveMatchId',
  activeTournamentId: 'cryptoChessActiveTournamentId',
  activeTournamentMatchId: 'cryptoChessActiveTournamentMatchId',
};

const ONLINE_POLL_INTERVAL_MS = 3000;

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
  tokenAddress: document.getElementById('token-address'),
  rewardVaultAddress: document.getElementById('reward-vault-address'),
  localControls: document.getElementById('local-controls'),
  modeBanner: document.getElementById('mode-banner'),
  opponentStatus: document.getElementById('opponent-status'),
  returnLocalBtn: document.getElementById('return-local'),
  playerName: document.getElementById('player-name'),
  savePlayerBtn: document.getElementById('save-player'),
  onlineStatus: document.getElementById('online-status'),
  matchList: document.getElementById('match-list'),
  tournamentList: document.getElementById('tournament-list'),
  createMatchBtn: document.getElementById('create-match'),
  createTournamentBtn: document.getElementById('create-tournament'),
  tournamentStage: document.getElementById('tournament-stage'),
  tournamentStageStatus: document.getElementById('tournament-stage-status'),
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
const online = new OnlineService();

let rewardEligible = false;
let rewardGame = null;
let vsComputer = false;
let humanColor = 'w';
let currentMode = 'local';
let playerId = loadStoredValue(STORAGE_KEYS.playerId);
let playerName = loadStoredValue(STORAGE_KEYS.playerName);
let activeMatchId = loadStoredValue(STORAGE_KEYS.activeMatchId);
let activeTournamentId = loadStoredValue(STORAGE_KEYS.activeTournamentId);
let activeTournamentMatchId = loadStoredValue(STORAGE_KEYS.activeTournamentMatchId);
let onlinePollHandle = null;
let onlineRefreshInFlight = false;
let pendingRemoteMove = false;
let lobbySnapshot = null;
let activeMatchSnapshot = null;
let activeTournamentSnapshot = null;

function loadStoredValue(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function storeValue(key, value) {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

function colorName(color) {
  return color === 'w' ? 'White' : color === 'b' ? 'Black' : 'Observer';
}

function normalizePlayerName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function setOnlineStatus(message, isError = false) {
  els.onlineStatus.textContent = message;
  els.onlineStatus.classList.toggle('error-text', isError);
}

function clearRewardState() {
  rewardEligible = false;
  rewardGame = null;
  els.claimStatus.textContent = '';
  updateWalletUI();
}

function setRewardFromCompletedGame({ pgn, fen }) {
  rewardEligible = true;
  rewardGame = { pgn, fen };
  if (wallet.isConnected() && wallet.isOnExpectedNetwork() && token.isRewardVaultConfigured()) {
    els.claimBtn.disabled = false;
  }
  els.claimStatus.textContent = !token.isRewardVaultConfigured()
    ? 'Reward vault setup is pending. The owner must configure its deployed address and secure issuer URL.'
    : wallet.isConnected()
    ? 'You earned an Arcade1870 reward for playing — claim it below!'
    : 'Connect your wallet to claim your Arcade1870 reward for playing!';
}

function updateLocalBoardInteractivity() {
  if (currentMode !== 'local') return;
  const humanTurn = !vsComputer || board.game.turn() === humanColor;
  board.setInteractive(!board.game.game_over() && humanTurn);
}

function setModeBanner(text, secondary = '') {
  els.modeBanner.textContent = text;
  els.opponentStatus.textContent = secondary;
}

function setLocalModeUi() {
  currentMode = 'local';
  pendingRemoteMove = false;
  els.returnLocalBtn.hidden = true;
  els.localControls.classList.remove('controls-disabled');
  els.vsComputer.disabled = false;
  els.aiDifficulty.disabled = !vsComputer;
  els.aiSide.disabled = !vsComputer;
  els.newGameBtn.disabled = false;
  setModeBanner(vsComputer ? 'Local vs Computer' : 'Local Pass-and-Play', vsComputer ? `You are ${colorName(humanColor)}.` : 'Two players share the same device.');
  updateLocalBoardInteractivity();
}

function setOnlineModeUi(title, subtitle) {
  els.returnLocalBtn.hidden = false;
  els.localControls.classList.add('controls-disabled');
  els.vsComputer.disabled = true;
  els.aiDifficulty.disabled = true;
  els.aiSide.disabled = true;
  els.newGameBtn.disabled = true;
  setModeBanner(title, subtitle);
}

function maybeTriggerAiMove() {
  if (currentMode !== 'local') return;
  if (!vsComputer) {
    updateLocalBoardInteractivity();
    return;
  }
  if (board.game.game_over()) {
    updateLocalBoardInteractivity();
    return;
  }
  if (board.game.turn() !== aiColor()) {
    updateLocalBoardInteractivity();
    return;
  }

  board.setInteractive(false);
  els.turnStatus.textContent = 'Computer is thinking…';
  els.newGameBtn.disabled = true;
  setTimeout(() => {
    const move = findBestMove(board.game.fen(), els.aiDifficulty.value);
    if (move) board.applyMove(move);
    els.newGameBtn.disabled = false;
    updateLocalBoardInteractivity();
  }, 250);
}

function aiColor() {
  return humanColor === 'w' ? 'b' : 'w';
}

const board = new Board(els.board, {
  onMove: (move) => {
    if (currentMode === 'online-match') {
      submitHeadsUpMove(move);
      return;
    }
    if (currentMode === 'online-tournament') {
      submitTournamentMove(move);
      return;
    }
    els.turnStatus.textContent = `${board.game.turn() === 'w' ? 'White' : 'Black'} to move`;
    els.gameStatus.textContent = board.game.in_check() ? 'Check!' : '';
    maybeTriggerAiMove();
  },
  onGameOver: (reason) => {
    if (currentMode !== 'local') return;
    els.gameStatus.textContent = reason;
    els.turnStatus.textContent = 'Game over';
    setRewardFromCompletedGame({
      pgn: board.game.pgn(),
      fen: board.game.fen(),
    });
  },
});

function startNewGame() {
  board.reset();
  clearRewardState();
  els.turnStatus.textContent = 'White to move';
  els.gameStatus.textContent = '';
  setLocalModeUi();
  maybeTriggerAiMove();
}

function switchToLocalBoard() {
  activeTournamentMatchId = '';
  storeValue(STORAGE_KEYS.activeTournamentMatchId, '');
  startNewGame();
}

function resetActiveMatchSelection() {
  activeMatchId = '';
  activeMatchSnapshot = null;
  storeValue(STORAGE_KEYS.activeMatchId, '');
}

function resetActiveTournamentSelection() {
  activeTournamentId = '';
  activeTournamentMatchId = '';
  activeTournamentSnapshot = null;
  storeValue(STORAGE_KEYS.activeTournamentId, '');
  storeValue(STORAGE_KEYS.activeTournamentMatchId, '');
}

function requirePlayerProfile() {
  if (!playerId || !playerName) {
    throw new Error('Save a screen name before entering the online lobby.');
  }
}

async function savePlayerProfile({ silent = false } = {}) {
  const name = normalizePlayerName(els.playerName.value);
  if (name.length < 3) {
    setOnlineStatus('Choose a screen name with at least 3 characters.', true);
    return;
  }

  if (!silent) {
    setOnlineStatus('Saving your lobby profile…');
  }

  try {
    const response = await online.upsertPlayer({ playerId, name });
    playerId = response.player.id;
    playerName = response.player.name;
    els.playerName.value = playerName;
    storeValue(STORAGE_KEYS.playerId, playerId);
    storeValue(STORAGE_KEYS.playerName, playerName);
    setOnlineStatus(`Welcome to the online arena, ${playerName}.`);
    ensureOnlinePolling();
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

function matchActionLabel(match) {
  if (match.isParticipant) return 'Resume';
  if (match.status === 'waiting' && match.seatsTaken < match.seatLimit) return 'Join Table';
  if (match.status === 'complete') return 'Review';
  return 'View';
}

function tournamentActionLabel(tournament) {
  if (tournament.yourStatus?.joined) return 'View Bracket';
  if (tournament.status === 'registration' && tournament.seatsTaken < tournament.seatLimit) return 'Join Event';
  return 'View Bracket';
}

function renderMatchList(matches = []) {
  if (!matches.length) {
    els.matchList.innerHTML = '<div class="empty-state">No heads-up tables are open yet.</div>';
    return;
  }

  els.matchList.innerHTML = matches
    .map((match) => {
      const players = match.players.map((player) => escapeHtml(player.name)).join(' · ') || 'Waiting for host';
      return `
        <article class="lobby-card">
          <div class="lobby-card-top">
            <div>
              <p class="lobby-card-kicker">Heads-Up</p>
              <h4>${escapeHtml(match.name)}</h4>
            </div>
            <span class="status-pill ${escapeHtml(match.status)}">${escapeHtml(match.statusLabel)}</span>
          </div>
          <p class="card-copy">${escapeHtml(players)}</p>
          <div class="chip-row">
            <span class="chip">Seats ${match.seatsTaken}/${match.seatLimit}</span>
            <span class="chip">Table ${escapeHtml(match.id.slice(-4).toUpperCase())}</span>
          </div>
          <button class="secondary-button" data-action="match" data-match-id="${escapeHtml(match.id)}">${escapeHtml(matchActionLabel(match))}</button>
        </article>
      `;
    })
    .join('');
}

function renderTournamentList(tournaments = []) {
  if (!tournaments.length) {
    els.tournamentList.innerHTML = '<div class="empty-state">No tournaments are running yet.</div>';
    return;
  }

  els.tournamentList.innerHTML = tournaments
    .map((tournament) => {
      const entrants = tournament.entrants.map((entrant) => escapeHtml(entrant.name)).join(' · ') || 'Waiting for registrations';
      return `
        <article class="lobby-card tournament-card">
          <div class="lobby-card-top">
            <div>
              <p class="lobby-card-kicker">Tournament Event</p>
              <h4>${escapeHtml(tournament.name)}</h4>
            </div>
            <span class="status-pill ${escapeHtml(tournament.status)}">${escapeHtml(tournament.statusLabel)}</span>
          </div>
          <p class="card-copy">${escapeHtml(entrants)}</p>
          <div class="chip-row">
            <span class="chip">Players ${tournament.seatsTaken}/${tournament.seatLimit}</span>
            <span class="chip">${escapeHtml(tournament.stageLabel)}</span>
          </div>
          <button class="secondary-button" data-action="tournament" data-tournament-id="${escapeHtml(tournament.id)}">${escapeHtml(tournamentActionLabel(tournament))}</button>
        </article>
      `;
    })
    .join('');
}

function renderTournamentStage(tournament) {
  if (!tournament) {
    els.tournamentStageStatus.textContent = 'No tournament selected';
    els.tournamentStage.innerHTML = '<div class="empty-state">Join a tournament to view the live bracket.</div>';
    return;
  }

  els.tournamentStageStatus.textContent = tournament.statusLabel;

  const entrants = tournament.entrants
    .map(
      (entrant) => `
        <div class="seat-pill${entrant.id === playerId ? ' current-player' : ''}">
          <span>#${entrant.seed}</span>
          <strong>${escapeHtml(entrant.name)}</strong>
        </div>
      `
    )
    .join('');

  const rounds = tournament.rounds
    .map(
      (round) => `
        <div class="bracket-round">
          <div class="bracket-heading">${escapeHtml(round.title)}</div>
          ${round.matches
            .map(
              (match) => `
                <article class="bracket-match ${escapeHtml(match.status)}${match.id === activeTournamentMatchId ? ' active' : ''}">
                  <div class="bracket-match-top">
                    <span>${escapeHtml(match.tableLabel)}</span>
                    <span>${escapeHtml(match.statusLabel)}</span>
                  </div>
                  <div class="bracket-player${match.winnerId === match.players[0]?.id ? ' winner' : ''}">${escapeHtml(match.players[0]?.name || 'TBD')}</div>
                  <div class="bracket-player${match.winnerId === match.players[1]?.id ? ' winner' : ''}">${escapeHtml(match.players[1]?.name || 'TBD')}</div>
                  <p class="bracket-copy">${escapeHtml(match.resultText || match.subtitle)}</p>
                </article>
              `
            )
            .join('')}
        </div>
      `
    )
    .join('');

  els.tournamentStage.innerHTML = `
    <div class="stage-summary">
      <div class="chip-row">
        <span class="chip">${escapeHtml(tournament.name)}</span>
        <span class="chip">${escapeHtml(tournament.stageLabel)}</span>
        <span class="chip">${escapeHtml(tournament.yourStatus.message)}</span>
      </div>
      <div class="seat-strip">${entrants || '<div class="empty-state">Waiting for entrants.</div>'}</div>
    </div>
    <div class="bracket-grid">${rounds || '<div class="empty-state">Bracket appears when all 8 seats are filled.</div>'}</div>
  `;
}

function applyHeadsUpSummary(match) {
  activeMatchSnapshot = match;
  if (!match) return;

  if (match.status === 'complete' && match.isParticipant) {
    setRewardFromCompletedGame({ pgn: match.pgn, fen: match.fen });
  } else {
    clearRewardState();
  }

  if (currentMode !== 'online-match') return;

  setOnlineModeUi(
    `Heads-Up Table · ${match.name}`,
    match.isParticipant
      ? match.status === 'waiting'
        ? 'Seat reserved. Waiting for a challenger.'
        : `You are ${colorName(match.yourColor)} vs ${match.opponentName || 'Opponent'}.`
      : 'Watching a live table from the lobby.'
  );

  board.loadState({ pgn: match.pgn, fen: match.fen });
  board.setInteractive(Boolean(match.canMove) && !pendingRemoteMove);
  els.turnStatus.textContent = match.turnLabel;
  els.gameStatus.textContent = pendingRemoteMove ? 'Sending move…' : match.resultText || '';
}

function applyTournamentSummary(tournament) {
  activeTournamentSnapshot = tournament;
  activeTournamentMatchId = tournament.activeMatch?.id || activeTournamentMatchId;
  storeValue(STORAGE_KEYS.activeTournamentMatchId, activeTournamentMatchId);
  renderTournamentStage(tournament);

  const featuredMatch = tournament.activeMatch || tournament.featuredMatch;
  if (featuredMatch?.status === 'complete' && featuredMatch.isParticipant) {
    setRewardFromCompletedGame({ pgn: featuredMatch.pgn, fen: featuredMatch.fen });
  } else if (currentMode === 'online-tournament') {
    clearRewardState();
  }

  if (currentMode !== 'online-tournament') return;

  setOnlineModeUi(`Tournament Lobby · ${tournament.name}`, tournament.yourStatus.message);

  if (featuredMatch) {
    board.loadState({ pgn: featuredMatch.pgn, fen: featuredMatch.fen });
  } else {
    board.reset();
  }

  board.setInteractive(Boolean(tournament.activeMatch?.canMove) && !pendingRemoteMove);
  els.turnStatus.textContent = tournament.activeMatch?.turnLabel || tournament.boardStatus.turnLabel;
  els.gameStatus.textContent = pendingRemoteMove
    ? 'Sending move…'
    : tournament.activeMatch?.resultText || tournament.boardStatus.gameStatus;
  els.opponentStatus.textContent = tournament.activeMatch
    ? `Table ${tournament.activeMatch.tableLabel} · You are ${colorName(tournament.activeMatch.yourColor)} vs ${tournament.activeMatch.opponentName || 'Opponent'}.`
    : tournament.boardStatus.opponentStatus;
}

async function refreshOnlineSnapshot({ quiet = false } = {}) {
  if (onlineRefreshInFlight) return;
  onlineRefreshInFlight = true;

  try {
    const [lobby, matchResponse, tournamentResponse] = await Promise.all([
      online.getLobby(playerId).catch((error) => {
        if (!quiet) setOnlineStatus(error.message, true);
        return null;
      }),
      activeMatchId
        ? online.getMatch(activeMatchId, playerId).catch((error) => {
            if (error.status === 404) {
              resetActiveMatchSelection();
              return null;
            }
            throw error;
          })
        : Promise.resolve(null),
      activeTournamentId
        ? online.getTournament(activeTournamentId, playerId).catch((error) => {
            if (error.status === 404) {
              resetActiveTournamentSelection();
              renderTournamentStage(null);
              return null;
            }
            throw error;
          })
        : Promise.resolve(null),
    ]);

    if (lobby) {
      lobbySnapshot = lobby;
      renderMatchList(lobby.matches || []);
      renderTournamentList(lobby.tournaments || []);
      if (lobby.player?.name && !quiet) {
        setOnlineStatus(`Welcome back, ${lobby.player.name}.`);
      }
    }

    if (matchResponse?.match) {
      applyHeadsUpSummary(matchResponse.match);
    }

    if (tournamentResponse?.tournament) {
      applyTournamentSummary(tournamentResponse.tournament);
    } else if (!activeTournamentId) {
      renderTournamentStage(activeTournamentSnapshot);
    }
  } catch (error) {
    if (!quiet) setOnlineStatus(error.message, true);
  } finally {
    onlineRefreshInFlight = false;
  }
}

function ensureOnlinePolling() {
  if (onlinePollHandle) return;
  onlinePollHandle = window.setInterval(() => {
    refreshOnlineSnapshot({ quiet: true }).catch(() => {});
  }, ONLINE_POLL_INTERVAL_MS);
}

async function createHeadsUpMatch() {
  try {
    requirePlayerProfile();
    setOnlineStatus('Opening your heads-up table…');
    const response = await online.createMatch({
      playerId,
      name: `${playerName}'s Heads-Up Table`,
    });
    activeMatchId = response.match.id;
    storeValue(STORAGE_KEYS.activeMatchId, activeMatchId);
    currentMode = 'online-match';
    applyHeadsUpSummary(response.match);
    setOnlineStatus('Table opened. Waiting for another player to sit down.');
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function viewHeadsUpMatch(matchId) {
  try {
    activeMatchId = matchId;
    storeValue(STORAGE_KEYS.activeMatchId, activeMatchId);
    currentMode = 'online-match';
    const response = activeMatchSnapshot?.id === matchId
      ? { match: activeMatchSnapshot }
      : await online.getMatch(matchId, playerId);
    applyHeadsUpSummary(response.match);
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function handleMatchCardClick(matchId) {
  const lobbyMatch = lobbySnapshot?.matches?.find((match) => match.id === matchId);
  if (!lobbyMatch) {
    await viewHeadsUpMatch(matchId);
    return;
  }

  try {
    if (!lobbyMatch.isParticipant && lobbyMatch.status === 'waiting' && lobbyMatch.seatsTaken < lobbyMatch.seatLimit) {
      requirePlayerProfile();
      setOnlineStatus('Joining the heads-up table…');
      const response = await online.joinMatch(matchId, playerId);
      activeMatchId = response.match.id;
      storeValue(STORAGE_KEYS.activeMatchId, activeMatchId);
      currentMode = 'online-match';
      applyHeadsUpSummary(response.match);
      setOnlineStatus('You are seated. Good luck!');
      await refreshOnlineSnapshot({ quiet: true });
      return;
    }

    await viewHeadsUpMatch(matchId);
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function createTournament() {
  try {
    requirePlayerProfile();
    setOnlineStatus('Creating an 8-player event…');
    const response = await online.createTournament({
      playerId,
      name: `${playerName}'s Turbo Cup`,
    });
    activeTournamentId = response.tournament.id;
    storeValue(STORAGE_KEYS.activeTournamentId, activeTournamentId);
    currentMode = 'online-tournament';
    applyTournamentSummary(response.tournament);
    setOnlineStatus('Tournament created. Fill all 8 seats to launch the bracket.');
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function viewTournament(tournamentId) {
  try {
    activeTournamentId = tournamentId;
    storeValue(STORAGE_KEYS.activeTournamentId, activeTournamentId);
    currentMode = 'online-tournament';
    const response = activeTournamentSnapshot?.id === tournamentId
      ? { tournament: activeTournamentSnapshot }
      : await online.getTournament(tournamentId, playerId);
    applyTournamentSummary(response.tournament);
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function handleTournamentCardClick(tournamentId) {
  const lobbyTournament = lobbySnapshot?.tournaments?.find((tournament) => tournament.id === tournamentId);
  if (!lobbyTournament) {
    await viewTournament(tournamentId);
    return;
  }

  try {
    if (!lobbyTournament.yourStatus?.joined && lobbyTournament.status === 'registration' && lobbyTournament.seatsTaken < lobbyTournament.seatLimit) {
      requirePlayerProfile();
      setOnlineStatus('Reserving your tournament seat…');
      const response = await online.joinTournament(tournamentId, playerId);
      activeTournamentId = response.tournament.id;
      storeValue(STORAGE_KEYS.activeTournamentId, activeTournamentId);
      currentMode = 'online-tournament';
      applyTournamentSummary(response.tournament);
      setOnlineStatus('You are registered. The event starts when all 8 seats are filled.');
      await refreshOnlineSnapshot({ quiet: true });
      return;
    }

    await viewTournament(tournamentId);
  } catch (error) {
    setOnlineStatus(error.message, true);
  }
}

async function submitHeadsUpMove(move) {
  if (!activeMatchId || !playerId) return;

  pendingRemoteMove = true;
  board.setInteractive(false);
  els.gameStatus.textContent = 'Sending move…';

  try {
    const response = await online.moveMatch(activeMatchId, playerId, {
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    });
    pendingRemoteMove = false;
    applyHeadsUpSummary(response.match);
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    pendingRemoteMove = false;
    setOnlineStatus(error.message, true);
    const response = await online.getMatch(activeMatchId, playerId).catch(() => null);
    if (response?.match) {
      applyHeadsUpSummary(response.match);
    }
  }
}

async function submitTournamentMove(move) {
  if (!activeTournamentId || !activeTournamentMatchId || !playerId) return;

  pendingRemoteMove = true;
  board.setInteractive(false);
  els.gameStatus.textContent = 'Sending move…';

  try {
    const response = await online.moveTournamentMatch(activeTournamentId, activeTournamentMatchId, playerId, {
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    });
    pendingRemoteMove = false;
    applyTournamentSummary(response.tournament);
    await refreshOnlineSnapshot({ quiet: true });
  } catch (error) {
    pendingRemoteMove = false;
    setOnlineStatus(error.message, true);
    const response = await online.getTournament(activeTournamentId, playerId).catch(() => null);
    if (response?.tournament) {
      applyTournamentSummary(response.tournament);
    }
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
    els.claimStatus.textContent = `Reward claimed! Tx: ${txHash.slice(0, 10)}…`;
    rewardEligible = false;
    await refreshBalance();
  } catch (error) {
    els.claimStatus.textContent = error.message;
    els.claimBtn.disabled = false;
  }
});

els.newGameBtn.addEventListener('click', startNewGame);
els.returnLocalBtn.addEventListener('click', switchToLocalBoard);
els.savePlayerBtn.addEventListener('click', () => savePlayerProfile());
els.createMatchBtn.addEventListener('click', createHeadsUpMatch);
els.createTournamentBtn.addEventListener('click', createTournament);

els.playerName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    savePlayerProfile();
  }
});

els.matchList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="match"]');
  if (!button) return;
  handleMatchCardClick(button.dataset.matchId);
});

els.tournamentList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="tournament"]');
  if (!button) return;
  handleTournamentCardClick(button.dataset.tournamentId);
});

els.vsComputer.addEventListener('change', () => {
  vsComputer = els.vsComputer.checked;
  els.aiDifficulty.disabled = !vsComputer;
  els.aiSide.disabled = !vsComputer;
  setLocalModeUi();
  maybeTriggerAiMove();
});

els.aiSide.addEventListener('change', () => {
  humanColor = els.aiSide.value;
  startNewGame();
});

els.tokenAddress.textContent = CONFIG.tokenAddress;
els.rewardVaultAddress.textContent = CONFIG.rewardVaultAddress || 'Not configured';
els.playerName.value = playerName;
updateWalletUI();
startNewGame();
refreshOnlineSnapshot({ quiet: true }).catch(() => {});

if (playerName) {
  savePlayerProfile({ silent: true });
}
