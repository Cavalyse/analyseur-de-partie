// Accès à l'API publique de Chess.com (https://www.chess.com/news/view/published-data-api).
// Aucune clé n'est nécessaire et l'API autorise les requêtes depuis le navigateur (CORS).

const API = 'https://api.chess.com/pub';

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Joueur introuvable sur Chess.com.');
  if (res.status === 429) throw new Error('Trop de requêtes vers Chess.com, réessaie dans quelques secondes.');
  if (!res.ok) throw new Error(`Erreur Chess.com (${res.status}).`);
  return res.json();
}

/** Liste des URLs des archives mensuelles du joueur, de la plus récente à la plus ancienne. */
export async function fetchArchives(username) {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,}$/.test(name)) throw new Error("Nom d'utilisateur invalide.");
  const data = await getJson(`${API}/player/${encodeURIComponent(name)}/games/archives`);
  return [...(data.archives || [])].reverse();
}

/** Parties d'une archive mensuelle (échecs standard uniquement), de la plus récente à la plus ancienne. */
export async function fetchArchiveGames(archiveUrl) {
  const data = await getJson(archiveUrl);
  return (data.games || [])
    .filter((g) => g.rules === 'chess' && g.pgn)
    .sort((a, b) => b.end_time - a.end_time);
}

/** Libellé lisible d'une archive, ex. « octobre 2026 ». */
export function archiveLabel(archiveUrl) {
  const m = archiveUrl.match(/(\d{4})\/(\d{2})$/);
  if (!m) return archiveUrl;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

/** Résultat d'une partie du point de vue d'un joueur : 'win' | 'loss' | 'draw'. */
export function resultFor(game, username) {
  const me = game.white.username.toLowerCase() === username.toLowerCase() ? game.white : game.black;
  if (me.result === 'win') return 'win';
  if (DRAW_RESULTS.has(me.result)) return 'draw';
  return 'loss';
}

export const TIME_CLASS_LABELS = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapide',
  daily: 'Quotidien',
};
