import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import { Engine } from './engine.js';
import { initFeedback } from './feedback.js';
import { EvalGraph } from './graph.js';
import {
  CLASSIFICATIONS, classBadge, classifyMove, formatEval, gameAccuracy, isBrilliant, toWhitePov, whiteWinPercent,
} from './analysis.js';
import {
  TIME_CLASS_LABELS, archiveLabel, fetchArchiveGames, fetchArchives, resultFor,
} from './chesscom.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  username: '',
  archives: [],
  archiveIndex: 0,
  game: null, // { headers, chesscom, positions, moves }
  ply: 0,
  flipped: false,
  token: 0,
  analysing: false,
};

const board = new Board($('#board'));
const graph = new EvalGraph($('#graph'), (ply) => goTo(ply));
let engine = null;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée…) : on ignore.
  }
  return null;
}

/* ---------- Onglets ---------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#tab-chesscom').hidden = tab.dataset.tab !== 'chesscom';
    $('#tab-pgn').hidden = tab.dataset.tab !== 'pgn';
  });
});

/* ---------- Recherche Chess.com ---------- */

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#username').value.trim();
  if (!username) return;
  state.username = username;
  storage('username', username);
  $('#games-list').innerHTML = '';
  $('#more-games').hidden = true;
  $('#search-status').textContent = 'Recherche des parties…';
  try {
    state.archives = await fetchArchives(username);
    state.archiveIndex = 0;
    if (!state.archives.length) {
      $('#search-status').textContent = 'Aucune partie trouvée pour ce joueur.';
      return;
    }
    await loadNextArchive();
  } catch (err) {
    $('#search-status').textContent = err.message || 'Impossible de contacter Chess.com.';
  }
});

$('#more-games').addEventListener('click', () => loadNextArchive());

async function loadNextArchive() {
  const url = state.archives[state.archiveIndex];
  if (!url) return;
  $('#more-games').disabled = true;
  $('#search-status').textContent = `Chargement de ${archiveLabel(url)}…`;
  try {
    const games = await fetchArchiveGames(url);
    state.archiveIndex += 1;
    appendGames(games, archiveLabel(url));
    const total = $('#games-list').querySelectorAll('.game').length;
    $('#search-status').textContent = `${total} partie${total > 1 ? 's' : ''} chargée${total > 1 ? 's' : ''}.`;
    $('#more-games').hidden = state.archiveIndex >= state.archives.length;
  } catch (err) {
    $('#search-status').textContent = err.message;
  } finally {
    $('#more-games').disabled = false;
  }
}

function appendGames(games, label) {
  const list = $('#games-list');
  const heading = document.createElement('li');
  heading.className = 'month';
  heading.textContent = `${label} — ${games.length} partie${games.length > 1 ? 's' : ''}`;
  list.append(heading);

  for (const g of games) {
    const meIsWhite = g.white.username.toLowerCase() === state.username.toLowerCase();
    const me = meIsWhite ? g.white : g.black;
    const opp = meIsWhite ? g.black : g.white;
    const result = resultFor(g, state.username);
    const date = new Date(g.end_time * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const li = document.createElement('li');
    li.className = 'game';
    li.innerHTML = `
      <button type="button">
        <span class="result ${result}">${{ win: 'V', loss: 'D', draw: 'N' }[result]}</span>
        <span class="game-main">
          <span class="opponent"><span class="color-dot ${meIsWhite ? 'w' : 'b'}"></span>vs ${escapeHtml(opp.username)} <span class="muted">(${opp.rating})</span></span>
          <span class="muted small">${TIME_CLASS_LABELS[g.time_class] || g.time_class} · ${date} · ${me.rating}</span>
        </span>
      </button>`;
    li.querySelector('button').addEventListener('click', () => {
      list.querySelectorAll('.game.selected').forEach((el) => el.classList.remove('selected'));
      li.classList.add('selected');
      loadGame(g.pgn, { chesscom: g, flipped: !meIsWhite });
    });
    list.append(li);
  }
}

/* ---------- PGN collé ---------- */

$('#pgn-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pgn = $('#pgn-input').value.trim();
  if (!pgn) return;
  try {
    loadGame(pgn, {});
    $('#pgn-status').textContent = '';
  } catch {
    $('#pgn-status').textContent = 'PGN invalide : vérifie le texte collé.';
  }
});

/* ---------- Chargement et analyse d'une partie ---------- */

function loadGame(pgn, { chesscom = null, flipped = false }) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const startFen = history.length ? history[0].before : chess.fen();

  const positions = [{ fen: startFen }];
  const moves = history.map((m) => {
    positions.push({ fen: m.after });
    return {
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      from: m.from,
      to: m.to,
      color: m.color,
    };
  });

  state.game = { headers: chess.getHeaders(), chesscom, positions, moves, pgn };
  state.flipped = flipped;
  state.ply = 0;

  $('#placeholder').hidden = true;
  $('#analysis').hidden = false;
  buildMoveList();
  render();
  runAnalysis();
}

async function runAnalysis() {
  const token = ++state.token;
  const { positions, moves } = state.game;
  const depth = Number($('#depth').value);

  try {
    if (!engine) engine = new Engine();
    if (state.analysing) engine.stop();
    state.analysing = true;
    setProgress(0, 'Démarrage de Stockfish…');
    await engine.newGame();
  } catch (err) {
    state.analysing = false;
    setProgress(0, err.message || "Impossible de démarrer le moteur d'analyse.");
    return;
  }

  for (let i = 0; i < positions.length; i++) {
    if (token !== state.token) return;
    const pos = positions[i];
    const chess = new Chess(pos.fen);
    if (chess.isCheckmate()) {
      pos.eval = { type: 'mate', value: 0, winner: chess.turn() === 'w' ? 'b' : 'w' };
    } else if (chess.isStalemate() || chess.isInsufficientMaterial()) {
      pos.eval = { type: 'cp', value: 0 };
    } else {
      const r = await engine.analyse(pos.fen, depth);
      if (token !== state.token) return;
      pos.eval = toWhitePov(r.score, chess.turn());
      pos.best = r.bestMove;
      pos.pv = r.pv;
    }

    if (i > 0) {
      const move = moves[i - 1];
      const prev = positions[i - 1];
      Object.assign(move, classifyMove({
        before: prev.eval, after: pos.eval, color: move.color, playedUci: move.uci, bestUci: prev.best,
      }));
      if (isBrilliant({
        fenBefore: prev.fen, fenAfter: pos.fen, pvAfter: pos.pv, color: move.color,
        classification: move.classification, after: pos.eval, moveTo: move.to,
      })) move.classification = 'brilliant';
      if (prev.best && prev.best !== move.uci) move.bestSan = uciToSan(prev.fen, prev.best);
      updateMoveCell(i - 1);
    }

    setProgress((i + 1) / positions.length, `Analyse : ${i + 1} / ${positions.length} positions`);
    if (i === state.ply || i === state.ply - 1 || i % 4 === 0) render();
  }

  state.analysing = false;
  setProgress(1, `Analyse terminée (profondeur ${depth})`);
  render();
}

function uciToSan(fen, uci) {
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

$('#depth').addEventListener('change', () => {
  if (state.game) {
    state.game.positions.forEach((p) => { delete p.eval; delete p.best; delete p.pv; });
    state.game.moves.forEach((m) => { delete m.classification; delete m.accuracy; delete m.bestSan; });
    buildMoveList();
    render();
    runAnalysis();
  }
});

/* ---------- Affichage ---------- */

function setProgress(ratio, text) {
  $('#progress-fill').style.width = `${Math.round(ratio * 100)}%`;
  $('#progress-text').textContent = text;
  $('#progress').classList.toggle('done', ratio >= 1);
}

function buildMoveList() {
  const { moves, positions } = state.game;
  const container = $('#moves');
  container.innerHTML = '';
  const firstIsBlack = positions[0].fen.split(' ')[1] === 'b';
  let num = Number(positions[0].fen.split(' ')[5]) || 1;
  let row = null;
  moves.forEach((m, i) => {
    if (m.color === 'w' || !row) {
      row = document.createElement('div');
      row.className = 'move-row';
      row.innerHTML = `<span class="move-num">${num}.</span>`;
      container.append(row);
      if (m.color === 'b' && i === 0 && firstIsBlack) {
        row.insertAdjacentHTML('beforeend', '<span class="move empty">…</span>');
      }
    }
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'move';
    cell.dataset.index = i;
    cell.addEventListener('click', () => goTo(i + 1));
    row.append(cell);
    if (m.color === 'b') num += 1;
    updateMoveCell(i, cell);
  });
}

function updateMoveCell(i, cell = $(`#moves .move[data-index="${i}"]`)) {
  if (!cell) return;
  const m = state.game.moves[i];
  const cls = m.classification;
  cell.className = `move${cls ? ` ${cls}` : ''}${state.ply === i + 1 ? ' current' : ''}`;
  const icon = cls && !['good', 'excellent'].includes(cls) ? classBadge(cls, 'mini') : '';
  cell.innerHTML = `${icon}${escapeHtml(m.san)}`;
  cell.title = cls ? CLASSIFICATIONS[cls].label : '';
}

function playerLine(color) {
  const { headers, chesscom, moves } = state.game;
  const name = color === 'w' ? headers.White : headers.Black;
  const elo = color === 'w' ? headers.WhiteElo : headers.BlackElo;
  const accs = moves.filter((m) => m.color === color && m.accuracy !== undefined).map((m) => m.accuracy);
  const acc = gameAccuracy(accs);
  const ccAcc = chesscom?.accuracies?.[color === 'w' ? 'white' : 'black'];
  return `
    <span class="color-dot ${color}"></span>
    <strong>${escapeHtml(name || (color === 'w' ? 'Blancs' : 'Noirs'))}</strong>
    ${elo ? `<span class="muted">(${escapeHtml(elo)})</span>` : ''}
    <span class="spacer"></span>
    ${acc !== null ? `<span class="accuracy" title="Précision calculée ici">${acc.toFixed(1)} %</span>` : ''}
    ${ccAcc ? `<span class="muted small" title="Précision Chess.com (si la partie a été analysée là-bas)">Chess.com : ${ccAcc.toFixed(1)} %</span>` : ''}`;
}

function renderSummary() {
  const { moves, headers } = state.game;
  const keys = Object.keys(CLASSIFICATIONS);
  const count = (color, k) => moves.filter((m) => m.color === color && m.classification === k).length;
  let html = `<div class="summary-head"><span>${escapeHtml(headers.Result || '')}</span>`;
  if (headers.Termination) html += ` <span class="muted small">${escapeHtml(headers.Termination)}</span>`;
  html += '</div><table><thead><tr><th></th><th>Blancs</th><th>Noirs</th></tr></thead><tbody>';
  for (const k of keys) {
    html += `<tr class="${k}"><td>${classBadge(k)} ${CLASSIFICATIONS[k].label}</td>
      <td>${count('w', k)}</td><td>${count('b', k)}</td></tr>`;
  }
  html += '</tbody></table>';
  $('#summary').innerHTML = html;
}

function renderComment() {
  const { moves, positions } = state.game;
  const pos = positions[state.ply];
  if (state.ply === 0) {
    $('#comment').innerHTML = pos.best
      ? `Position de départ. Stockfish propose <strong>${escapeHtml(uciToSan(pos.fen, pos.best))}</strong>.`
      : 'Position de départ.';
    return;
  }
  const m = moves[state.ply - 1];
  const num = `${Math.ceil(state.ply / 2)}${m.color === 'w' ? '.' : '…'}`;
  if (!m.classification) {
    $('#comment').innerHTML = `<strong>${num} ${escapeHtml(m.san)}</strong> — analyse en cours…`;
    return;
  }
  const info = CLASSIFICATIONS[m.classification];
  let html = `<div class="comment-head ${m.classification}">${classBadge(m.classification)}
    <span><strong>${num} ${escapeHtml(m.san)}</strong> ${info.phrase}</span>
    <span class="eval-chip">${formatEval(pos.eval)}</span></div>`;
  if (m.bestSan && m.classification !== 'best') {
    html += `<div class="comment-best">${classBadge('best')} Meilleur coup : <strong>${escapeHtml(m.bestSan)}</strong>`;
    const prev = positions[state.ply - 1];
    if (prev.pv && prev.pv.length > 1) html += ` <span class="muted small">${escapeHtml(pvToSan(prev.fen, prev.pv.slice(0, 6)))}</span>`;
    html += '</div>';
  }
  $('#comment').innerHTML = html;
}

function pvToSan(fen, pv) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv) {
    try {
      const turn = chess.turn();
      const n = chess.moveNumber();
      const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(turn === 'w' ? `${n}. ${mv.san}` : out.length ? mv.san : `${n}… ${mv.san}`);
    } catch {
      break;
    }
  }
  return out.join(' ');
}

function render() {
  if (!state.game) return;
  const { positions, moves } = state.game;
  const pos = positions[state.ply];
  const move = moves[state.ply - 1];

  let arrow = null;
  if (move && move.classification && !['brilliant', 'best', 'excellent'].includes(move.classification)) {
    const best = positions[state.ply - 1].best;
    if (best) arrow = { from: best.slice(0, 2), to: best.slice(2, 4) };
  }
  board.render({
    fen: pos.fen,
    flipped: state.flipped,
    lastMove: move ? { from: move.from, to: move.to, cls: move.classification } : null,
    badge: move && move.classification ? { square: move.to, html: classBadge(move.classification, 'on-board') } : null,
    arrow,
  });

  // Barre d'évaluation
  const wp = pos.eval ? whiteWinPercent(pos.eval) : 50;
  $('#eval-fill').style.height = `${wp}%`;
  $('#eval-bar').classList.toggle('flipped', state.flipped);
  $('#eval-text').textContent = formatEval(pos.eval);
  $('#eval-text').className = wp >= 50 ? 'white-adv' : 'black-adv';

  $('#player-top').innerHTML = playerLine(state.flipped ? 'w' : 'b');
  $('#player-bottom').innerHTML = playerLine(state.flipped ? 'b' : 'w');

  document.querySelectorAll('#moves .move.current').forEach((el) => el.classList.remove('current'));
  const cur = $(`#moves .move[data-index="${state.ply - 1}"]`);
  if (cur) {
    cur.classList.add('current');
    scrollMoveListTo(cur);
  }

  graph.render(positions, moves, state.ply);
  renderSummary();
  renderComment();
}

/** Fait défiler uniquement la liste des coups (scrollIntoView ferait aussi défiler la page). */
function scrollMoveListTo(cell) {
  const list = $('#moves');
  const box = list.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  if (r.top < box.top) list.scrollTop -= box.top - r.top + 4;
  else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom + 4;
}

function goTo(ply) {
  if (!state.game) return;
  state.ply = Math.max(0, Math.min(state.game.positions.length - 1, ply));
  render();
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.nav;
    if (action === 'start') goTo(0);
    if (action === 'prev') goTo(state.ply - 1);
    if (action === 'next') goTo(state.ply + 1);
    if (action === 'end') goTo(Infinity);
    if (action === 'flip') { state.flipped = !state.flipped; render(); }
  });
});

document.addEventListener('keydown', (e) => {
  if (!state.game || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if ($('#feedback-dialog').open) return;
  if (e.key === 'ArrowLeft') goTo(state.ply - 1);
  else if (e.key === 'ArrowRight') goTo(state.ply + 1);
  else if (e.key === 'Home' || e.key === 'ArrowUp') goTo(0);
  else if (e.key === 'End' || e.key === 'ArrowDown') goTo(Infinity);
  else if (e.key === 'f') { state.flipped = !state.flipped; render(); }
  else return;
  e.preventDefault();
});

/* ---------- Démarrage ---------- */

initFeedback(() => {
  if (!state.game) return null;
  const { headers, chesscom, moves, pgn } = state.game;
  const move = moves[state.ply - 1];
  return {
    url: chesscom?.url || headers.Link || null,
    players: `${headers.White || '?'} – ${headers.Black || '?'}`,
    move: move ? `${Math.ceil(state.ply / 2)}${move.color === 'w' ? '.' : '…'} ${move.san}` : 'position de départ',
    depth: $('#depth').value,
    pgn,
  };
});

const saved = storage('username');
if (saved) $('#username').value = saved;
