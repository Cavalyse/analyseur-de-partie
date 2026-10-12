import { Chess } from './vendor/chess.js';

// Évaluation des coups : pourcentage de gain, classification et précision.
// Les formules reprennent celles, publiques, de Lichess (https://lichess.org/page/accuracy).

/**
 * Une évaluation est toujours exprimée du point de vue des Blancs :
 *   { type: 'cp', value }             avantage en centipions
 *   { type: 'mate', value }           mat en `value` coups (positif = les Blancs matent)
 *   { type: 'mate', value: 0, winner } position de mat (winner = 'w' | 'b')
 */

const MATE_CP = 10000;

export function toWhitePov(score, turn) {
  return turn === 'w' ? score : { ...score, value: -score.value };
}

export function evalToCp(ev) {
  if (ev.type === 'cp') return ev.value;
  if (ev.value === 0) return ev.winner === 'w' ? MATE_CP : -MATE_CP;
  return Math.sign(ev.value) * (MATE_CP - Math.abs(ev.value) * 10);
}

/** Probabilité de gain des Blancs, entre 0 et 100. */
export function whiteWinPercent(ev) {
  const cp = Math.max(-1000, Math.min(1000, evalToCp(ev)));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(ev) {
  if (!ev) return '…';
  if (ev.type === 'mate') {
    if (ev.value === 0) return ev.winner === 'w' ? '1-0' : '0-1';
    return `${ev.value > 0 ? '' : '-'}M${Math.abs(ev.value)}`;
  }
  const pawns = ev.value / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

// Icônes SVG (Material Icons, licence Apache 2.0).
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const STAR = svg('M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z');
const THUMB = svg('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z');
const CHECK = svg('M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
const BOOK = svg('M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z');

export const CLASSIFICATIONS = {
  brilliant: { label: 'Brillant', phrase: 'est un coup brillant', icon: '!!' },
  best: { label: 'Meilleur coup', phrase: 'est le meilleur coup', icon: STAR },
  excellent: { label: 'Excellent', phrase: 'est excellent', icon: THUMB },
  good: { label: 'Bon', phrase: 'est un bon coup', icon: CHECK },
  book: { label: 'Théorique', phrase: 'est un coup théorique', icon: BOOK },
  inaccuracy: { label: 'Imprécision', phrase: 'est une imprécision', icon: '?!' },
  mistake: { label: 'Erreur', phrase: 'est une erreur', icon: '?' },
  blunder: { label: 'Gaffe', phrase: 'est une gaffe', icon: '??' },
};

/** Pastille colorée représentant une classification. */
export function classBadge(cls, extraClass = '') {
  const info = CLASSIFICATIONS[cls];
  return `<span class="badge ${cls} ${extraClass}" title="${info.label}">${info.icon}</span>`;
}

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Différence de matériel (en pions) du point de vue de `color`. */
function materialBalance(fen, color) {
  let balance = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = PIECE_VALUES[ch.toLowerCase()];
    if (v === undefined) continue;
    const pieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
    balance += pieceColor === color ? v : -v;
  }
  return balance;
}

/**
 * Un coup est « brillant » si c'est (presque) le meilleur coup, qu'il sacrifie la pièce jouée
 * (l'adversaire la prend et gagne au moins 2 pions de matériel dans la meilleure suite,
 * même après la réponse du joueur) et que la position reste bonne pour lui.
 */
export function isBrilliant({ fenBefore, fenAfter, pvAfter, color, classification, after, moveTo }) {
  if (!['best', 'excellent'].includes(classification) || !pvAfter || pvAfter.length < 2) return false;
  const wpAfter = color === 'w' ? whiteWinPercent(after) : 100 - whiteWinPercent(after);
  if (wpAfter < 50) return false;

  const base = materialBalance(fenBefore, color);
  const chess = new Chess(fenAfter);
  const checkpoints = [];
  let sacrificedPieceTaken = false;
  for (let i = 0; i < Math.min(pvAfter.length, 4); i++) {
    const uci = pvAfter[i];
    let mv;
    try {
      mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
    if (i % 2 === 0 && mv.captured && mv.to === moveTo) sacrificedPieceTaken = true;
    if (i % 2 === 1) checkpoints.push(materialBalance(chess.fen(), color));
  }
  return sacrificedPieceTaken && checkpoints.length > 0 && checkpoints.every((b) => base - b >= 2);
}

/**
 * Classe un coup à partir des évaluations avant/après (point de vue des Blancs).
 * `color` est la couleur du joueur qui a joué le coup.
 */
export function classifyMove({ before, after, color, playedUci, bestUci }) {
  const sign = color === 'w' ? 1 : -1;
  const wpBefore = color === 'w' ? whiteWinPercent(before) : 100 - whiteWinPercent(before);
  const wpAfter = color === 'w' ? whiteWinPercent(after) : 100 - whiteWinPercent(after);
  const drop = Math.max(0, wpBefore - wpAfter);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));

  let classification;
  if (bestUci && playedUci === bestUci) classification = 'best';
  else if (drop < 2) classification = 'excellent';
  else if (drop < 5) classification = 'good';
  else if (drop < 10) classification = 'inaccuracy';
  else if (drop < 20) classification = 'mistake';
  else classification = 'blunder';

  // Un coup qui laisse un mat forcé alors qu'on était gagnant est toujours une gaffe.
  const cpBefore = sign * evalToCp(before);
  const cpAfter = sign * evalToCp(after);
  if (cpBefore > 200 && cpAfter <= -MATE_CP + 1000 && classification !== 'best') classification = 'blunder';

  return { classification, accuracy, winDrop: drop };
}

/** Précision globale : moyenne de la moyenne arithmétique et de la moyenne harmonique. */
export function gameAccuracy(accuracies) {
  if (!accuracies.length) return null;
  const mean = accuracies.reduce((s, a) => s + a, 0) / accuracies.length;
  const harmonic = accuracies.length / accuracies.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return (mean + harmonic) / 2;
}
