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

  // Fixed reward earned per completed game, mirroring Crypto Hockey's
  // reward system (10 A1870 per game). This is a display value only — the
  // reward issuer's signed claim is always the source of truth for amount.
  rewardAmount: '10',

  // Networks supported for the Arcade1870 token, matching the chain set
  // Crypto Hockey supports (Ethereum Mainnet, Sepolia testnet, Polygon
  // Mainnet). Used to let MetaMask add/switch to any of these networks.
  supportedNetworks: [
    { chainId: 1, chainName: 'Ethereum Mainnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY'], blockExplorerUrls: ['https://etherscan.io'] },
    { chainId: 11155111, chainName: 'Sepolia Testnet', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY'], blockExplorerUrls: ['https://sepolia.etherscan.io'] },
    { chainId: 137, chainName: 'Polygon Mainnet', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] },
  ],

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
