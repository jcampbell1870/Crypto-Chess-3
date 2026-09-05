namespace Crypto_Chess.Models;

public class BlockchainConfig
{
    public string Arcade1870ContractAddress { get; set; } = string.Empty;
    public string RewardAmount { get; set; } = "10";
    public string EthereumRpcUrl { get; set; } = string.Empty;
    public string SepoliaRpcUrl { get; set; } = string.Empty;
    public string PolygonRpcUrl { get; set; } = string.Empty;
    public int DefaultNetworkChainId { get; set; } = 1;
    public int[] SupportedChainIds { get; set; } = [];
}
