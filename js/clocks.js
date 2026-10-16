// Pendules des parties Chess.com : temps restant après chaque coup et temps passé sur le coup.
// Les PGN de Chess.com contiennent un commentaire {[%clk 0:02:59.9]} après chaque coup.

/**
 * Renvoie, pour chaque coup, { clock, spent } en secondes, ou null si la partie n'a pas de
 * pendules exploitables (PGN collé sans [%clk], partie par correspondance…).
 */
export function parseClocks(pgn, headers, moveCount) {
  const tc = (headers.TimeControl || '').match(/^(\d+)(?:\+(\d+(?:\.\d+)?))?$/);
  if (!tc || !moveCount) return null;
  const base = Number(tc[1]);
  const increment = Number(tc[2] || 0);
  const clocks = [...pgn.matchAll(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g)]
    .map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  if (clocks.length !== moveCount) return null;
  return clocks.map((clock, i) => {
    const before = i >= 2 ? clocks[i - 2] : base;
    return { clock, spent: Math.max(0, before - clock + increment) };
  });
}

/** Temps restant, ex. « 2:41 », « 1:02:05 » ou « 0:09.8 » sous les 20 secondes. */
export function formatClock(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = s < 20 ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${secStr}` : `${m}:${secStr}`;
}

/** Temps passé sur un coup, ex. « 0,8 s », « 12 s » ou « 1:35 ». */
export function formatSpent(seconds) {
  if (seconds < 10) return `${seconds.toFixed(1).replace('.', ',')} s`;
  if (seconds < 59.5) return `${Math.round(seconds)} s`;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
