// Configuration for the Arcade1870 token reward integration.
//
// This app is a static site (designed for GitHub Pages) with no backend, so
// it can never hold a treasury private key to *send* tokens to players.
// Rewards are claimed from a separately deployed, pre-funded vault. The
// reward issuer signs a claim only after it has verified game completion.
export const CONFIG = {
  // Arcade1870 (ARC) token contract, as provided in the project brief.
  tokenAddress: '0x8eddD4edea39c5B5f77662453600F53A202EE47C',

  // Chain the token lives on. 1 = Ethereum Mainnet. Change this if the token
  // is deployed elsewhere (e.g. a testnet) and MetaMask will be prompted to
  // switch networks automatically.
  chainId: 1,
  chainName: 'Ethereum Mainnet',

  // Set these after deploying Arcade1870RewardVault. These values are public
  // and safe to publish; never place an owner or reward-signer private key here.
  // This same vault/issuer pair can be shared as the treasury for other games
  // (e.g. Crypto Trivia) — see "Sharing the vault across multiple games" in
  // readme.md. Other games should point their own config at the same
  // rewardVaultAddress and a compatible rewardIssuerUrl, never the private key.
  rewardVaultAddress: '0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d',
  rewardIssuerUrl: 'https://crypto-chess-vp7o.onrender.com',
};

// Minimal ERC-20 ABI used for reading token metadata and balances.
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
