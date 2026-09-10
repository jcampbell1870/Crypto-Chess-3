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

  async addToWallet() {
    if (!window.ethereum?.request) return false;
    return window.ethereum.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: CONFIG.tokenAddress,
          symbol: this.symbol,
          decimals: this.decimals,
        },
      },
    });
  }

  async claimPlayReward(game) {
    if (!this.isRewardVaultConfigured()) {
      throw new Error('Reward vault setup is incomplete. Configure its address and issuer URL.');
    }

    const issuerUrl = new URL(CONFIG.rewardIssuerUrl, window.location.origin);
    const isLocalIssuer = ['localhost', '127.0.0.1'].includes(issuerUrl.hostname);
    if (issuerUrl.protocol !== 'https:' && !isLocalIssuer) {
      throw new Error('The reward issuer must use HTTPS.');
    }

    let response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        response = await fetch(issuerUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: this.wallet.address, game }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const reason = error.name === 'AbortError'
        ? 'The reward service took too long to respond.'
        : 'The reward service is unavailable or blocked by browser CORS settings.';
      throw new Error(
        `${reason} Verify that the Render reward service is deployed and running.`
      );
    }
    if (!response.ok) {
      let issuerError = '';
      try {
        const errorPayload = await response.json();
        issuerError = typeof errorPayload.error === 'string' ? ` ${errorPayload.error}` : '';
      } catch {
        // Keep the user-facing message useful when the issuer returns HTML or
        // an empty response, such as a missing deployment route.
      }
      throw new Error(
        `The reward issuer could not authorize this completed game (${response.status}).${issuerError}`
      );
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
    const vaultAddress = claim.vaultAddress || CONFIG.rewardVaultAddress;
    if (
      !ethers.utils.isAddress(vaultAddress) ||
      !ethers.utils.isHexString(claim.signature, 65) ||
      amount.isZero() ||
      deadline.lt(Math.floor(Date.now() / 1000)) ||
      Number(claim.chainId) !== CONFIG.chainId
    ) {
      throw new Error('The reward issuer returned an invalid, expired, or mismatched claim.');
    }

    const vault = new ethers.Contract(
      vaultAddress,
      REWARD_VAULT_ABI,
      this.wallet.signer
    );
    await vault.callStatic.claim(amount, nonce, deadline, claim.signature);
    const tx = await vault.claim(amount, nonce, deadline, claim.signature);
    const receipt = await tx.wait();
    const tokenInterface = new ethers.utils.Interface(ERC20_ABI);
    const transfer = receipt.logs
      .filter((log) => log.address.toLowerCase() === CONFIG.tokenAddress.toLowerCase())
      .map((log) => {
        try {
          return tokenInterface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) =>
        event?.name === 'Transfer' &&
        event.args.from.toLowerCase() === vaultAddress.toLowerCase() &&
        event.args.to.toLowerCase() === this.wallet.address.toLowerCase() &&
        event.args.value.eq(amount)
      );
    if (!transfer) {
      throw new Error(
        `The transaction was confirmed, but no ARC transfer to your wallet was detected. ` +
        `Verify that the vault at ${vaultAddress} uses token ${CONFIG.tokenAddress}. ` +
        `Transaction: ${receipt.transactionHash}`
      );
    }
    return receipt.transactionHash;
  }
}
