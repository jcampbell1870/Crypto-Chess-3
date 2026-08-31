import { CONFIG, ERC20_ABI, REWARD_VAULT_ABI } from './config.js';

// Handles reading Arcade1870 (ARC) token info/balances and attempting to
// claim the "play to earn" reward from the connected wallet.
export class Token {
  constructor(wallet) {
    this.wallet = wallet;
    this.symbol = 'ARC';
    this.decimals = 18;
  }

  async #getContract(withSigner = false) {
    const { ethers } = await import('./vendor/ethers.esm.min.js');
    const providerOrSigner = withSigner ? this.wallet.signer : this.wallet.provider;
    return new ethers.Contract(CONFIG.tokenAddress, ERC20_ABI, providerOrSigner);
  }

  isRewardVaultConfigured() {
    return Boolean(CONFIG.rewardVaultAddress && CONFIG.rewardIssuerUrl);
  }

  async loadMetadata() {
    try {
      const contract = await this.#getContract();
      const [symbol, decimals] = await Promise.all([
        contract.symbol().catch(() => 'ARC'),
        contract.decimals().catch(() => 18),
      ]);
      this.symbol = symbol;
      this.decimals = decimals;
    } catch (error) {
      // Keep defaults; the token may not be reachable on the current
      // network, but we don't want to block the rest of the app.
      console.warn('Unable to load Arcade1870 token metadata:', error);
    }
    return { symbol: this.symbol, decimals: this.decimals };
  }

  async getBalance() {
    const { ethers } = await import('./vendor/ethers.esm.min.js');
    const contract = await this.#getContract();
    const raw = await contract.balanceOf(this.wallet.address);
    return ethers.utils.formatUnits(raw, this.decimals);
  }

  async claimPlayReward() {
    if (!this.isRewardVaultConfigured()) {
      throw new Error('Reward vault setup is incomplete. Configure its address and issuer URL.');
    }

    const issuerUrl = new URL(CONFIG.rewardIssuerUrl);
    if (issuerUrl.protocol !== 'https:') {
      throw new Error('The reward issuer must use HTTPS.');
    }

    const response = await fetch(issuerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: this.wallet.address }),
    });
    if (!response.ok) {
      throw new Error('The reward issuer could not authorize this completed game.');
    }

    const claim = await response.json();
    const { ethers } = await import('./vendor/ethers.esm.min.js');
    let amount;
    let nonce;
    let deadline;
    try {
      amount = ethers.BigNumber.from(claim.amount);
      nonce = ethers.BigNumber.from(claim.nonce);
      deadline = ethers.BigNumber.from(claim.deadline);
    } catch {
      throw new Error('The reward issuer returned a malformed claim.');
    }
    if (
      !ethers.utils.isAddress(CONFIG.rewardVaultAddress) ||
      !ethers.utils.isHexString(claim.signature, 65) ||
      amount.isZero() ||
      deadline.lt(Math.floor(Date.now() / 1000))
    ) {
      throw new Error('The reward issuer returned an invalid or expired claim.');
    }

    const vault = new ethers.Contract(
      CONFIG.rewardVaultAddress,
      REWARD_VAULT_ABI,
      this.wallet.signer
    );
    await vault.callStatic.claim(amount, nonce, deadline, claim.signature);
    const tx = await vault.claim(amount, nonce, deadline, claim.signature);
    const receipt = await tx.wait();
    return receipt.transactionHash;
  }
}
