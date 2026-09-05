namespace Crypto_Chess.Models;

/// <summary>
/// Records a single completed chess game. Unlike Crypto Hockey (single
/// player vs. AI, reward only on a win), Crypto Chess is a local two-player
/// pass-and-play game, so the reward is granted for completing a game
/// (matching the original static site's behavior), and <see cref="Result"/>
/// records the outcome for display/history purposes.
/// </summary>
public class GameSession
{
    public int Id { get; set; }
    public string PlayerAddress { get; set; } = string.Empty;
    public string Result { get; set; } = string.Empty; // e.g. "Checkmate-White", "Stalemate", "Draw"
    public bool PlayerWon { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime EndedAt { get; set; }
    public decimal RewardAmount { get; set; }
    public string? TransactionHash { get; set; }
    public bool RewardClaimed { get; set; }
}
