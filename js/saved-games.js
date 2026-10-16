// Parties mémorisées dans le navigateur : la liste des parties Chess.com (avec leur PGN) reste
// disponible quand Chess.com est injoignable, et le dernier fichier PGN importé est conservé.

const USER_PREFIX = 'parties:';
const USERS_KEY = 'parties-utilisateurs';
const IMPORT_KEY = 'pgn-importe';
const MAX_USERS = 3;
const MAX_MONTHS = 6;
const MAX_IMPORT_CHARS = 1_000_000;

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
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignoré */ }
}

/** Seuls les champs utiles à la liste et à l'analyse sont conservés. */
function slim(g) {
  const player = (p) => ({ username: p.username, rating: p.rating, result: p.result });
  return {
    url: g.url,
    pgn: g.pgn,
    rules: g.rules,
    time_class: g.time_class,
    end_time: g.end_time,
    white: player(g.white),
    black: player(g.black),
    ...(g.accuracies ? { accuracies: g.accuracies } : {}),
  };
}

/** Parties mémorisées pour un pseudo : { savedAt, archives, months: { urlArchive: [parties] } }. */
export function loadSavedGames(username) {
  return read(USER_PREFIX + username.toLowerCase());
}

/** Mémorise les parties d'un mois (et la liste des mois) pour un pseudo. */
export function saveMonth(username, archives, archiveUrl, games) {
  const name = username.toLowerCase();
  const data = loadSavedGames(name) || { months: {} };
  data.savedAt = Date.now();
  data.archives = archives;
  data.months[archiveUrl] = games.map(slim);
  // On garde les mois les plus récents.
  const kept = archives.filter((url) => data.months[url]).slice(0, MAX_MONTHS);
  data.months = Object.fromEntries(kept.map((url) => [url, data.months[url]]));

  // Si le stockage est plein, on oublie les mois les plus anciens.
  while (!write(USER_PREFIX + name, data)) {
    const urls = Object.keys(data.months);
    if (urls.length <= 1) return;
    delete data.months[urls[urls.length - 1]];
  }

  const users = (read(USERS_KEY) || []).filter((u) => u !== name);
  users.unshift(name);
  for (const old of users.splice(MAX_USERS)) remove(USER_PREFIX + old);
  write(USERS_KEY, users);
}

/** Dernier fichier PGN importé : { name, text } ou null. */
export function loadImport() {
  return read(IMPORT_KEY);
}

export function saveImport(name, text) {
  if (text.length <= MAX_IMPORT_CHARS) write(IMPORT_KEY, { name, text });
}

export function clearImport() {
  remove(IMPORT_KEY);
}
