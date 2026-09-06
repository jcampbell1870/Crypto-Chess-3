import { Chess } from './vendor/chess.js';

// A lightweight, dependency-free chess AI: minimax search with alpha-beta
// pruning over a material + simple positional evaluation. No external
// engine (e.g. Stockfish) is required, so it works offline in the browser.

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Higher difficulties search deeper (stronger, slower); lower difficulties
// also mix in some random moves so the computer is easy to beat.
const DIFFICULTY_SETTINGS = {
  easy: { depth: 1, randomness: 0.5 },
  medium: { depth: 2, randomness: 0.15 },
  hard: { depth: 3, randomness: 0 },
};

/// Small heuristic bonus for controlling the center and advancing pawns,
/// so the AI doesn't just shuffle pieces around when material is even.
function positionalBonus(piece, rank, file) {
  const centerDistance = Math.abs(3.5 - file) + Math.abs(3.5 - rank);
  const centerBonus = (7 - centerDistance) * 2;
  if (piece.type === 'p') {
    const advancement = piece.color === 'w' ? 7 - rank : rank;
    return centerBonus + advancement * 5;
  }
  if (piece.type === 'n' || piece.type === 'b') {
    return centerBonus * 1.5;
  }
  return centerBonus * 0.5;
}

/// Positive scores favor White, negative scores favor Black.
function evaluateBoard(game) {
  const rows = game.board();
  let score = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = rows[rank][file];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] + positionalBonus(piece, rank, file);
      score += piece.color === 'w' ? value : -value;
    }
  }
  return score;
}

function evaluatePosition(game, depth) {
  if (game.in_checkmate()) {
    // The side to move has been checkmated. Prefer faster mates/slower
    // losses by weighting in the remaining search depth.
    const mateScore = 100000 + depth * 100;
    return game.turn() === 'w' ? -mateScore : mateScore;
  }
  if (game.in_draw() || game.in_stalemate()) {
    return 0;
  }
  return evaluateBoard(game);
}

function minimax(game, depth, alpha, beta, maximizing) {
  if (depth === 0 || game.game_over()) {
    return evaluatePosition(game, depth);
  }

  const moves = game.moves({ verbose: true });
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    game.move(move);
    const score = minimax(game, depth - 1, alpha, beta, !maximizing);
    game.undo();

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/// Picks a move for whichever side is to move in the given FEN, at the
/// requested difficulty ('easy' | 'medium' | 'hard'). Returns a chess.js
/// verbose move object (with `from`/`to`/`promotion`) or null if the
/// position has no legal moves.
export function findBestMove(fen, difficulty = 'medium') {
  const { depth, randomness } = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  if (randomness > 0 && Math.random() < randomness) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const maximizing = game.turn() === 'w';
  let bestMoves = [];
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    game.move(move);
    const score = minimax(game, depth - 1, -Infinity, Infinity, !maximizing);
    game.undo();

    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  // Break ties randomly so the AI doesn't always play the same line.
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

export const AI_DIFFICULTIES = Object.keys(DIFFICULTY_SETTINGS);
