// Lecture d'un fichier PGN contenant une ou plusieurs parties (ex. export Chess.com).

/** Découpe le texte d'un fichier PGN en parties (une chaîne PGN par partie). */
export function splitPgn(text) {
  const norm = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!norm) return [];
  // Une nouvelle partie commence par un bloc d'en-têtes précédé d'une ligne vide (les coups,
  // eux, ne commencent jamais par « [ »). On ne garde que les blocs qui contiennent des coups.
  return norm.split(/\n\s*\n(?=\[)/)
    .map((p) => p.trim())
    .filter((p) => /\d+\s*\./.test(p.replace(/\[[^\]]*\]/g, '')));
}

/** En-têtes d'une partie PGN, ex. { White: 'alice', Result: '1-0', … }. */
export function pgnHeaders(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/gm)) headers[m[1]] = m[2].replace(/\\(.)/g, '$1');
  return headers;
}

/** Cadence estimée à partir de l'en-tête TimeControl (ex. « 180+2 » → blitz). */
export function timeClassOf(headers) {
  const tc = headers.TimeControl || '';
  if (tc.includes('/')) return 'daily';
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return '';
  const total = Number(m[1]) + 40 * Number(m[2] || 0);
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  if (total < 3600) return 'rapid';
  return 'daily';
}
