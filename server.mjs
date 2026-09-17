import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { Chess } from './js/vendor/chess.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const tokenAddress =
  process.env.TOKEN_ADDRESS || '0x8eddD4edea39c5B5f77662453600F53A202EE47C';
const chainId = Number(process.env.CHAIN_ID || 1);
const chainName = process.env.CHAIN_NAME || 'Ethereum Mainnet';
const rewardVaultAddress = process.env.REWARD_VAULT_ADDRESS || '';
const rewardIssuerUrl = process.env.PUBLIC_REWARD_ISSUER_URL || '/api/reward-claim';
const onlineApiUrl = process.env.PUBLIC_ONLINE_API_URL || deriveOnlineApiUrl(rewardIssuerUrl);
const rewardAmount = process.env.REWARD_AMOUNT || '10';
const tokenDecimals = Number(process.env.TOKEN_DECIMALS || 18);
const claimTtlSeconds = Number(process.env.CLAIM_TTL_SECONDS || 600);
const minClaimIntervalMs = Number(process.env.MIN_CLAIM_INTERVAL_MS || 60 * 60 * 1000);
const minRewardPlies = Number(process.env.MIN_REWARD_PLIES || 4);
const configuredExpectedSigner = process.env.REWARD_SIGNER_ADDRESS || '';
const onlineTournamentSize = 8;
const onlineNameMaxLength = 40;
if (process.env.RENDER && !ethers.isAddress(rewardVaultAddress)) {
  throw new Error(
    'REWARD_VAULT_ADDRESS must be set to the deployed Arcade1870RewardVault address.'
  );
}
if (configuredExpectedSigner && !ethers.isAddress(configuredExpectedSigner)) {
  throw new Error(
    'REWARD_SIGNER_ADDRESS must be the Ethereum address derived from REWARD_SIGNER_PRIVATE_KEY.'
  );
}

const defaultAllowedOrigins = [
  'https://www.cryptochess.org',
  'https://cryptochess.org',
];
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [
  ...new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins]),
];

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

let nonceCounter = 0;
const recentClaims = new Map();
const claimedGames = new Set();
const onlinePlayers = new Map();
const onlineMatches = new Map();
const onlineTournaments = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function deriveOnlineApiUrl(baseRewardIssuerUrl) {
  try {
    if (!baseRewardIssuerUrl.startsWith('http')) {
      return '/api/online';
    }
    const url = new URL(baseRewardIssuerUrl);
    url.pathname = '/api/online';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '/api/online';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sendJson(response, status, payload, origin, methods = 'POST, OPTIONS') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin, methods),
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders(origin, methods = 'POST, OPTIONS') {
  if (!origin || !isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': methods,
  };
}

function isOriginAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function verifyCompletedGame({ pgn, fen }) {
  if (typeof pgn !== 'string' || pgn.length === 0 || pgn.length > 10000) {
    throw new Error('Completed game PGN is required.');
  }

  const game = new Chess();
  if (!game.load_pgn(pgn)) {
    throw new Error('Completed game PGN is invalid.');
  }
  if (!game.game_over()) {
    throw new Error('Game is not complete.');
  }
  if (game.history().length < minRewardPlies) {
    throw new Error('Game is too short for a reward.');
  }
  if (typeof fen === 'string' && fen && game.fen() !== fen) {
    throw new Error('Completed game position does not match its PGN.');
  }

  return createHash('sha256').update(game.pgn()).digest('hex');
}

async function readJsonBody(request, maxBytes = 4096) {
  const chunks = [];
  let totalLength = 0;
  for await (const chunk of request) {
    totalLength += chunk.length;
    if (totalLength > maxBytes) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sanitizeDisplayName(value, fallback, maxLength = onlineNameMaxLength) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
  if (normalized.length >= 3) return normalized;
  return fallback;
}

function createOnlineId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

function touchPlayer(playerId) {
  const player = onlinePlayers.get(playerId);
  if (player) {
    player.lastSeenAt = nowIso();
  }
  return player;
}

function requirePlayer(playerId) {
  const player = touchPlayer(playerId);
  if (!player) {
    throw new HttpError(404, 'Save a screen name before entering the online lobby.');
  }
  return player;
}

function upsertPlayer(playerId, name) {
  const fallbackName = `Player ${onlinePlayers.size + 1}`;
  const displayName = sanitizeDisplayName(name, fallbackName, 24);
  const id = playerId || createOnlineId('player');
  const timestamp = nowIso();
  const existing = onlinePlayers.get(id);
  if (existing) {
    existing.name = displayName;
    existing.lastSeenAt = timestamp;
    return existing;
  }

  const created = {
    id,
    name: displayName,
    createdAt: timestamp,
    lastSeenAt: timestamp,
  };
  onlinePlayers.set(id, created);
  return created;
}

function getPlayerName(playerId) {
  return onlinePlayers.get(playerId)?.name || 'Unknown Player';
}

function createHeadsUpMatch(playerId, name) {
  requirePlayer(playerId);
  const timestamp = nowIso();
  const match = {
    id: createOnlineId('table'),
    name: sanitizeDisplayName(name, `${getPlayerName(playerId)}'s Heads-Up Table`),
    playerIds: [playerId],
    colors: { [playerId]: 'w' },
    status: 'waiting',
    createdAt: timestamp,
    updatedAt: timestamp,
    game: new Chess(),
    winnerId: null,
    resultText: '',
  };
  onlineMatches.set(match.id, match);
  return match;
}

function requireHeadsUpMatch(matchId) {
  const match = onlineMatches.get(matchId);
  if (!match) {
    throw new HttpError(404, 'That heads-up table no longer exists.');
  }
  return match;
}

function colorForPlayer(match, playerId) {
  return match.colors[playerId] || null;
}

function findWinnerIdFromCheckmate(match) {
  const winningColor = match.game.turn() === 'w' ? 'b' : 'w';
  return match.playerIds.find((playerId) => match.colors[playerId] === winningColor) || null;
}

function completeStandaloneMatch(match) {
  match.status = 'complete';
  if (match.game.in_checkmate()) {
    match.winnerId = findWinnerIdFromCheckmate(match);
    match.resultText = `Checkmate — ${getPlayerName(match.winnerId)} wins!`;
  } else if (match.game.in_stalemate()) {
    match.winnerId = null;
    match.resultText = 'Draw by stalemate.';
  } else if (match.game.in_draw()) {
    match.winnerId = null;
    match.resultText = 'Draw.';
  } else {
    match.winnerId = null;
    match.resultText = 'Game over.';
  }
}

function summarizeMatch(match, viewerId) {
  const isParticipant = Boolean(viewerId && match.playerIds.includes(viewerId));
  const players = match.playerIds.map((playerId) => ({
    id: playerId,
    name: getPlayerName(playerId),
    color: colorForPlayer(match, playerId),
  }));
  const yourColor = viewerId ? colorForPlayer(match, viewerId) : null;
  const opponent = viewerId ? players.find((player) => player.id !== viewerId) : null;
  return {
    id: match.id,
    name: match.name,
    status: match.status,
    statusLabel:
      match.status === 'waiting'
        ? 'Open Table'
        : match.status === 'active'
        ? 'Live Match'
        : 'Complete',
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    players,
    seatLimit: 2,
    seatsTaken: match.playerIds.length,
    yourColor,
    opponentName: opponent?.name || '',
    isParticipant,
    canMove: isParticipant && match.status === 'active' && yourColor === match.game.turn(),
    turn: match.game.turn(),
    turnLabel:
      match.status === 'waiting'
        ? 'Waiting for opponent'
        : match.status === 'complete'
        ? 'Game over'
        : `${match.game.turn() === 'w' ? 'White' : 'Black'} to move`,
    fen: match.game.fen(),
    pgn: match.game.pgn(),
    winnerId: match.winnerId,
    resultText: match.resultText,
  };
}

function joinHeadsUpMatch(matchId, playerId) {
  const match = requireHeadsUpMatch(matchId);
  requirePlayer(playerId);
  if (match.playerIds.includes(playerId)) return match;
  if (match.status !== 'waiting') {
    throw new HttpError(409, 'That heads-up table is already underway.');
  }
  if (match.playerIds.length >= 2) {
    throw new HttpError(409, 'That heads-up table is already full.');
  }
  match.playerIds.push(playerId);
  match.colors[playerId] = 'b';
  match.status = 'active';
  match.updatedAt = nowIso();
  return match;
}

function applyMoveToStandaloneMatch(match, playerId, move) {
  if (!match.playerIds.includes(playerId)) {
    throw new HttpError(403, 'You are not seated at this heads-up table.');
  }
  if (match.status !== 'active') {
    throw new HttpError(409, 'This heads-up table is not ready for moves yet.');
  }
  if (match.colors[playerId] !== match.game.turn()) {
    throw new HttpError(409, 'It is not your turn.');
  }
  const appliedMove = match.game.move(move);
  if (!appliedMove) {
    throw new HttpError(400, 'That move is not legal.');
  }
  match.updatedAt = nowIso();
  if (match.game.game_over()) {
    completeStandaloneMatch(match);
  }
  return match;
}

function createTournament(playerId, name) {
  requirePlayer(playerId);
  const timestamp = nowIso();
  const tournament = {
    id: createOnlineId('event'),
    name: sanitizeDisplayName(name, `${getPlayerName(playerId)}'s Turbo Cup`),
    hostPlayerId: playerId,
    entrantIds: [playerId],
    rounds: [],
    status: 'registration',
    championId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  onlineTournaments.set(tournament.id, tournament);
  return tournament;
}

function requireTournament(tournamentId) {
  const tournament = onlineTournaments.get(tournamentId);
  if (!tournament) {
    throw new HttpError(404, 'That tournament is no longer available.');
  }
  return tournament;
}

function getTournamentSeed(tournament, playerId) {
  return tournament.entrantIds.indexOf(playerId) + 1;
}

function createTournamentMatch(tournament, roundNumber, slot, whitePlayerId, blackPlayerId) {
  return {
    id: `${tournament.id}_r${roundNumber}m${slot}`,
    roundNumber,
    slot,
    playerIds: [whitePlayerId, blackPlayerId],
    colors: {
      [whitePlayerId]: 'w',
      [blackPlayerId]: 'b',
    },
    status: 'active',
    game: new Chess(),
    winnerId: null,
    resultText: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function startTournamentIfReady(tournament) {
  if (tournament.status !== 'registration' || tournament.entrantIds.length !== onlineTournamentSize) {
    return tournament;
  }

  const seeds = tournament.entrantIds;
  const pairings = [
    [seeds[0], seeds[7]],
    [seeds[3], seeds[4]],
    [seeds[1], seeds[6]],
    [seeds[2], seeds[5]],
  ];

  tournament.rounds = [
    {
      number: 1,
      title: 'Quarterfinals',
      matches: pairings.map(([whitePlayerId, blackPlayerId], index) =>
        createTournamentMatch(tournament, 1, index + 1, whitePlayerId, blackPlayerId)
      ),
    },
  ];
  tournament.status = 'active';
  tournament.updatedAt = nowIso();
  return tournament;
}

function joinTournament(tournamentId, playerId) {
  const tournament = requireTournament(tournamentId);
  requirePlayer(playerId);
  if (tournament.entrantIds.includes(playerId)) {
    return startTournamentIfReady(tournament);
  }
  if (tournament.status !== 'registration') {
    throw new HttpError(409, 'That tournament has already started.');
  }
  if (tournament.entrantIds.length >= onlineTournamentSize) {
    throw new HttpError(409, 'That tournament lobby is already full.');
  }
  tournament.entrantIds.push(playerId);
  tournament.updatedAt = nowIso();
  return startTournamentIfReady(tournament);
}

function findTournamentMatch(tournament, matchId) {
  for (const round of tournament.rounds) {
    const match = round.matches.find((candidate) => candidate.id === matchId);
    if (match) return match;
  }
  throw new HttpError(404, 'That tournament table no longer exists.');
}

function pickTournamentTiebreakWinner(tournament, match) {
  return [...match.playerIds].sort((a, b) => getTournamentSeed(tournament, a) - getTournamentSeed(tournament, b))[0];
}

function completeTournamentMatch(tournament, match) {
  match.status = 'complete';
  if (match.game.in_checkmate()) {
    match.winnerId = findWinnerIdFromCheckmate(match);
    match.resultText = `Checkmate — ${getPlayerName(match.winnerId)} advances.`;
  } else if (match.game.in_stalemate() || match.game.in_draw()) {
    match.winnerId = pickTournamentTiebreakWinner(tournament, match);
    match.resultText = `Draw — ${getPlayerName(match.winnerId)} advances on seed tiebreak.`;
  } else {
    match.winnerId = pickTournamentTiebreakWinner(tournament, match);
    match.resultText = `${getPlayerName(match.winnerId)} advances.`;
  }
}

function advanceTournamentIfReady(tournament) {
  const currentRound = tournament.rounds.at(-1);
  if (!currentRound || currentRound.matches.some((match) => match.status !== 'complete')) {
    return tournament;
  }

  const winners = currentRound.matches.map((match) => match.winnerId);
  if (winners.length === 1) {
    tournament.status = 'complete';
    tournament.championId = winners[0];
    tournament.updatedAt = nowIso();
    return tournament;
  }

  const nextRoundNumber = currentRound.number + 1;
  const title = nextRoundNumber === 2 ? 'Semifinals' : 'Final Table';
  const matches = [];
  for (let index = 0; index < winners.length; index += 2) {
    matches.push(createTournamentMatch(
      tournament,
      nextRoundNumber,
      index / 2 + 1,
      winners[index],
      winners[index + 1]
    ));
  }
  tournament.rounds.push({
    number: nextRoundNumber,
    title,
    matches,
  });
  tournament.updatedAt = nowIso();
  return tournament;
}

function applyMoveToTournamentMatch(tournamentId, matchId, playerId, move) {
  const tournament = requireTournament(tournamentId);
  const match = findTournamentMatch(tournament, matchId);
  if (!match.playerIds.includes(playerId)) {
    throw new HttpError(403, 'You are not seated at this tournament table.');
  }
  if (match.status !== 'active') {
    throw new HttpError(409, 'That tournament table is not active right now.');
  }
  if (match.colors[playerId] !== match.game.turn()) {
    throw new HttpError(409, 'It is not your turn.');
  }
  const appliedMove = match.game.move(move);
  if (!appliedMove) {
    throw new HttpError(400, 'That move is not legal.');
  }
  match.updatedAt = nowIso();
  tournament.updatedAt = nowIso();
  if (match.game.game_over()) {
    completeTournamentMatch(tournament, match);
    advanceTournamentIfReady(tournament);
  }
  return tournament;
}

function summarizeTournamentMatch(tournament, match, viewerId) {
  const players = match.playerIds.map((playerId) => ({
    id: playerId,
    name: getPlayerName(playerId),
    color: match.colors[playerId],
    seed: getTournamentSeed(tournament, playerId),
  }));
  const isParticipant = Boolean(viewerId && match.playerIds.includes(viewerId));
  const yourColor = viewerId ? match.colors[viewerId] || null : null;
  const opponent = viewerId ? players.find((player) => player.id !== viewerId) : null;
  return {
    id: match.id,
    tableLabel: `T${match.slot}`,
    status: match.status,
    statusLabel: match.status === 'active' ? 'Live Match' : 'Resolved',
    subtitle: `Seed ${players[0]?.seed || '?'} vs Seed ${players[1]?.seed || '?'}`,
    players,
    yourColor,
    opponentName: opponent?.name || '',
    isParticipant,
    canMove: isParticipant && match.status === 'active' && yourColor === match.game.turn(),
    turnLabel: match.status === 'active' ? `${match.game.turn() === 'w' ? 'White' : 'Black'} to move` : 'Game over',
    fen: match.game.fen(),
    pgn: match.game.pgn(),
    winnerId: match.winnerId,
    resultText: match.resultText,
  };
}

function tournamentStageLabel(tournament) {
  if (tournament.status === 'registration') {
    return `Registration ${tournament.entrantIds.length}/${onlineTournamentSize}`;
  }
  if (tournament.status === 'complete') {
    return `Champion ${getPlayerName(tournament.championId)}`;
  }
  return tournament.rounds.at(-1)?.title || 'Live Event';
}

function tournamentStatusLabel(tournament) {
  if (tournament.status === 'registration') return 'Registration';
  if (tournament.status === 'complete') return 'Complete';
  return 'Running';
}

function findPlayerActiveTournamentMatch(tournament, playerId) {
  if (!playerId) return null;
  for (const round of tournament.rounds) {
    const activeMatch = round.matches.find(
      (match) => match.status === 'active' && match.playerIds.includes(playerId)
    );
    if (activeMatch) return activeMatch;
  }
  return null;
}

function findLatestPlayerTournamentMatch(tournament, playerId) {
  if (!playerId) return null;
  for (let roundIndex = tournament.rounds.length - 1; roundIndex >= 0; roundIndex -= 1) {
    const round = tournament.rounds[roundIndex];
    for (let matchIndex = round.matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const match = round.matches[matchIndex];
      if (match.playerIds.includes(playerId)) {
        return match;
      }
    }
  }
  return null;
}

function buildTournamentViewerStatus(tournament, playerId) {
  const joined = Boolean(playerId && tournament.entrantIds.includes(playerId));
  if (!joined) {
    return { joined: false, message: 'Spectating the bracket.' };
  }
  if (tournament.status === 'registration') {
    return {
      joined: true,
      message: `Registered — waiting for ${onlineTournamentSize - tournament.entrantIds.length} more players.`,
    };
  }
  if (tournament.championId === playerId) {
    return { joined: true, message: 'You won the tournament.' };
  }
  const activeMatch = findPlayerActiveTournamentMatch(tournament, playerId);
  if (activeMatch) {
    return { joined: true, message: `You are live on ${summarizeTournamentMatch(tournament, activeMatch, playerId).tableLabel}.` };
  }
  const latestMatch = findLatestPlayerTournamentMatch(tournament, playerId);
  if (latestMatch && latestMatch.status === 'complete' && latestMatch.winnerId !== playerId) {
    return { joined: true, message: 'You have been eliminated.' };
  }
  if (tournament.status === 'complete') {
    return { joined: true, message: `Champion: ${getPlayerName(tournament.championId)}.` };
  }
  return { joined: true, message: 'Waiting for your next round to open.' };
}

function summarizeTournamentCard(tournament, viewerId) {
  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    statusLabel: tournamentStatusLabel(tournament),
    stageLabel: tournamentStageLabel(tournament),
    seatsTaken: tournament.entrantIds.length,
    seatLimit: onlineTournamentSize,
    entrants: tournament.entrantIds.map((playerId) => ({
      id: playerId,
      name: getPlayerName(playerId),
      seed: getTournamentSeed(tournament, playerId),
    })),
    yourStatus: buildTournamentViewerStatus(tournament, viewerId),
    createdAt: tournament.createdAt,
    updatedAt: tournament.updatedAt,
  };
}

function summarizeTournament(tournament, viewerId) {
  const activeMatch = findPlayerActiveTournamentMatch(tournament, viewerId);
  const latestMatch = findLatestPlayerTournamentMatch(tournament, viewerId);
  const featuredMatch =
    activeMatch ||
    latestMatch ||
    tournament.rounds.at(-1)?.matches.at(-1) ||
    null;
  const viewerStatus = buildTournamentViewerStatus(tournament, viewerId);
  return {
    ...summarizeTournamentCard(tournament, viewerId),
    rounds: tournament.rounds.map((round) => ({
      number: round.number,
      title: round.title,
      matches: round.matches.map((match) => summarizeTournamentMatch(tournament, match, viewerId)),
    })),
    activeMatch: activeMatch ? summarizeTournamentMatch(tournament, activeMatch, viewerId) : null,
    featuredMatch: featuredMatch ? summarizeTournamentMatch(tournament, featuredMatch, viewerId) : null,
    boardStatus:
      tournament.status === 'registration'
        ? {
            turnLabel: `Registration ${tournament.entrantIds.length}/${onlineTournamentSize}`,
            gameStatus: 'Waiting for all 8 players to join.',
            opponentStatus: 'The bracket launches automatically when the field is full.',
          }
        : tournament.status === 'complete'
        ? {
            turnLabel: 'Tournament complete',
            gameStatus: `${getPlayerName(tournament.championId)} wins the bracket.`,
            opponentStatus: 'Review the final table or jump back into the lobby.',
          }
        : {
            turnLabel: 'Waiting for your next round',
            gameStatus: viewerStatus.message,
            opponentStatus: 'Other tables are still finishing.',
          },
    championId: tournament.championId,
    championName: tournament.championId ? getPlayerName(tournament.championId) : '',
    yourStatus: viewerStatus,
  };
}

function parseMove(body) {
  const candidate = body?.move || {};
  if (!/^[a-h][1-8]$/.test(candidate.from || '')) {
    throw new HttpError(400, 'A valid origin square is required.');
  }
  if (!/^[a-h][1-8]$/.test(candidate.to || '')) {
    throw new HttpError(400, 'A valid target square is required.');
  }
  if (candidate.promotion && !['q', 'r', 'b', 'n'].includes(candidate.promotion)) {
    throw new HttpError(400, 'Promotion must be q, r, b, or n.');
  }
  return {
    from: candidate.from,
    to: candidate.to,
    promotion: candidate.promotion,
  };
}

async function handleRewardClaim(request, response) {
  const origin = request.headers.origin;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' }, origin);
    return;
  }

  if (!ethers.isAddress(rewardVaultAddress)) {
    sendJson(response, 503, { error: 'Reward vault is not configured.' }, origin);
    return;
  }

  const privateKey = process.env.REWARD_SIGNER_PRIVATE_KEY;
  if (!privateKey) {
    sendJson(response, 503, { error: 'Reward signer is not configured.' }, origin);
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON request body.' }, origin);
    return;
  }

  const recipient = body.recipient;
  if (!ethers.isAddress(recipient)) {
    sendJson(response, 400, { error: 'A valid recipient address is required.' }, origin);
    return;
  }

  let gameHash;
  try {
    gameHash = verifyCompletedGame(body.game || {});
  } catch (error) {
    sendJson(response, 400, { error: error.message }, origin);
    return;
  }
  if (claimedGames.has(gameHash)) {
    sendJson(response, 409, { error: 'This completed game has already been rewarded.' }, origin);
    return;
  }

  const normalizedRecipient = ethers.getAddress(recipient);
  const now = Date.now();
  const lastClaimAt = recentClaims.get(normalizedRecipient) || 0;
  if (now - lastClaimAt < minClaimIntervalMs) {
    sendJson(response, 429, { error: 'Please wait before claiming another reward.' }, origin);
    return;
  }

  const amount = ethers.parseUnits(rewardAmount, tokenDecimals);
  const nonce = BigInt(now) * 1000n + BigInt(nonceCounter++);
  const deadline = Math.floor(now / 1000) + claimTtlSeconds;
  let signer;
  try {
    signer = new ethers.Wallet(privateKey);
  } catch {
    sendJson(response, 503, { error: 'Reward signer private key is invalid.' }, origin);
    return;
  }
  if (configuredExpectedSigner && signer.address.toLowerCase() !== configuredExpectedSigner.toLowerCase()) {
    sendJson(response, 503, { error: 'Reward signer does not match configuration.' }, origin);
    return;
  }

  let signature;
  try {
    signature = await signer.signTypedData(
      {
        name: 'Arcade1870RewardVault',
        version: '1',
        chainId,
        verifyingContract: rewardVaultAddress,
      },
      {
        Claim: [
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      {
        recipient: normalizedRecipient,
        amount,
        nonce,
        deadline,
      }
    );
  } catch (error) {
    console.error('Reward claim signing failed:', error.message);
    sendJson(response, 503, {
      error: 'EIP-712 reward signing failed. Verify the signer, vault address, and chain ID configuration.',
    }, origin);
    return;
  }

  recentClaims.set(normalizedRecipient, now);
  claimedGames.add(gameHash);
  sendJson(response, 200, {
    amount: amount.toString(),
    nonce: nonce.toString(),
    deadline,
    signature,
    vaultAddress: rewardVaultAddress,
    chainId,
  }, origin);
}

async function handleOnlineApi(request, response, url) {
  const origin = request.headers.origin;
  const methods = 'GET, POST, OPTIONS';

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin, methods));
    response.end();
    return;
  }

  try {
    const segments = url.pathname.split('/').filter(Boolean).slice(2);

    if (request.method === 'GET' && segments[0] === 'lobby') {
      const playerId = url.searchParams.get('playerId') || '';
      if (playerId) touchPlayer(playerId);
      sendJson(response, 200, {
        player: playerId && onlinePlayers.has(playerId)
          ? { id: playerId, name: getPlayerName(playerId) }
          : null,
        matches: [...onlineMatches.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 12)
          .map((match) => summarizeMatch(match, playerId)),
        tournaments: [...onlineTournaments.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 8)
          .map((tournament) => summarizeTournamentCard(tournament, playerId)),
      }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'players') {
      const body = await readJsonBody(request);
      const player = upsertPlayer(body.playerId, body.name);
      sendJson(response, 200, { player }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'matches' && segments.length === 1) {
      const body = await readJsonBody(request);
      const match = createHeadsUpMatch(body.playerId, body.name);
      sendJson(response, 200, { match: summarizeMatch(match, body.playerId) }, origin, methods);
      return;
    }

    if (request.method === 'GET' && segments[0] === 'matches' && segments[1]) {
      const playerId = url.searchParams.get('playerId') || '';
      if (playerId) touchPlayer(playerId);
      const match = requireHeadsUpMatch(segments[1]);
      sendJson(response, 200, { match: summarizeMatch(match, playerId) }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'matches' && segments[1] && segments[2] === 'join') {
      const body = await readJsonBody(request);
      const match = joinHeadsUpMatch(segments[1], body.playerId);
      sendJson(response, 200, { match: summarizeMatch(match, body.playerId) }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'matches' && segments[1] && segments[2] === 'move') {
      const body = await readJsonBody(request);
      const match = applyMoveToStandaloneMatch(segments[1], body.playerId, parseMove(body));
      sendJson(response, 200, { match: summarizeMatch(match, body.playerId) }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'tournaments' && segments.length === 1) {
      const body = await readJsonBody(request);
      const tournament = createTournament(body.playerId, body.name);
      sendJson(response, 200, { tournament: summarizeTournament(tournament, body.playerId) }, origin, methods);
      return;
    }

    if (request.method === 'GET' && segments[0] === 'tournaments' && segments[1] && segments.length === 2) {
      const playerId = url.searchParams.get('playerId') || '';
      if (playerId) touchPlayer(playerId);
      const tournament = requireTournament(segments[1]);
      sendJson(response, 200, { tournament: summarizeTournament(tournament, playerId) }, origin, methods);
      return;
    }

    if (request.method === 'POST' && segments[0] === 'tournaments' && segments[1] && segments[2] === 'join') {
      const body = await readJsonBody(request);
      const tournament = joinTournament(segments[1], body.playerId);
      sendJson(response, 200, { tournament: summarizeTournament(tournament, body.playerId) }, origin, methods);
      return;
    }

    if (
      request.method === 'POST' &&
      segments[0] === 'tournaments' &&
      segments[1] &&
      segments[2] === 'matches' &&
      segments[3] &&
      segments[4] === 'move'
    ) {
      const body = await readJsonBody(request);
      const tournament = applyMoveToTournamentMatch(
        segments[1],
        segments[3],
        body.playerId,
        parseMove(body)
      );
      sendJson(response, 200, { tournament: summarizeTournament(tournament, body.playerId) }, origin, methods);
      return;
    }

    throw new HttpError(404, 'Online route not found.');
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message }, origin, methods);
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: 'Invalid JSON request body.' }, origin, methods);
      return;
    }
    console.error('Online API error:', error);
    sendJson(response, 500, { error: 'Online service unavailable.' }, origin, methods);
  }
}

function configModule() {
  return `// Generated by the Render web service from public environment variables.
export const CONFIG = {
  tokenAddress: '${tokenAddress}',
  chainId: ${chainId},
  chainName: '${chainName.replaceAll("'", "\\'")}',
  rewardVaultAddress: '${rewardVaultAddress}',
  rewardIssuerUrl: '${rewardIssuerUrl}',
  onlineApiUrl: '${onlineApiUrl}',
};

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const REWARD_VAULT_ABI = [
  'function claim(uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
];
`;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === '/js/config.js' && process.env.RENDER) {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(configModule());
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = resolve(join(rootDir, normalize(requestedPath)));
  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file.');
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = await readFile(join(rootDir, 'index.html'));
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fallback);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/reward-claim' || url.pathname === '/reward-claim') {
      await handleRewardClaim(request, response);
      return;
    }
    if (url.pathname.startsWith('/api/online')) {
      await handleOnlineApi(request, response, url);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Internal server error.' });
  }
});

server.listen(port, () => {
  console.log(`Crypto Chess Render web service listening on port ${port}`);
});
