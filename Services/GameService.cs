using Crypto_Chess.Models;
using Crypto_Chess.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Crypto_Chess.Services;

public interface IGameService
{
    Task<GameSession> CreateGameSessionAsync(string playerAddress);
    Task<GameSession> EndGameSessionAsync(int sessionId, string result, bool playerWon);
    Task<PlayerProfile> GetOrCreatePlayerAsync(string walletAddress);
    Task<List<GameSession>> GetPlayerGameHistoryAsync(string walletAddress, int limit = 10);
    Task<List<PlayerProfile>> GetLeaderboardAsync(int limit = 10);
    Task<bool> ClaimRewardAsync(int sessionId);
}

// Adapted from Crypto Hockey's GameService. Crypto Chess is a local
// two-player pass-and-play game (no AI opponent), so — matching the
// original static site's behavior — the reward is granted for completing
// any game, not only for winning. PlayerWon/TotalWins are still tracked for
// leaderboard/history parity with Crypto Hockey's schema and UI.
public class GameService : IGameService
{
    private readonly GameDbContext _context;
    private readonly IBlockchainService _blockchainService;
    private readonly BlockchainConfig _blockchainConfig;
    private readonly ILogger<GameService> _logger;

    public GameService(
        GameDbContext context,
        IBlockchainService blockchainService,
        IOptions<BlockchainConfig> blockchainConfig,
        ILogger<GameService> logger)
    {
        _context = context;
        _blockchainService = blockchainService;
        _blockchainConfig = blockchainConfig.Value;
        _logger = logger;
    }

    public async Task<GameSession> CreateGameSessionAsync(string playerAddress)
    {
        var session = new GameSession
        {
            PlayerAddress = playerAddress,
            StartedAt = DateTime.UtcNow,
            RewardClaimed = false
        };

        _context.GameSessions.Add(session);
        await _context.SaveChangesAsync();

        return session;
    }

    public async Task<GameSession> EndGameSessionAsync(int sessionId, string result, bool playerWon)
    {
        var session = await _context.GameSessions.FindAsync(sessionId);
        if (session == null)
            throw new InvalidOperationException($"Game session {sessionId} not found");

        session.EndedAt = DateTime.UtcNow;
        session.Result = result;
        session.PlayerWon = playerWon;

        // Reward is granted for completing a game (see class remarks above).
        if (!decimal.TryParse(_blockchainConfig.RewardAmount, out var rewardAmount))
        {
            rewardAmount = 10m;
        }
        session.RewardAmount = rewardAmount;

        _context.GameSessions.Update(session);
        await _context.SaveChangesAsync();

        // Update player profile
        var player = await GetOrCreatePlayerAsync(session.PlayerAddress);
        player.TotalGames++;
        player.LastPlayedAt = DateTime.UtcNow;

        if (session.PlayerWon)
        {
            player.TotalWins++;
        }
        else
        {
            player.TotalLosses++;
        }

        player.TotalRewardsEarned += session.RewardAmount;

        _context.PlayerProfiles.Update(player);
        await _context.SaveChangesAsync();

        return session;
    }

    public async Task<PlayerProfile> GetOrCreatePlayerAsync(string walletAddress)
    {
        var player = await _context.PlayerProfiles
            .FirstOrDefaultAsync(p => p.WalletAddress == walletAddress);

        if (player == null)
        {
            player = new PlayerProfile
            {
                WalletAddress = walletAddress,
                CreatedAt = DateTime.UtcNow,
                TotalGames = 0,
                TotalWins = 0,
                TotalLosses = 0,
                TotalRewardsEarned = 0
            };

            _context.PlayerProfiles.Add(player);
            await _context.SaveChangesAsync();
        }

        return player;
    }

    public async Task<List<GameSession>> GetPlayerGameHistoryAsync(string walletAddress, int limit = 10)
    {
        return await _context.GameSessions
            .Where(g => g.PlayerAddress == walletAddress)
            .OrderByDescending(g => g.EndedAt)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<List<PlayerProfile>> GetLeaderboardAsync(int limit = 10)
    {
        return await _context.PlayerProfiles
            .OrderByDescending(p => p.TotalWins)
            .ThenByDescending(p => p.TotalRewardsEarned)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<bool> ClaimRewardAsync(int sessionId)
    {
        var session = await _context.GameSessions.FindAsync(sessionId);
        if (session == null || session.RewardClaimed || session.EndedAt == default)
            return false;

        var success = await _blockchainService.SendRewardAsync(
            session.PlayerAddress,
            session.RewardAmount,
            _blockchainConfig.DefaultNetworkChainId);

        if (success)
        {
            session.RewardClaimed = true;
            _context.GameSessions.Update(session);
            await _context.SaveChangesAsync();
            _logger.LogInformation("Reward claimed for session {SessionId}", sessionId);
        }

        return success;
    }
}
