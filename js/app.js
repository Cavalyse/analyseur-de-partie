import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import {
  analysisSummary, gameKey, loadAnalysis, saveAnalysis,
} from './cache.js';
import { formatClock, formatSpent, parseClocks } from './clocks.js';
import { Engine } from './engine.js';
import { initFeedback } from './feedback.js';
import { EvalGraph } from './graph.js';
import { loadOpenings, openingInfo } from './openings.js';
import {
  isSoundEnabled, moveSoundKind, playSound, setSoundEnabled,
} from './sounds.js';
import { Trainer, findExercises } from './training.js';
import {
  CLASSIFICATIONS, classBadge, classifyMove, formatEval, gameAccuracy, isBrilliant, isMiss, toWhitePov, whiteWinPercent,
} from './analysis.js';
import {
  TIME_CLASS_LABELS, archiveLabel, fetchArchiveGames, fetchArchives, resultFor,
} from './chesscom.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  username: '',
  archives: [],
  archiveIndex: 0,
  game: null, // { headers, chesscom, positions, moves, pgn, myColor, bookPlies, openingNames }
  ply: 0,
  flipped: false,
  token: 0,
  analysing: false,
};

const board = new Board($('#board'));
const graph = new EvalGraph($('#graph'), (ply) => goTo(ply));
let engine = null;
const trainer = new Trainer({
  board,
  panel: $('#training'),
  getEngine: () => engine || (engine = new Engine()),
  getDepth: () => Number($('#depth').value),
  onExit: () => {
    $('#analysis').classList.remove('training-mode');
    updateTrainingCta();
    render();
  },
});

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
  $('#filters').hidden = true;
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
    li.dataset.key = g.url;
    li.dataset.color = meIsWhite ? 'w' : 'b';
    li.dataset.timeClass = g.time_class;
    li.dataset.result = result;
    li.dataset.opponent = opp.username.toLowerCase();
    li.innerHTML = `
      <button type="button">
        <span class="result ${result}">${{ win: 'V', loss: 'D', draw: 'N' }[result]}</span>
        <span class="game-main">
          <span class="opponent"><span class="color-dot ${meIsWhite ? 'w' : 'b'}"></span>vs ${escapeHtml(opp.username)} <span class="muted">(${opp.rating})</span></span>
          <span class="muted small">${TIME_CLASS_LABELS[g.time_class] || g.time_class} · ${date} · ${me.rating}</span>
        </span>
        <span class="game-tag"></span>
      </button>`;
    li.querySelector('button').addEventListener('click', () => {
      list.querySelectorAll('.game.selected').forEach((el) => el.classList.remove('selected'));
      li.classList.add('selected');
      loadGame(g.pgn, { chesscom: g, flipped: !meIsWhite, myColor: meIsWhite ? 'w' : 'b' });
    });
    list.append(li);
    refreshGameTag(g.url);
  }
  $('#filters').hidden = false;
  applyFilters();
}

/** Pastille « déjà analysée » avec la précision du joueur, dans la liste des parties. */
function refreshGameTag(key) {
  const li = [...document.querySelectorAll('#games-list .game')].find((el) => el.dataset.key === key);
  const summary = analysisSummary(key);
  if (!li || !summary) return;
  const acc = summary.accuracy?.[li.dataset.color];
  li.querySelector('.game-tag').innerHTML = `<span class="analysed" title="Déjà analysée : rouverture instantanée">${
    acc !== null && acc !== undefined ? `${Math.round(acc)} %` : '✓'}</span>`;
}

/* ---------- Filtres de la liste ---------- */

function applyFilters() {
  const time = $('#filter-time').value;
  const result = $('#filter-result').value;
  const opponent = $('#filter-opponent').value.trim().toLowerCase();
  let shown = 0;
  let total = 0;
  let heading = null;
  let headingHasGames = false;
  const closeHeading = () => { if (heading) heading.hidden = !headingHasGames; };
  for (const li of $('#games-list').children) {
    if (li.classList.contains('month')) {
      closeHeading();
      heading = li;
      headingHasGames = false;
      continue;
    }
    total += 1;
    const visible = (!time || li.dataset.timeClass === time)
      && (!result || li.dataset.result === result)
      && (!opponent || li.dataset.opponent.includes(opponent));
    li.hidden = !visible;
    if (visible) { shown += 1; headingHasGames = true; }
  }
  closeHeading();
  const filtering = time || result || opponent;
  $('#search-status').textContent = filtering
    ? `${shown} partie${shown > 1 ? 's' : ''} affichée${shown > 1 ? 's' : ''} sur ${total}.`
    : `${total} partie${total > 1 ? 's' : ''} chargée${total > 1 ? 's' : ''}.`;
}

['#filter-time', '#filter-result'].forEach((sel) => $(sel).addEventListener('change', applyFilters));
$('#filter-opponent').addEventListener('input', applyFilters);

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

function loadGame(pgn, { chesscom = null, flipped = false, myColor = null }) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  trainer.exit();
  exitVariation();
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
      captured: Boolean(m.captured),
      castle: /[kq]/.test(m.flags),
    };
  });

  const headers = chess.getHeaders();
  const clocks = parseClocks(pgn, headers, moves.length);
  if (clocks) moves.forEach((m, i) => Object.assign(m, clocks[i]));
  const baseClock = clocks ? Number(headers.TimeControl.split('+')[0]) : null;

  state.game = {
    headers, chesscom, positions, moves, pgn, myColor, bookPlies: 0, openingNames: [], baseClock,
  };
  state.flipped = flipped;
  state.ply = 0;

  $('#placeholder').hidden = true;
  $('#analysis').hidden = false;
  updateTrainingCta();
  buildMoveList();
  render();
  runAnalysis();
}

async function runAnalysis() {
  const token = ++state.token;
  const { positions, moves } = state.game;
  const depth = Number($('#depth').value);
  const key = gameKey(state.game);
  const cached = loadAnalysis(key, depth, positions.length);

  try {
    if (state.analysing && engine) engine.stop();
    if (!cached && !engine) engine = new Engine();
    state.analysing = true;
    updateTrainingCta();
    setProgress(0, cached ? "Chargement de l'analyse mémorisée…" : 'Démarrage de Stockfish…');
    await Promise.all([cached ? null : engine.newGame(), loadOpenings()]);
    if (token !== state.token) return;
    const opening = openingInfo(positions.map((p) => p.fen));
    state.game.bookPlies = opening.bookPlies;
    state.game.openingNames = opening.names;
  } catch (err) {
    state.analysing = false;
    setProgress(0, err.message || "Impossible de démarrer le moteur d'analyse.");
    return;
  }

  for (let i = 0; i < positions.length; i++) {
    if (token !== state.token) return;
    const pos = positions[i];
    const chess = new Chess(pos.fen);
    if (cached) {
      Object.assign(pos, cached[i]);
    } else if (chess.isCheckmate()) {
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
      if (i <= state.game.bookPlies) {
        move.classification = 'book';
      } else if (isBrilliant({
        fenBefore: prev.fen, fenAfter: pos.fen, pvAfter: pos.pv, color: move.color,
        classification: move.classification, after: pos.eval, moveTo: move.to,
      })) {
        move.classification = 'brilliant';
      } else if (isMiss(move, moves[i - 2], moverWinPercent(pos.eval, move.color),
        positions[i - 2]?.eval ? moverWinPercent(positions[i - 2].eval, move.color) : null)) {
        move.classification = 'miss';
      }
      if (prev.best && prev.best !== move.uci) move.bestSan = uciToSan(prev.fen, prev.best);
      updateMoveCell(i - 1);
    }

    if (cached) continue;
    setProgress((i + 1) / positions.length, `Analyse : ${i + 1} / ${positions.length} positions`);
    if (i === state.ply || i === state.ply - 1 || i % 4 === 0) render();
  }

  state.analysing = false;
  if (!cached) {
    const accuracy = {};
    for (const c of ['w', 'b']) accuracy[c] = gameAccuracy(moves.filter((m) => m.color === c).map((m) => m.accuracy));
    saveAnalysis(key, depth, positions, accuracy);
    refreshGameTag(key);
  }
  setProgress(1, `Analyse terminée (profondeur ${depth}${cached ? ', mémorisée' : ''})`);
  updateTrainingCta();
  render();
}

/* ---------- Mode entraînement ---------- */

/** Couleur du joueur qui s'entraîne : celle du pseudo Chess.com, sinon celle du bas de l'échiquier. */
function trainingColor() {
  return state.game.myColor || (state.flipped ? 'b' : 'w');
}

function updateTrainingCta() {
  const cta = $('#training-cta');
  if (!state.game || state.analysing || trainer.active) {
    cta.hidden = true;
    return;
  }
  const color = trainingColor();
  const count = findExercises(state.game, color).length;
  const who = color === 'w' ? 'Blancs' : 'Noirs';
  cta.hidden = false;
  cta.innerHTML = count
    ? `<button type="button" class="btn-primary" id="train-btn">🎯 Rejouer mes erreurs (${count})</button>
       <span class="muted small">Retrouve le bon coup là où ${state.game.myColor ? 'tu as' : `les ${who} ont`} fait une erreur, une gaffe ou manqué une occasion.</span>`
    : `<span class="muted small">🎉 Aucune erreur, gaffe ni occasion manquée à retravailler pour les ${who}.</span>`;
}

$('#training-cta').addEventListener('click', (e) => {
  if (!e.target.closest('#train-btn') || !state.game) return;
  exitVariation();
  if (trainer.start(state.game, trainingColor())) {
    $('#analysis').classList.add('training-mode');
    $('#training-cta').hidden = true;
  }
});

function moverWinPercent(ev, color) {
  return color === 'w' ? whiteWinPercent(ev) : 100 - whiteWinPercent(ev);
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
    trainer.exit();
    exitVariation();
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
  const time = m.spent !== undefined ? `<span class="move-time">${formatSpent(m.spent)}</span>` : '';
  cell.innerHTML = `${icon}${escapeHtml(m.san)}${time}`;
  cell.title = cls ? CLASSIFICATIONS[cls].label : '';
}

function playerLine(color) {
  const { headers, chesscom, moves } = state.game;
  const clean = (v) => (v && v !== '?' ? v : null);
  const name = clean(color === 'w' ? headers.White : headers.Black);
  const elo = clean(color === 'w' ? headers.WhiteElo : headers.BlackElo);
  const accs = moves.filter((m) => m.color === color && m.accuracy !== undefined).map((m) => m.accuracy);
  const acc = gameAccuracy(accs);
  const ccAcc = chesscom?.accuracies?.[color === 'w' ? 'white' : 'black'];
  let clock = '';
  if (state.game.baseClock !== null) {
    let remaining = state.game.baseClock;
    for (let i = Math.min(state.ply, moves.length) - 1; i >= 0; i--) {
      if (moves[i].color === color) { remaining = moves[i].clock; break; }
    }
    const turn = state.game.positions[state.ply].fen.split(' ')[1];
    clock = `<span class="clock${turn === color ? ' running' : ''}" title="Temps restant">${formatClock(remaining)}</span>`;
  }
  return `
    <span class="color-dot ${color}"></span>
    <strong>${escapeHtml(name || (color === 'w' ? 'Blancs' : 'Noirs'))}</strong>
    ${elo ? `<span class="muted">(${escapeHtml(elo)})</span>` : ''}
    <span class="spacer"></span>
    ${clock}
    ${acc !== null ? `<span class="accuracy" title="Précision calculée ici">${acc.toFixed(1)} %</span>` : ''}
    ${ccAcc ? `<span class="muted small" title="Précision Chess.com (si la partie a été analysée là-bas)">Chess.com : ${ccAcc.toFixed(1)} %</span>` : ''}`;
}

function renderSummary() {
  const { moves, headers } = state.game;
  const keys = Object.keys(CLASSIFICATIONS);
  const count = (color, k) => moves.filter((m) => m.color === color && m.classification === k).length;
  let html = `<div class="summary-head"><span>${escapeHtml(headers.Result || '')}</span>`;
  if (headers.Termination) html += ` <span class="muted small">${escapeHtml(headers.Termination)}</span>`;
  const opening = state.game.openingNames[state.game.openingNames.length - 1];
  if (opening) html += `<div class="opening-name">${classBadge('book', 'mini')}${escapeHtml(opening)}</div>`;
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
    ${m.spent !== undefined ? `<span class="muted small" title="Temps passé sur ce coup">⏱ ${formatSpent(m.spent)}</span>` : ''}
    <span class="eval-chip">${formatEval(pos.eval)}</span></div>`;
  const opening = state.game.openingNames[state.ply];
  if (m.classification === 'book' && opening) html += `<div class="comment-best muted">${escapeHtml(opening)}</div>`;
  if (m.bestSan && !['best', 'book'].includes(m.classification)) {
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

function setEvalBar(ev) {
  const wp = ev ? whiteWinPercent(ev) : 50;
  $('#eval-fill').style.height = `${wp}%`;
  $('#eval-bar').classList.toggle('flipped', state.flipped);
  $('#eval-text').textContent = formatEval(ev);
  $('#eval-text').className = wp >= 50 ? 'white-adv' : 'black-adv';
}

function render({ animate = [] } = {}) {
  if (!state.game || trainer.active) return;
  const { positions, moves } = state.game;

  if (explore.active) renderVariation(animate);
  else renderReview(animate);

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
  enableBoardMoves();
}

/** Vue normale : la position de la partie au coup affiché. */
function renderReview(animate) {
  const { positions, moves } = state.game;
  const pos = positions[state.ply];
  const move = moves[state.ply - 1];

  let arrow = null;
  if (move && move.classification && !['brilliant', 'best', 'excellent', 'book'].includes(move.classification)) {
    const best = positions[state.ply - 1].best;
    if (best) arrow = { from: best.slice(0, 2), to: best.slice(2, 4) };
  }
  board.render({
    fen: pos.fen,
    flipped: state.flipped,
    lastMove: move ? { from: move.from, to: move.to, cls: move.classification } : null,
    badge: move && move.classification ? { square: move.to, html: classBadge(move.classification, 'on-board') } : null,
    arrow,
    animate,
  });
  setEvalBar(pos.eval);
  renderComment();
}

/* ---------- Exploration de variantes ---------- */

// Les coups joués sur l'échiquier qui s'écartent de la partie forment une variante, analysée
// par un second moteur pour ne pas attendre la fin de l'analyse de la partie.
const explore = {
  active: false, basePly: 0, base: null, line: [], idx: 0, token: 0,
};
let explorer = null;

function exploreNode(k) {
  return k === 0 ? explore.base : explore.line[k - 1];
}

function currentFen() {
  return explore.active ? exploreNode(explore.idx).fen : state.game.positions[state.ply].fen;
}

function enableBoardMoves() {
  const chess = new Chess(currentFen());
  if (chess.isGameOver()) {
    board.disableMoves();
    return;
  }
  board.enableMoves({
    color: chess.turn(),
    dests: (sq) => chess.moves({ square: sq, verbose: true }).map((m) => m.to),
    onMove: onBoardMove,
  });
}

function onBoardMove(from, to, { dragged }) {
  const chess = new Chess(currentFen());
  let mv;
  try {
    mv = chess.move({ from, to, promotion: 'q' });
  } catch {
    return;
  }
  const uci = from + to + (mv.promotion || '');
  // Le coup de la partie (ou de la variante en cours) : on avance simplement.
  if (!explore.active && state.game.moves[state.ply]?.uci === uci) {
    goTo(state.ply + 1, { dragged });
    return;
  }
  if (explore.active && explore.line[explore.idx]?.uci === uci) {
    stepVariation(1, { dragged });
    return;
  }
  if (!explore.active) {
    const p = state.game.positions[state.ply];
    Object.assign(explore, {
      active: true, basePly: state.ply, base: { fen: p.fen, eval: p.eval, best: p.best, pv: p.pv }, line: [], idx: 0,
    });
    explore.token += 1;
  }
  const node = {
    san: mv.san, uci, from, to, color: mv.color, captured: Boolean(mv.captured), castle: /[kq]/.test(mv.flags), fen: chess.fen(),
  };
  explore.line = [...explore.line.slice(0, explore.idx), node];
  explore.idx += 1;
  const animate = moveAnimation(node, false);
  render({ animate: dragged ? animate.slice(1) : animate });
  playSound(moveSoundKind(node));
  evaluateVariation();
}

function stepVariation(delta, { dragged = false } = {}) {
  const target = explore.idx + delta;
  if (target > explore.line.length) return;
  if (target <= 0) {
    const first = explore.line[0];
    exitVariation();
    render({ animate: moveAnimation(first, true) });
    playSound('move');
    return;
  }
  const animate = delta > 0 ? moveAnimation(explore.line[target - 1], false) : moveAnimation(explore.line[explore.idx - 1], true);
  explore.idx = target;
  render({ animate: dragged ? animate.slice(1) : animate });
  playSound(delta > 0 ? moveSoundKind(explore.line[target - 1]) : 'move');
  evaluateVariation();
}

function exitVariation() {
  if (!explore.active) return;
  explore.active = false;
  explore.token += 1;
  state.ply = explore.basePly;
}

async function evaluateNode(node) {
  const chess = new Chess(node.fen);
  if (chess.isCheckmate()) {
    node.eval = { type: 'mate', value: 0, winner: chess.turn() === 'w' ? 'b' : 'w' };
  } else if (chess.isStalemate() || chess.isInsufficientMaterial()) {
    node.eval = { type: 'cp', value: 0 };
  } else {
    if (!explorer) explorer = new Engine();
    const r = await explorer.analyse(node.fen, Number($('#depth').value));
    node.eval = toWhitePov(r.score, chess.turn());
    node.best = r.bestMove;
    node.pv = r.pv;
  }
}

/** Évalue les positions de la variante jusqu'au coup affiché, puis classe les coups joués. */
async function evaluateVariation() {
  const { token } = explore;
  for (let k = 0; k <= explore.idx; k++) {
    const node = exploreNode(k);
    if (!node.eval && !node.pending) {
      node.pending = true;
      try {
        await evaluateNode(node);
      } catch {
        node.failed = true;
      }
      node.pending = false;
      if (token !== explore.token) return;
    }
    const prev = k > 0 ? exploreNode(k - 1) : null;
    if (prev?.eval && node.eval && !node.classification) {
      Object.assign(node, classifyMove({
        before: prev.eval, after: node.eval, color: node.color, playedUci: node.uci, bestUci: prev.best,
      }));
    }
  }
  if (explore.active && token === explore.token) render();
}

/** Vue « variante » : la position explorée, son évaluation et la suggestion de Stockfish. */
function renderVariation(animate) {
  const node = exploreNode(explore.idx);
  const move = explore.line[explore.idx - 1];
  const cls = move.classification;
  board.render({
    fen: node.fen,
    flipped: state.flipped,
    lastMove: { from: move.from, to: move.to, cls },
    badge: cls ? { square: move.to, html: classBadge(cls, 'on-board') } : null,
    arrow: node.best ? { from: node.best.slice(0, 2), to: node.best.slice(2, 4) } : null,
    animate,
  });
  setEvalBar(node.eval);

  const baseMove = state.game.moves[explore.basePly - 1];
  const from = baseMove ? `après ${Math.ceil(explore.basePly / 2)}${baseMove.color === 'w' ? '.' : '…'} ${escapeHtml(baseMove.san)}` : 'depuis la position de départ';
  const line = explore.line.map((m, k) => {
    const ply = explore.basePly + k + 1;
    const num = m.color === 'w' ? `${Math.ceil(ply / 2)}.` : (k === 0 ? `${Math.ceil(ply / 2)}…` : '');
    return `${num ? `<span class="var-num">${num}</span>` : ''}<button type="button" class="var-move${k + 1 === explore.idx ? ' current' : ''}" data-vidx="${k + 1}">${escapeHtml(m.san)}</button>`;
  }).join('');

  let html = `<div class="variation-head">
      <span><strong>🔀 Variante</strong> <span class="muted small">${from}</span></span>
      <button type="button" class="secondary var-exit" data-var="exit" title="Revenir à la partie (Échap)">↩ Partie</button>
    </div>
    <div class="variation-line">${line}</div>`;
  if (cls) {
    html += `<div class="comment-head ${cls}">${classBadge(cls)}
      <span><strong>${escapeHtml(move.san)}</strong> ${CLASSIFICATIONS[cls].phrase}</span>
      <span class="eval-chip">${formatEval(node.eval)}</span></div>`;
  } else if (!node.failed) {
    html += '<div class="muted">Stockfish analyse la position…</div>';
  }
  if (node.best && node.eval) {
    html += `<div class="comment-best">${classBadge('best')} Stockfish propose <strong>${escapeHtml(uciToSan(node.fen, node.best))}</strong>`;
    if (node.pv?.length > 1) html += ` <span class="muted small">${escapeHtml(pvToSan(node.fen, node.pv.slice(0, 6)))}</span>`;
    html += '</div>';
  } else if (node.eval && new Chess(node.fen).isGameOver()) {
    html += `<div class="comment-best"><strong>${new Chess(node.fen).isCheckmate() ? 'Échec et mat !' : 'Partie nulle.'}</strong></div>`;
  }
  $('#comment').innerHTML = html;
}

$('#comment').addEventListener('click', (e) => {
  if (!explore.active) return;
  if (e.target.closest('[data-var="exit"]')) {
    exitVariation();
    render();
    return;
  }
  const btn = e.target.closest('[data-vidx]');
  if (!btn) return;
  const target = Number(btn.dataset.vidx);
  if (Math.abs(target - explore.idx) === 1) {
    stepVariation(target - explore.idx);
  } else if (target !== explore.idx) {
    explore.idx = target;
    render();
    evaluateVariation();
  }
});

/** Fait défiler uniquement la liste des coups (scrollIntoView ferait aussi défiler la page). */
function scrollMoveListTo(cell) {
  const list = $('#moves');
  const box = list.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  if (r.top < box.top) list.scrollTop -= box.top - r.top + 4;
  else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom + 4;
}

/** Déplacements à animer pour un coup (la tour aussi en cas de roque), éventuellement à l'envers. */
function moveAnimation(m, reverse) {
  const list = [{ from: m.from, to: m.to }];
  if (m.castle) {
    const rank = m.color === 'w' ? '1' : '8';
    list.push(m.to[0] === 'g' ? { from: `h${rank}`, to: `f${rank}` } : { from: `a${rank}`, to: `d${rank}` });
  }
  return reverse ? list.map(({ from, to }) => ({ from: to, to: from })) : list;
}

function goTo(ply, { dragged = false } = {}) {
  if (!state.game || trainer.active) return;
  const { moves } = state.game;
  const wasExploring = explore.active;
  exitVariation();
  const prev = state.ply;
  state.ply = Math.max(0, Math.min(state.game.positions.length - 1, ply));
  if (state.ply === prev && !wasExploring) return;
  let animate = [];
  if (wasExploring) animate = [];
  else if (state.ply === prev + 1) animate = moveAnimation(moves[prev], false).slice(dragged ? 1 : 0);
  else if (state.ply === prev - 1) animate = moveAnimation(moves[state.ply], true);
  render({ animate });
  if (state.ply === prev) return;
  if (state.ply === prev - 1) playSound('move');
  else if (state.ply > 0) playSound(moveSoundKind(moves[state.ply - 1]));
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.nav;
    if (action === 'start') goTo(0);
    if (action === 'prev') { if (explore.active) stepVariation(-1); else goTo(state.ply - 1); }
    if (action === 'next') { if (explore.active) stepVariation(1); else goTo(state.ply + 1); }
    if (action === 'end') goTo(Infinity);
    if (action === 'flip') { state.flipped = !state.flipped; updateTrainingCta(); render(); }
    if (action === 'sound') toggleSound();
  });
});

function toggleSound() {
  setSoundEnabled(!isSoundEnabled());
  updateSoundButton();
}

function updateSoundButton() {
  const btn = $('#sound-btn');
  btn.textContent = isSoundEnabled() ? '🔊' : '🔇';
  btn.title = isSoundEnabled() ? 'Couper le son (S)' : 'Activer le son (S)';
}
updateSoundButton();

document.addEventListener('keydown', (e) => {
  if (!state.game || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if ($('#feedback-dialog').open) return;
  if (trainer.active) {
    if (e.key === 'Escape') trainer.exit();
    return;
  }
  if (explore.active && e.key === 'ArrowLeft') stepVariation(-1);
  else if (explore.active && e.key === 'ArrowRight') stepVariation(1);
  else if (explore.active && e.key === 'Escape') { exitVariation(); render(); }
  else if (e.key === 'ArrowLeft') goTo(state.ply - 1);
  else if (e.key === 'ArrowRight') goTo(state.ply + 1);
  else if (e.key === 'Home' || e.key === 'ArrowUp') goTo(0);
  else if (e.key === 'End' || e.key === 'ArrowDown') goTo(Infinity);
  else if (e.key === 'f') { state.flipped = !state.flipped; updateTrainingCta(); render(); }
  else if (e.key === 's') toggleSound();
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
