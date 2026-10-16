// Mémoire des analyses (dans le navigateur) : rouvrir une partie déjà analysée est instantané,
// et la liste des parties affiche la précision obtenue.

const PREFIX = 'analyse:';
const INDEX_KEY = 'analyses-index';
const MAX_GAMES = 150;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // stockage plein ou indisponible
  }
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Identifiant d'une partie : son lien Chess.com, sinon une empreinte de ses coups. */
export function gameKey(game) {
  if (game.chesscom?.url) return game.chesscom.url;
  return `pgn:${hash(game.positions[0].fen + game.moves.map((m) => m.san).join(' '))}`;
}

/** Résumé (précisions) d'une partie déjà analysée, ou null. */
export function analysisSummary(key) {
  return read(INDEX_KEY)?.[key] || null;
}

/**
 * Données moteur mémorisées pour chaque position ({ eval, best, pv }), si elles existent
 * pour une profondeur au moins égale à celle demandée.
 */
export function loadAnalysis(key, depth, positionCount) {
  const data = read(PREFIX + key);
  if (!data || data.depth < depth || data.positions.length !== positionCount) return null;
  return data.positions.map(([type, value, winner, best, pv]) => ({
    eval: { type: type === 'm' ? 'mate' : 'cp', value, ...(winner ? { winner } : {}) },
    best: best || undefined,
    pv: pv ? pv.split(' ') : undefined,
  }));
}

/** Mémorise l'analyse d'une partie ; les plus anciennes sont oubliées au-delà de MAX_GAMES. */
export function saveAnalysis(key, depth, positions, accuracy) {
  const compact = positions.map((p) => [
    p.eval.type === 'mate' ? 'm' : 'c', p.eval.value, p.eval.winner || 0, p.best || 0, (p.pv || []).slice(0, 8).join(' '),
  ]);
  const index = read(INDEX_KEY) || {};
  index[key] = { t: Date.now(), depth, accuracy };
  const keys = Object.keys(index).sort((a, b) => index[b].t - index[a].t);
  for (const old of keys.slice(MAX_GAMES)) {
    delete index[old];
    try { localStorage.removeItem(PREFIX + old); } catch { /* ignoré */ }
  }
  if (write(PREFIX + key, { depth, positions: compact })) write(INDEX_KEY, index);
}
