// Configuration for the Arcade1870 token reward integration.
//
// This app is a static site (designed for GitHub Pages) with no backend, so
// it can never hold a treasury private key to *send* tokens to players.
// Instead it expects the ERC-20 contract itself to expose a public
// "claim" style function that a player's own wallet can call to receive a
// small reward for playing. If the deployed contract does not expose such a
// function, the "Claim Reward" button will simply show a friendly error
// explaining that rewards aren't available yet, while balance/wallet
// features continue to work normally.
export const CONFIG = {
  // Arcade1870 (ARC) token contract, as provided in the project brief.
  tokenAddress: '0x8eddD4edea39c5B5f77662453600F53A202EE47C',

  // Chain the token lives on. 1 = Ethereum Mainnet. Change this if the token
  // is deployed elsewhere (e.g. a testnet) and MetaMask will be prompted to
  // switch networks automatically.
  chainId: 1,
  chainName: 'Ethereum Mainnet',

  // Names of contract functions (in priority order) that this app will try
  // to call to claim a "just for playing" reward. The first one that exists
  // on the contract (and does not revert) is used. Update this list if your
  // deployed contract uses a different function name.
  claimFunctionCandidates: ['claimPlayReward', 'claimReward', 'claim'],
};

// Minimal ERC-20 ABI used for reading token metadata/balances plus the
// optional reward-claim functions listed above.
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function claimPlayReward() returns (bool)',
  'function claimReward() returns (bool)',
  'function claim() returns (bool)',
];
