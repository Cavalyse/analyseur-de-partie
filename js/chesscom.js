// Accès à l'API publique de Chess.com (https://www.chess.com/news/view/published-data-api).
// Aucune clé n'est nécessaire et l'API autorise les requêtes depuis le navigateur (CORS).

const API = 'https://api.chess.com/pub';

const NETWORK_ERROR = 'Impossible de joindre Chess.com. Vérifie ta connexion et désactive un éventuel bloqueur '
  + 'de publicités ou de pistage pour ce site, puis réessaie dans quelques secondes.';
const RETRIES = 3;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Requête JSON vers l'API, avec nouvelles tentatives en cas d'échec réseau ou de limite de
 * requêtes (429). À partir du deuxième essai, le cache du navigateur est contourné, au cas où
 * il contiendrait une réponse inutilisable.
 */
async function getJson(url) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await wait(700 * attempt);
    let res;
    try {
      res = await fetch(url, attempt ? { cache: 'reload' } : {});
    } catch {
      lastError = new Error(NETWORK_ERROR); // « Failed to fetch » : aucune réponse lisible
      continue;
    }
    if (res.status === 404) throw new Error('Joueur introuvable sur Chess.com : vérifie le pseudo.');
    if (res.status === 429) {
      lastError = new Error('Chess.com limite les requêtes trop rapprochées : réessaie dans quelques secondes.');
      continue;
    }
    if (!res.ok) throw new Error(`Chess.com a répondu par une erreur (${res.status}). Réessaie plus tard.`);
    try {
      return await res.json();
    } catch {
      lastError = new Error('Réponse de Chess.com illisible. Réessaie dans quelques secondes.');
    }
  }
  throw lastError;
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
