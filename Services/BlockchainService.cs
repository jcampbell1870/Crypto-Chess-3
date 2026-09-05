using Nethereum.Web3;
using Nethereum.Contracts.Standards.ERC20.ContractDefinition;
using Crypto_Chess.Models;
using Microsoft.Extensions.Options;

namespace Crypto_Chess.Services;

public interface IBlockchainService
{
    Task<bool> SendRewardAsync(string walletAddress, decimal amount, int chainId);
    Task<decimal> GetTokenBalanceAsync(string walletAddress, int chainId);
    Task<bool> ValidateWalletAsync(string walletAddress);
}

// Ported from Crypto Hockey's BlockchainService. As in that project, actual
// on-chain payout requires a funded backend signer key (set via the
// REWARD_SIGNER_PRIVATE_KEY environment variable in Render and wired into a
// Nethereum Account/Web3 instance here) which is intentionally not committed
// to source control. Until that key is configured, rewards are recorded in
// the database and SendRewardAsync only validates and logs the request, the
// same placeholder behavior Crypto Hockey ships with.
public class BlockchainService : IBlockchainService
{
    private readonly BlockchainConfig _config;
    private readonly ILogger<BlockchainService> _logger;

    public BlockchainService(IOptions<BlockchainConfig> config, ILogger<BlockchainService> logger)
    {
        _config = config.Value;
        _logger = logger;
    }

    public async Task<bool> SendRewardAsync(string walletAddress, decimal amount, int chainId)
    {
        try
        {
            if (!IsValidAddress(walletAddress))
                return false;

            var rpcUrl = GetRpcUrlForChain(chainId);
            if (string.IsNullOrEmpty(rpcUrl))
            {
                _logger.LogError("No RPC URL configured for chain {ChainId}", chainId);
                return false;
            }

            var web3 = new Web3(rpcUrl);

            // Note: In production, you would need a backend wallet to send tokens.
            // This is a placeholder showing the structure. For now, rewards are
            // recorded in the database.
            _logger.LogInformation(
                "Reward of {Amount} tokens prepared for {WalletAddress} on chain {ChainId}",
                amount, walletAddress, chainId);

            return await Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending reward");
            return false;
        }
    }

    public async Task<decimal> GetTokenBalanceAsync(string walletAddress, int chainId)
    {
        try
        {
            if (!IsValidAddress(walletAddress))
                return 0;

            var rpcUrl = GetRpcUrlForChain(chainId);
            if (string.IsNullOrEmpty(rpcUrl))
                return 0;

            var web3 = new Web3(rpcUrl);

            // Call contract to get balance
            var balanceOfFunctionMessage = new BalanceOfFunction { Owner = walletAddress };
            var handler = web3.Eth.GetContractQueryHandler<BalanceOfFunction>();

            var balance = await handler.QueryAsync<decimal>(
                _config.Arcade1870ContractAddress,
                balanceOfFunctionMessage);

            return balance;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting token balance");
            return 0;
        }
    }

    public async Task<bool> ValidateWalletAsync(string walletAddress)
    {
        return await Task.FromResult(IsValidAddress(walletAddress));
    }

    private static bool IsValidAddress(string address)
    {
        return !string.IsNullOrEmpty(address) && address.StartsWith("0x") && address.Length == 42;
    }

    private string GetRpcUrlForChain(int chainId)
    {
        return chainId switch
        {
            1 => _config.EthereumRpcUrl,
            11155111 => _config.SepoliaRpcUrl,
            137 => _config.PolygonRpcUrl,
            _ => string.Empty
        };
    }
}
