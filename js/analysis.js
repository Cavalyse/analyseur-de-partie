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

export const CLASSIFICATIONS = {
  best: { label: 'Meilleur coup', symbol: '★' },
  excellent: { label: 'Excellent', symbol: '!' },
  good: { label: 'Bon', symbol: '✓' },
  inaccuracy: { label: 'Imprécision', symbol: '?!' },
  mistake: { label: 'Erreur', symbol: '?' },
  blunder: { label: 'Gaffe', symbol: '??' },
};

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
