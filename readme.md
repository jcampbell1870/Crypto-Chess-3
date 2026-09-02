# Crypto-Chess-3

**Crypto Chess** is a browser-based chess game with MetaMask wallet
integration and Arcade1870 (ARC) ERC-20 token rewards for playing. It is a
plain static site (HTML/CSS/JavaScript, no build step or backend) so it can
be published directly with GitHub Pages.

## Features

- Full chess rules (legal move generation, check/checkmate/stalemate
  detection, castling, en passant, promotion) powered by
  [chess.js](https://github.com/jhlywa/chess.js), vendored locally in
  `js/vendor/`.
- Two players share one device/board to play a local game.
- Connect your MetaMask wallet ([ethers.js](https://docs.ethers.org/v5/),
  vendored locally in `js/vendor/`) to see your address and Arcade1870
  balance, and to claim a reward after finishing a game.
- No backend or bundler required — works entirely from static files, ready
  for GitHub Pages.

## Playing locally

Because the app uses ES modules, open it through a local web server rather
than the `file://` protocol, for example:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in a browser with the MetaMask extension
installed.

## Deploying to GitHub Pages

This repo includes a GitHub Actions workflow
(`.github/workflows/static.yml`) that publishes the site to GitHub Pages on
every push to `main`. Make sure **Settings → Pages → Build and
deployment → Source** is set to **GitHub Actions** (this is the default
once the workflow has run once). Alternatively, you can use the classic
**Deploy from a branch** option pointed at `main` / `/ (root)`, since the
site is fully static.

The repository includes a `CNAME` file for `www.cryptochess.org`. In
**Settings → Pages**, enter `www.cryptochess.org` as the custom domain and
enable **Enforce HTTPS** after DNS is configured. In Cloudflare DNS, set a
`www` CNAME to `jcampbell1870.github.io` and configure the apex
`cryptochess.org` to redirect to `https://www.cryptochess.org`; remove
conflicting parking or forwarding records. Set Cloudflare SSL/TLS mode to
**Full** or **Full (strict)**. DNS, redirect, and certificate provisioning
must be completed in GitHub and Cloudflare; they cannot be performed by this
repository.

## Arcade1870 (ARC) token reward vault

The Arcade1870 token contract address is configured in
[`js/config.js`](js/config.js):

```
0x8eddD4edea39c5B5f77662453600F53A202EE47C
```

The ARC token contract does not provide a self-serve reward method. Deploy
[`contracts/Arcade1870RewardVault.sol`](contracts/Arcade1870RewardVault.sol)
to distribute ARC from a separate, pre-funded vault instead.

The vault accepts claims authorized by an off-chain reward signer. This is
essential: a static browser game cannot prove on-chain that someone completed
a game, and an unrestricted public faucet would be immediately drainable.

### Deploy and fund

1. Deploy the contract with the ARC token address
   (`0x8eddD4edea39c5B5f77662453600F53A202EE47C`) and a dedicated reward
   signer's public address. Deploy it on the same chain as ARC.
2. Record the deployed vault address, then transfer ARC to that address using
   the normal ERC-20 `transfer` function. The vault address is safe to publish;
   never put the owner or signer private keys in this repository or website.
3. Run a reward-issuer service that verifies a completed game and creates an
   EIP-712 signature for:
   `Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)`.
   The EIP-712 domain must be named `Arcade1870RewardVault`, use version `1`,
   the deployment chain ID, and the vault address.
4. Set `rewardVaultAddress` and the HTTPS `rewardIssuerUrl` in
   [`js/config.js`](js/config.js). The issuer receives
   `{ "recipient": "<connected MetaMask address>" }` and must return JSON with
   `amount`, `nonce`, `deadline`, and a 65-byte `signature`. The game
   simulates the vault claim before showing MetaMask, then submits
   `claim(amount, nonce, deadline, signature)`. Players pay the gas and
   receive ARC directly in their connected wallet.

The owner can rotate a compromised reward signer and recover unallocated
tokens. Ownership transfer requires the nominated new owner to call
`acceptOwnership`, preventing loss from a mistyped address. Secure both
private keys with a hardware wallet or key-management service. The vault
deliberately rejects expired, replayed, zero-amount, and unauthorized claims.
As with any custodial reward pool, the owner can recover ARC from the vault;
only fund a deployment controlled by an owner you trust.

## Reward issuer service

`backend/` contains a minimal Node.js issuer. It signs EIP-712 claims for the
deployed vault, but requires a server-generated completed-game proof; it is not
an unrestricted faucet. Copy `backend/.env.example`, replace every placeholder,
install dependencies, and run:

```sh
cd backend
npm install
npm start
```

For Render, create a Blueprint from this repository; `render.yaml` sets the
backend root directory, Node runtime, build command, start command, and public
origin. Enter the deployed vault address, reward amount, and dedicated signer
key as protected environment variables in the Render dashboard. Render
provides the service hostname; add `api.cryptochess.org` as a custom domain
there, then create a Cloudflare `api` CNAME pointing to that hostname.
In Render, wait for the custom domain certificate to become active before
enabling Cloudflare proxying; use **DNS only** while troubleshooting.

Put the service behind an HTTPS reverse proxy and set `ALLOWED_ORIGIN` to `https://www.cryptochess.org`. The issuer endpoint is
`https://api.cryptochess.org/claim` once that hostname is deployed and accepts
`{ "recipient": "...", "gameProof": "<64-hex-character HMAC>" }`. A trusted
game-verification service must issue that HMAC only after validating a
completed game. Set the resulting public HTTPS URL and deployed vault address
in `js/config.js`; they remain blank until those services are deployed.
