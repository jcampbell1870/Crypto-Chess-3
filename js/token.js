import { CONFIG, ERC20_ABI } from './config.js';

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

  // Simulates each candidate before asking the wallet to submit a transaction.
  // This avoids charging players gas for unsupported or unavailable claims.
  async claimPlayReward() {
    const contract = await this.#getContract(true);
    let lastSimulationError = null;

    for (const fnName of CONFIG.claimFunctionCandidates) {
      try {
        await contract.callStatic[fnName]();
      } catch (error) {
        lastSimulationError = error;
        continue;
      }

      try {
        const tx = await contract[fnName]();
        const receipt = await tx.wait();
        return receipt.transactionHash;
      } catch (error) {
        throw new Error(
          `The Arcade1870 contract rejected the reward claim: ${error.reason || error.message}`
        );
      }
    }

    const reason = lastSimulationError?.reason;
    throw new Error(
      reason
        ? `The Arcade1870 reward claim is unavailable: ${reason}`
        : 'The Arcade1870 contract does not currently expose an available self-serve reward claim. No transaction was sent; contact the Arcade1870 project for reward details.'
    );
  }
}
