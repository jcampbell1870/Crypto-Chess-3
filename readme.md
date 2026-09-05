# Crypto-Chess-3

**Crypto Chess** is a browser-playable chess game with MetaMask wallet
integration and Arcade1870 (ARC) ERC-20 token rewards for playing. It is a
**Blazor Server + EF Core** app — the same backend architecture as its
companion game, [Crypto Hockey](https://github.com/jcampbell1870/Crypto-Hockey)
— deployed to [Render](https://render.com) with a managed PostgreSQL
database, rather than a static site.

## Architecture

- **ASP.NET Core Blazor Server** (`.NET 10`, Interactive Server render mode)
  hosts the UI (`Components/Pages/*.razor`) and owns all game/player state
  server-side.
- **EF Core + PostgreSQL** (`Npgsql.EntityFrameworkCore.PostgreSQL`) persists
  `PlayerProfile` and `GameSession` records (`Data/GameDbContext.cs`,
  `Data/Migrations/`). Render's first-party managed Postgres is used instead
  of Crypto Hockey's SQL Server, since that's what Render offers.
- **Nethereum** (`Services/BlockchainService.cs`) prepares Arcade1870 (ARC)
  reward payouts, mirroring Crypto Hockey's `BlockchainService`.
- **Chess rules stay client-side**: the existing vendored
  [chess.js](https://github.com/jhlywa/chess.js) engine and DOM board
  renderer (`wwwroot/js/vendor/chess.js`, `wwwroot/js/board.js`) run in the
  browser and are bridged into Blazor via JS interop
  (`wwwroot/js/chess-interop.js`), the same way Crypto Hockey bridges its
  canvas renderer.
- **MetaMask wallet connection** (`wwwroot/js/wallet-interop.js`) is a port of
  Crypto Hockey's `metamask-interop.js`, called from `Services/WalletService.cs`.
- Two players share one device/board to play a local game; a reward is
  granted for **completing** a game (win, loss, or draw), matching the
  original static site's "play and earn" behavior.

## Running locally

Prerequisites: [.NET 10 SDK](https://dotnet.microsoft.com/download) and a
PostgreSQL instance (e.g. via Docker:
`docker run -e POSTGRES_PASSWORD=<your-password> -p 5432:5432 postgres:16-alpine`).

1. Set the connection string, either in `appsettings.Development.json` (not
   committed) or an environment variable, e.g.:
   ```
   ConnectionStrings__DefaultConnection=Host=localhost;Port=5432;Database=cryptochess;Username=postgres;******
   ```
2. Run the app — pending EF Core migrations are applied automatically on
   startup:
   ```sh
   dotnet run
   ```
3. Visit the URL printed in the console (Home `/`, Play `/game`,
   Leaderboard `/leaderboard`).

## Deploying to Render

This repo includes a [`Dockerfile`](Dockerfile) and [`render.yaml`](render.yaml)
Render Blueprint that provisions:

- A **web service** (`env: docker`) built from the `Dockerfile`.
- A managed **PostgreSQL database** (`crypto-chess-db`), whose connection
  string is wired into the web service automatically via
  `ConnectionStrings__DefaultConnection`.

To deploy:

1. In the Render dashboard, create a new Blueprint from this repository —
   Render will read `render.yaml` and provision both resources.
2. Set the non-synced environment variables Render prompts for
   (`BlockchainConfig__EthereumRpcUrl`, `BlockchainConfig__SepoliaRpcUrl`,
   `BlockchainConfig__PolygonRpcUrl`, and optionally
   `REWARD_SIGNER_PRIVATE_KEY` if/when real on-chain payouts are wired up).
3. EF Core migrations run automatically on container startup
   (`db.Database.Migrate()` in `Program.cs`), so no manual migration step is
   required for a fresh database.
4. **Custom domain**: point `www.cryptochess.org` at the new Render service
   from the Render dashboard (Settings → Custom Domains), then update the
   Cloudflare DNS record (CNAME) to Render's provided target. This replaces
   the old GitHub Pages `CNAME` file, which has been removed since hosting
   has moved off GitHub Pages.

## Arcade1870 (ARC) token reward

The Arcade1870 token contract address and reward amount are configured in
`appsettings.json` under `BlockchainConfig`:

```
Arcade1870ContractAddress: 0x8eddD4edea39c5B5f77662453600F53A202EE47C
RewardAmount: 10
```

`Services/BlockchainService.SendRewardAsync` currently validates the
recipient address, resolves the configured RPC URL for the chain, and logs
that a reward was prepared — it does not yet broadcast a real transaction,
matching Crypto Hockey's own placeholder implementation. Wiring up genuine
on-chain payouts requires configuring a `REWARD_SIGNER_PRIVATE_KEY` for a
funded treasury wallet.

### Legacy client-side reward vault

Before the Blazor/EF Core migration, this game used a pre-funded,
signature-gated `Arcade1870RewardVault` smart contract
([`contracts/Arcade1870RewardVault.sol`](contracts/Arcade1870RewardVault.sol))
so a static, backend-less site could still safely gate reward claims. That
contract is kept in the repo as a documented alternative/legacy reward path
(e.g. for a future fully-decentralized deployment) but is **not** used by the
current Blazor Server backend, which grants rewards server-side after
recording a completed `GameSession` in the database.

### Parity with Crypto Hockey's reward system

Crypto Chess's reward configuration is intentionally kept in parity with
[Crypto Hockey](https://github.com/jcampbell1870/Crypto-Hockey):

- **Same token**: both games use the Arcade1870 (ARC) contract at
  `0x8eddD4edea39c5B5f77662453600F53A202EE47C`.
- **Same reward amount**: 10 ARC per completed game
  (`BlockchainConfig:RewardAmount` in `appsettings.json`, matching Crypto
  Hockey's fixed `RewardAmount: "10"`).
- **Same supported networks**: Ethereum Mainnet (`1`), Sepolia Testnet
  (`11155111`), and Polygon Mainnet (`137`)
  (`BlockchainConfig:SupportedChainIds`), matching Crypto Hockey's
  `SupportedChainIds`. MetaMask will prompt to add any of these networks if
  missing, via `wallet-interop.js`'s `switchNetwork`, the same way Crypto
  Hockey's `SwitchNetworkAsync` does.
- **Same domain strategy**: the site is served at
  `https://www.cryptochess.org/`, fronted by Cloudflare — see the "Custom
  domain" step above for how this is now configured via Render instead of
  GitHub Pages' `CNAME` file.
