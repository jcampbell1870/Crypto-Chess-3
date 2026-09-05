namespace Crypto_Chess.Models;

public class WalletConnectionState
{
    public bool IsConnected { get; set; }
    public string? Address { get; set; }
    public int ChainId { get; set; }
    public string ChainName { get; set; } = string.Empty;
    public decimal Balance { get; set; }
}
