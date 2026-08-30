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

  // Attempts each candidate claim function in order until one succeeds.
  // Returns the transaction hash on success.
  //
  // Note: the ERC20_ABI claim entries have no state-mutability modifier, so
  // ethers treats them as "nonpayable" (state-changing) functions. Calling
  // them through a signer-connected contract therefore sends a transaction
  // and returns a TransactionResponse (which has `.wait()`), regardless of
  // their declared `returns (bool)` output — ethers only decodes a return
  // value in place for `view`/`pure` functions.
  async claimPlayReward() {
    const contract = await this.#getContract(true);
    let lastError = null;

    for (const fnName of CONFIG.claimFunctionCandidates) {
      if (typeof contract[fnName] !== 'function') continue;
      try {
        const tx = await contract[fnName]();
        const receipt = await tx.wait();
        return receipt.transactionHash;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      lastError
        ? `The Arcade1870 contract rejected the reward claim: ${lastError.reason || lastError.message}`
        : 'The Arcade1870 contract does not currently support claiming a reward directly. Please check back later.'
    );
  }
}
