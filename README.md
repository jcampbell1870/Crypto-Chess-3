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
(`.github/workflows/deploy-pages.yml`) that publishes the site to GitHub
Pages on every push to `main`. Enable it by going to
**Settings → Pages → Build and deployment → Source** and selecting
**GitHub Actions**. Alternatively, you can use the classic
**Deploy from a branch** option pointed at `main` / `/ (root)`, since the
site is fully static.

## Arcade1870 (ARC) token reward

The Arcade1870 token contract address is configured in
[`js/config.js`](js/config.js):

```
0x8eddD4edea39c5B5f77662453600F53A202EE47C
```

**Important limitation:** GitHub Pages only serves static files, so this app
has no backend or treasury private key that could push tokens to players.
Instead, after a game finishes, the "Claim Reward" button calls a public
claim function (`claimPlayReward`, `claimReward`, or `claim` — configurable
in `js/config.js`) directly from the player's own connected wallet. For this
to actually pay out tokens, the deployed Arcade1870 contract must implement
one of those functions as a self-serve faucet/reward mechanism. If the
contract doesn't support this, the button will show an explanatory error
while the rest of the app (wallet connection, balance display, chess
gameplay) continues to work.

