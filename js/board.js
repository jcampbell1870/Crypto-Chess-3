import { Chess } from './vendor/chess.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const UNICODE_PIECES = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

// Renders an interactive chess board backed by a chess.js game instance.
export class Board {
  constructor(el, { onGameOver, onMove } = {}) {
    this.el = el;
    this.game = new Chess();
    this.selectedSquare = null;
    this.legalTargets = [];
    this.onGameOver = onGameOver || (() => {});
    this.onMove = onMove || (() => {});

    this.el.addEventListener('click', (event) => {
      const squareEl = event.target.closest('[data-square]');
      if (!squareEl) return;
      this.#handleSquareClick(squareEl.dataset.square);
    });

    this.render();
  }

  reset() {
    this.game.reset();
    this.selectedSquare = null;
    this.legalTargets = [];
    this.render();
  }

  #handleSquareClick(square) {
    if (this.game.game_over()) return;

    if (this.selectedSquare) {
      if (this.legalTargets.includes(square)) {
        this.#makeMove(this.selectedSquare, square);
        this.selectedSquare = null;
        this.legalTargets = [];
        this.render();
        return;
      }

      // Clicking another one of our own pieces re-selects instead of moving.
      const piece = this.game.get(square);
      if (piece && piece.color === this.game.turn()) {
        this.#selectSquare(square);
      } else {
        this.selectedSquare = null;
        this.legalTargets = [];
      }
      this.render();
      return;
    }

    const piece = this.game.get(square);
    if (piece && piece.color === this.game.turn()) {
      this.#selectSquare(square);
      this.render();
    }
  }

  #selectSquare(square) {
    this.selectedSquare = square;
    this.legalTargets = this.game
      .moves({ square, verbose: true })
      .map((m) => m.to);
  }

  #isPromotion(from, to) {
    const piece = this.game.get(from);
    if (!piece || piece.type !== 'p') return false;
    const targetRank = to[1];
    return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1');
  }

  #promptPromotionPiece() {
    const choice = window.prompt('Promote pawn to (q)ueen, (r)ook, (b)ishop, or (n)ight?', 'q');
    const normalized = (choice || '').trim().toLowerCase().charAt(0);
    return ['q', 'r', 'b', 'n'].includes(normalized) ? normalized : 'q';
  }

  #makeMove(from, to) {
    const moveOptions = { from, to };
    if (this.#isPromotion(from, to)) {
      moveOptions.promotion = this.#promptPromotionPiece();
    }

    const move = this.game.move(moveOptions);
    if (!move) return;

    this.onMove(move);

    if (this.game.game_over()) {
      let reason = 'Game over';
      if (this.game.in_checkmate()) {
        const winner = this.game.turn() === 'w' ? 'Black' : 'White';
        reason = `Checkmate — ${winner} wins!`;
      } else if (this.game.in_stalemate()) {
        reason = 'Draw by stalemate.';
      } else if (this.game.in_draw()) {
        reason = 'Draw.';
      }
      this.onGameOver(reason);
    }
  }

  render() {
    this.el.innerHTML = '';
    const inCheckColor = this.game.in_check() ? this.game.turn() : null;

    RANKS.forEach((rank) => {
      FILES.forEach((file) => {
        const square = `${file}${rank}`;
        const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;

        const squareEl = document.createElement('div');
        squareEl.className = `square ${isLight ? 'light' : 'dark'}`;
        squareEl.dataset.square = square;

        if (square === this.selectedSquare) {
          squareEl.classList.add('selected');
        }
        if (this.legalTargets.includes(square)) {
          squareEl.classList.add('legal-target');
        }

        const piece = this.game.get(square);
        if (piece) {
          const pieceEl = document.createElement('span');
          pieceEl.className = 'piece';
          pieceEl.textContent = UNICODE_PIECES[piece.color][piece.type];
          if (piece.type === 'k' && piece.color === inCheckColor) {
            pieceEl.classList.add('in-check');
          }
          squareEl.appendChild(pieceEl);
        }

        this.el.appendChild(squareEl);
      });
    });
  }
}
