namespace Crypto_Chess.Models;

public class PlayerProfile
{
    public int Id { get; set; }
    public string WalletAddress { get; set; } = string.Empty;
    public int TotalGames { get; set; }
    public int TotalWins { get; set; }
    public int TotalLosses { get; set; }
    public decimal TotalRewardsEarned { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastPlayedAt { get; set; }
    public List<GameSession> GameSessions { get; set; } = [];

    public double WinRate => TotalGames == 0 ? 0 : (double)TotalWins / TotalGames * 100;
}
