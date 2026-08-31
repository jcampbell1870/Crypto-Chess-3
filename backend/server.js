import http from 'node:http';
import crypto from 'node:crypto';
import { ethers } from 'ethers';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const issuerOrigin = process.env.ALLOWED_ORIGIN || '';
const signerKey = process.env.REWARD_SIGNER_PRIVATE_KEY;
const vaultAddress = process.env.REWARD_VAULT_ADDRESS;
const chainId = Number(process.env.CHAIN_ID || 1);
const rewardAmount = process.env.REWARD_AMOUNT;
const claimTtlSeconds = Number(process.env.CLAIM_TTL_SECONDS || 300);
const verificationSecret = process.env.GAME_VERIFICATION_SECRET;

if (!signerKey || !vaultAddress || !rewardAmount || !verificationSecret) {
  throw new Error(
    'REWARD_SIGNER_PRIVATE_KEY, REWARD_VAULT_ADDRESS, REWARD_AMOUNT, and GAME_VERIFICATION_SECRET are required'
  );
}
if (!ethers.isAddress(vaultAddress)) throw new Error('REWARD_VAULT_ADDRESS is invalid');
const signer = new ethers.Wallet(signerKey);
const usedNonces = new Set();

function send(response, status, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': issuerOrigin,
    Vary: 'Origin',
  };
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function validProof(recipient, proof) {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/i.test(proof)) return false;
  const expected = crypto
    .createHmac('sha256', verificationSecret)
    .update(recipient.toLowerCase())
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'));
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': issuerOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return response.end();
  }
  if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true });
  if (request.method !== 'POST' || request.url !== '/claim') return send(response, 404, { error: 'Not found' });

  let raw = '';
  request.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 4096) request.destroy();
  });
  request.on('end', async () => {
    try {
      const body = JSON.parse(raw);
      const recipient = body.recipient;
      if (!ethers.isAddress(recipient) || !validProof(recipient, body.gameProof)) {
        return send(response, 403, { error: 'A valid completed-game proof is required' });
      }

      const nonce = crypto.randomInt(0, 2 ** 48);
      while (usedNonces.has(nonce)) continue;
      usedNonces.add(nonce);
      const deadline = Math.floor(Date.now() / 1000) + claimTtlSeconds;
      const domain = {
        name: 'Arcade1870RewardVault',
        version: '1',
        chainId,
        verifyingContract: vaultAddress,
      };
      const types = {
        Claim: [
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const signature = await signer.signTypedData(domain, types, {
        recipient,
        amount: rewardAmount,
        nonce,
        deadline,
      });
      return send(response, 200, { amount: rewardAmount, nonce, deadline, signature });
    } catch {
      return send(response, 400, { error: 'Invalid request' });
    }
  });
});

server.listen(port, host, () => console.log(`Reward issuer listening on ${host}:${port}`));
