import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
// There is no safe default for the vault: this must be the address of the
// deployed Arcade1870RewardVault, not the ARC token contract.
const rewardVaultAddress = process.env.REWARD_VAULT_ADDRESS || '';
const rewardIssuerUrl = process.env.PUBLIC_REWARD_ISSUER_URL || '/api/reward-claim';
const rewardAmount = process.env.REWARD_AMOUNT || '10';
const tokenDecimals = Number(process.env.TOKEN_DECIMALS || 18);
const claimTtlSeconds = Number(process.env.CLAIM_TTL_SECONDS || 600);
const minClaimIntervalMs = Number(process.env.MIN_CLAIM_INTERVAL_MS || 60 * 60 * 1000);
const minRewardPlies = Number(process.env.MIN_REWARD_PLIES || 4);
const configuredExpectedSigner = process.env.REWARD_SIGNER_ADDRESS || '';
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
// The game is published from GitHub Pages under these production domains
// (see CNAME). Reward claims are fetched cross-origin from the Render
// issuer, so these must always be allowed even if ALLOWED_ORIGINS hasn't
// been (re)configured in the Render dashboard after a domain change.
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

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders(origin) {
  if (!origin || !isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 4096) {
      throw new Error('Request body is too large.');
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
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
    // ethers throws here for malformed or unsupported private-key formats.
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
  sendJson(response, 200, { amount: amount.toString(), nonce: nonce.toString(), deadline, signature }, origin);
}

function configModule() {
  return `// Generated by the Render web service from public environment variables.
export const CONFIG = {
  tokenAddress: '${tokenAddress}',
  chainId: ${chainId},
  chainName: '${chainName.replaceAll("'", "\\'")}',
  rewardVaultAddress: '${rewardVaultAddress}',
  rewardIssuerUrl: '${rewardIssuerUrl}',
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
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Internal server error.' });
  }
});

server.listen(port, () => {
  console.log(`Crypto Chess Render web service listening on port ${port}`);
});
