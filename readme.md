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

### Parity with Crypto Hockey's reward system

[Crypto Hockey](https://github.com/jcampbell1870/Crypto-Hockey) is a
companion Arcade1870 game with its own (server-backed) reward system. Crypto
Chess is configured to match its reward parameters as closely as its static,
no-backend architecture allows:

- **Same token**: both games use the Arcade1870 (ARC) contract at
  `0x8eddD4edea39c5B5f77662453600F53A202EE47C`.
- **Same reward amount**: 10 ARC per completed game (`rewardAmount` in
  [`js/config.js`](js/config.js) and the recommended `REWARD_AMOUNT` value in
  [`render.yaml`](render.yaml)), matching Crypto Hockey's fixed
  `RewardAmount: "10"`.
- **Same supported networks**: Ethereum Mainnet (`1`), Sepolia Testnet
  (`11155111`), and Polygon Mainnet (`137`) are all listed in
  `CONFIG.supportedNetworks`, matching Crypto Hockey's
  `SupportedChainIds`. MetaMask will prompt to add any of these networks if
  missing, the same way Crypto Hockey's `SwitchNetworkAsync` does.
- **Same domain strategy**: the site is served at
  `https://www.cryptochess.org/` (see [`CNAME`](CNAME)) fronted by
  Cloudflare, mirroring how Crypto Hockey is deployed behind its own
  Cloudflare-proxied domain.

Crypto Chess still differs where its architecture requires it: it has no
backend or database, so it uses a pre-funded, signature-gated reward vault
(see above) instead of Crypto Hockey's server-side custodial wallet that
sends rewards directly after validating a win against its game database.

### Sharing the vault across multiple games

The vault and reward-issuer pattern above are chain- and consumer-agnostic:
they only validate a signed claim, and don't care which front end requested
it. This means a single deployed, funded `Arcade1870RewardVault` can act as
the shared treasury for more than one game — for example, both Crypto Chess
and a companion game like Crypto Trivia can point at the **same**
`rewardVaultAddress`.

To let another game reuse this treasury:

- Do **not** deploy a second vault; reuse the existing vault address as-is.
- The other game's own config (in its own repository) sets the same
  `rewardVaultAddress` and either the same `rewardIssuerUrl`, or its own
  issuer endpoint that signs claims with the same reward-signer key/EIP-712
  domain (`Arcade1870RewardVault`, version `1`, this vault's chain ID and
  address). The vault only validates the signature, not the origin game.
- The reward-signer private key and `REWARD_SIGNER_PRIVATE_KEY` /
  `GAME_VERIFICATION_SECRET` values stay in this service's Render
  environment (or the equivalent secret store for a dedicated issuer); never
  copy them into the other game's repo, config file, or public site.
- Confirm the other game prompts MetaMask to switch to the same `chainId`
  the vault and token are deployed on.
