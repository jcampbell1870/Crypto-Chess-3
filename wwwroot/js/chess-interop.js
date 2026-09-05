// Bridges the existing vendored chess.js engine and board.js DOM renderer
// into the Blazor Server "Game" page via JS interop, mirroring how Crypto
// Hockey's canvas-based gameRenderer is invoked from its Game.razor page.
import { Board } from './board.js';

let boardInstance = null;
let dotNetRef = null;

function resolveWinner(reason) {
    if (!reason) return null;
    if (reason.includes('White')) return 'White';
    if (reason.includes('Black')) return 'Black';
    return null;
}

window.chessInterop = {
    init(containerId, dotNetReference) {
        dotNetRef = dotNetReference;
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`chess-interop: container #${containerId} not found`);
            return;
        }

        boardInstance = new Board(container, {
            onMove: () => {
                const turn = boardInstance.game.turn() === 'w' ? 'White' : 'Black';
                const inCheck = boardInstance.game.in_check();
                dotNetRef?.invokeMethodAsync('OnMove', turn, inCheck);
            },
            onGameOver: (reason) => {
                dotNetRef?.invokeMethodAsync('OnGameOver', reason, resolveWinner(reason));
            },
        });
    },

    reset() {
        boardInstance?.reset();
    },
};
