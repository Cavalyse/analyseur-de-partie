// Mode entraînement : rejouer les positions où le joueur a commis une erreur ou une gaffe
// et chercher un meilleur coup, vérifié par Stockfish.

import { Chess } from './vendor/chess.js';
import { CLASSIFICATIONS, classBadge, classifyMove, toWhitePov } from './analysis.js';
import { moveSoundKind, playSound } from './sounds.js';

const PIECE_NAMES = { p: 'ton pion', n: 'ton cavalier', b: 'ton fou', r: 'ta tour', q: 'ta dame', k: 'ton roi' };
const COLOR_NAMES = { w: 'les Blancs', b: 'les Noirs' };
const ACCEPTED = ['brilliant', 'best', 'excellent', 'good'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function uciToMove(fen, uci) {
  const chess = new Chess(fen);
  const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { chess, mv };
}

function rookMove(mv) {
  if (!/[kq]/.test(mv.flags)) return null;
  const rank = mv.color === 'w' ? '1' : '8';
  return mv.flags.includes('k') ? { from: `h${rank}`, to: `f${rank}` } : { from: `a${rank}`, to: `d${rank}` };
}

/** Exercices disponibles pour une couleur : erreurs et gaffes dont on connaît le meilleur coup. */
export function findExercises(game, color) {
  const { moves, positions } = game;
  return moves
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => m.color === color && ['mistake', 'blunder'].includes(m.classification) && positions[i].best)
    .map(({ m, i }) => ({ index: i, fen: positions[i].fen, evalBefore: positions[i].eval, best: positions[i].best, played: m }));
}

export class Trainer {
  /**
   * board : échiquier ; panel : élément où afficher l'exercice ;
   * getEngine() / getDepth() : moteur et profondeur d'analyse ;
   * onExit() : appelé quand on quitte l'entraînement.
   */
  constructor({ board, panel, getEngine, getDepth, onExit }) {
    Object.assign(this, { board, panel, getEngine, getDepth, onExit });
    this.active = false;
    this.token = 0;
    this.panel.addEventListener('click', (e) => {
      const action = e.target.closest('[data-train]')?.dataset.train;
      if (action) this[action]?.();
    });
  }

  start(game, color) {
    this.game = game;
    this.color = color;
    this.exercises = findExercises(game, color);
    if (!this.exercises.length) return false;
    this.active = true;
    this.current = 0;
    this.results = [];
    this.panel.hidden = false;
    this.showExercise();
    const top = this.panel.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) this.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  get exercise() {
    return this.exercises[this.current];
  }

  /** Affiche la position de l'exercice courant (avec le coup précédent de l'adversaire). */
  showPosition() {
    const ex = this.exercise;
    const prevMove = this.game.moves[ex.index - 1];
    this.board.render({
      fen: ex.fen,
      flipped: this.color === 'b',
      lastMove: prevMove ? { from: prevMove.from, to: prevMove.to } : null,
    });
    const chess = new Chess(ex.fen);
    this.board.enableMoves({
      color: this.color,
      dests: (sq) => chess.moves({ square: sq, verbose: true }).map((m) => m.to),
      onMove: (from, to, { dragged }) => this.onMove(from, to, dragged),
    });
  }

  showExercise() {
    const ex = this.exercise;
    this.token += 1;
    this.attempts = 0;
    this.helped = false;
    this.done = false;
    this.showPosition();
    const num = `${Math.ceil((ex.index + 1) / 2)}${ex.played.color === 'w' ? '.' : '…'}`;
    const label = CLASSIFICATIONS[ex.played.classification].label.toLowerCase();
    this.setPanel(`
      <p>Dans la partie, ${COLOR_NAMES[this.color]} ont joué ${classBadge(ex.played.classification, 'mini')}<strong>${num} ${escapeHtml(ex.played.san)}</strong> (${label}).</p>
      <p class="training-task">Trouve un meilleur coup pour ${COLOR_NAMES[this.color]}.</p>
      <p class="training-feedback" id="training-feedback"></p>`,
    `<button type="button" class="secondary" data-train="hint">💡 Indice</button>
      <button type="button" class="secondary" data-train="solution">Voir la solution</button>
      <button type="button" class="secondary" data-train="next">Passer</button>`);
  }

  setPanel(body, actions) {
    const total = this.exercises.length;
    this.panel.innerHTML = `
      <div class="training-head">
        <strong>🎯 Rejouer mes erreurs</strong>
        <span class="muted small">${this.current < total ? `Exercice ${this.current + 1} / ${total}` : 'Bilan'}</span>
        <button type="button" class="training-close" data-train="exit" title="Quitter l'entraînement">✕</button>
      </div>
      <div class="training-body">${body}</div>
      <div class="training-actions">${actions}</div>`;
  }

  feedback(html, kind = '') {
    const el = this.panel.querySelector('#training-feedback');
    if (!el) return;
    el.className = `training-feedback ${kind}`;
    el.innerHTML = html;
  }

  async onMove(from, to, dragged) {
    const ex = this.exercise;
    const token = this.token;
    const chess = new Chess(ex.fen);
    let mv;
    try {
      mv = chess.move({ from, to, promotion: 'q' });
    } catch {
      return;
    }
    const uci = from + to + (mv.promotion || '');
    const rook = rookMove(mv);
    this.board.disableMoves();
    const animate = [...(dragged ? [] : [{ from, to }]), ...(rook ? [rook] : [])];
    this.board.render({ fen: chess.fen(), lastMove: { from, to }, animate });
    playSound(moveSoundKind({ san: mv.san, captured: mv.captured, castle: Boolean(rook) }));

    if (uci === ex.played.uci) {
      this.fail(mv, ex.played.classification, "C'est le coup joué dans la partie !");
      return;
    }
    let classification;
    if (uci === ex.best) {
      classification = 'best';
    } else if (chess.isCheckmate()) {
      classification = 'best';
    } else {
      this.feedback('Vérification avec Stockfish…');
      let after;
      if (chess.isStalemate() || chess.isInsufficientMaterial()) {
        after = { type: 'cp', value: 0 };
      } else {
        const r = await this.getEngine().analyse(chess.fen(), this.getDepth());
        if (token !== this.token) return;
        after = toWhitePov(r.score, chess.turn());
      }
      ({ classification } = classifyMove({
        before: ex.evalBefore, after, color: this.color, playedUci: uci, bestUci: ex.best,
      }));
    }
    if (ACCEPTED.includes(classification)) this.success(mv, classification);
    else this.fail(mv, classification);
  }

  success(mv, classification) {
    const ex = this.exercise;
    this.done = true;
    this.results[this.current] = !this.helped && this.attempts === 0 ? 'first' : 'later';
    playSound('success');
    const { chess } = uciToMove(ex.fen, mv.from + mv.to + (mv.promotion || ''));
    this.board.render({
      fen: chess.fen(),
      lastMove: { from: mv.from, to: mv.to },
      badge: { square: mv.to, html: classBadge(classification, 'on-board') },
    });
    let html = `${classBadge(classification)} <strong>Bravo !</strong> ${escapeHtml(mv.san)} ${CLASSIFICATIONS[classification].phrase}.`;
    if (classification === 'good' || classification === 'excellent') {
      html += `<br><span class="muted small">Le meilleur coup était ${escapeHtml(uciToMove(ex.fen, ex.best).mv.san)}.</span>`;
    }
    this.feedback(html, 'ok');
    this.showNextButton();
  }

  fail(mv, classification, message) {
    const token = this.token;
    this.attempts += 1;
    playSound('fail');
    this.board.render({
      fen: uciToMove(this.exercise.fen, mv.from + mv.to + (mv.promotion || '')).chess.fen(),
      lastMove: { from: mv.from, to: mv.to },
      badge: { square: mv.to, html: classBadge(classification, 'on-board') },
    });
    const label = CLASSIFICATIONS[classification]?.phrase || "n'est pas le bon coup";
    this.feedback(`${classBadge(classification)} ${escapeHtml(mv.san)} ${message ? `— ${message}` : `${label}.`} Réessaie !`, 'ko');
    setTimeout(() => {
      if (token === this.token && !this.done) this.showPosition();
    }, 1200);
  }

  hint() {
    if (this.done) return;
    const ex = this.exercise;
    const from = ex.best.slice(0, 2);
    this.helped = true;
    this.board.hint(from);
    const piece = new Chess(ex.fen).get(from);
    this.feedback(`💡 Joue avec <strong>${PIECE_NAMES[piece.type]}</strong> (case en surbrillance).`);
  }

  solution() {
    if (this.done) return;
    const ex = this.exercise;
    this.token += 1;
    this.done = true;
    this.results[this.current] = 'missed';
    this.board.disableMoves();
    const { chess, mv } = uciToMove(ex.fen, ex.best);
    const rook = rookMove(mv);
    this.board.render({
      fen: chess.fen(),
      lastMove: { from: mv.from, to: mv.to, cls: 'best' },
      badge: { square: mv.to, html: classBadge('best', 'on-board') },
      arrow: { from: mv.from, to: mv.to },
      animate: [{ from: mv.from, to: mv.to }, ...(rook ? [rook] : [])],
    });
    playSound(moveSoundKind({ san: mv.san, captured: mv.captured, castle: Boolean(rook) }));
    this.feedback(`${classBadge('best')} La solution était <strong>${escapeHtml(mv.san)}</strong>.`);
    this.showNextButton();
  }

  showNextButton() {
    const last = this.current >= this.exercises.length - 1;
    this.panel.querySelector('.training-actions').innerHTML = `
      <button type="button" class="btn-primary" data-train="next">${last ? 'Voir le bilan' : 'Exercice suivant →'}</button>`;
  }

  next() {
    if (!this.results[this.current]) this.results[this.current] = 'missed';
    this.current += 1;
    if (this.current < this.exercises.length) this.showExercise();
    else this.showSummary();
  }

  showSummary() {
    this.token += 1;
    this.board.disableMoves();
    const total = this.exercises.length;
    const first = this.results.filter((r) => r === 'first').length;
    const later = this.results.filter((r) => r === 'later').length;
    const rows = this.exercises.map((ex, i) => {
      const r = this.results[i];
      const icon = r === 'first' ? '✅' : r === 'later' ? '🟡' : '❌';
      const num = `${Math.ceil((ex.index + 1) / 2)}${ex.played.color === 'w' ? '.' : '…'}`;
      return `<li>${icon} ${num} ${escapeHtml(ex.played.san)} → ${escapeHtml(uciToMove(ex.fen, ex.best).mv.san)}</li>`;
    }).join('');
    this.setPanel(`
      <p class="training-score"><strong>${first} / ${total}</strong> trouvé${first > 1 ? 's' : ''} du premier coup${later ? `, ${later} après plusieurs essais ou un indice` : ''}.</p>
      <ul class="training-list">${rows}</ul>`,
    `<button type="button" class="secondary" data-train="restart">Recommencer</button>
      <button type="button" class="btn-primary" data-train="exit">Retour à l'analyse</button>`);
  }

  restart() {
    this.start(this.game, this.color);
  }

  exit() {
    if (!this.active) return;
    this.token += 1;
    this.active = false;
    this.board.disableMoves();
    this.board.hint(null);
    this.panel.hidden = true;
    this.panel.innerHTML = '';
    this.onExit();
  }
}
