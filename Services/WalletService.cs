using Crypto_Chess.Models;
using Microsoft.JSInterop;

namespace Crypto_Chess.Services;

public interface IWalletService
{
    Task<WalletConnectionState> ConnectWalletAsync();
    Task<WalletConnectionState> GetWalletStateAsync();
    Task DisconnectWalletAsync();
    Task<bool> SwitchNetworkAsync(int chainId);
}

public class WalletService : IWalletService
{
    private readonly IJSRuntime _jsRuntime;
    private WalletConnectionState _currentState = new();

    public WalletService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    public async Task<WalletConnectionState> ConnectWalletAsync()
    {
        try
        {
            var result = await _jsRuntime.InvokeAsync<WalletConnectionState>("window.metamaskInterop.connectWallet");
            _currentState = result;
            return result;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error connecting wallet: {ex.Message}");
            return new WalletConnectionState { IsConnected = false };
        }
    }

    public async Task<WalletConnectionState> GetWalletStateAsync()
    {
        try
        {
            var result = await _jsRuntime.InvokeAsync<WalletConnectionState>("window.metamaskInterop.getWalletState");
            _currentState = result;
            return result;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error getting wallet state: {ex.Message}");
            return new WalletConnectionState { IsConnected = false };
        }
    }

    public async Task DisconnectWalletAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("window.metamaskInterop.disconnectWallet");
            _currentState = new WalletConnectionState { IsConnected = false };
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error disconnecting wallet: {ex.Message}");
        }
    }

    public async Task<bool> SwitchNetworkAsync(int chainId)
    {
        try
        {
            var result = await _jsRuntime.InvokeAsync<bool>("window.metamaskInterop.switchNetwork", chainId);
            return result;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error switching network: {ex.Message}");
            return false;
        }
    }
}
