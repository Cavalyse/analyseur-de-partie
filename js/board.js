// Affichage de l'échiquier : surlignage du dernier coup, icône de classification sur la case
// d'arrivée, flèche du meilleur coup, animation des pièces et, en mode entraînement,
// déplacement des pièces à la souris ou au doigt (clic-clic ou glisser-déposer).

const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ANIMATION_MS = 200;

function parsePlacement(fen) {
  const pieces = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        pieces[FILES[f] + (8 - r)] = color + ch.toLowerCase();
        f += 1;
      }
    }
  });
  return pieces;
}

export class Board {
  constructor(el) {
    this.el = el;
    this.el.classList.add('board');
    this.squares = document.createElement('div');
    this.squares.className = 'squares';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.classList.add('arrows');
    this.svg.innerHTML = `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5"
      markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;
    this.badgeLayer = document.createElement('div');
    this.badgeLayer.className = 'badge-layer';
    this.el.append(this.squares, this.svg, this.badgeLayer);
    this.flipped = false;
    this.pieces = {};
    this.interaction = null;
    this.selected = null;
    this.drag = null;

    this.squares.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.squares.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.squares.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.squares.addEventListener('pointercancel', () => this.cancelDrag());
  }

  /** Coordonnées (colonne, ligne) à l'écran du centre d'une case. */
  screenPos(square) {
    const f = FILES.indexOf(square[0]);
    const r = Number(square[1]) - 1;
    return this.flipped ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
  }

  /** Case située sous un point de l'écran (ou null en dehors de l'échiquier). */
  squareAt(clientX, clientY) {
    const rect = this.squares.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const f = this.flipped ? 7 - col : col;
    const r = this.flipped ? row : 7 - row;
    return FILES[f] + (r + 1);
  }

  squareEl(square) {
    return this.squares.querySelector(`[data-square="${square}"]`);
  }

  /**
   * animate : liste de déplacements { from, to } à animer (la pièce est déjà sur `to` dans `fen`).
   */
  render({ fen, lastMove = null, arrow = null, badge = null, flipped = this.flipped, animate = [] }) {
    const key = JSON.stringify([fen, lastMove, arrow, flipped]);
    if (key !== this.renderKey || animate.length) {
      this.renderKey = key;
      this.flipped = flipped;
      this.drawPosition(fen, lastMove, arrow, flipped, animate);
    }
    this.drawBadge(badge, flipped, animate);
  }

  drawPosition(fen, lastMove, arrow, flipped, animate) {
    this.pieces = parsePlacement(fen);
    this.selected = null;
    this.cancelDrag();
    const frag = document.createDocumentFragment();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const f = flipped ? 7 - col : col;
        const r = flipped ? row : 7 - row;
        const sq = FILES[f] + (r + 1);
        const div = document.createElement('div');
        div.className = `square ${(f + r) % 2 === 0 ? 'dark' : 'light'}`;
        div.dataset.square = sq;
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
          div.classList.add('last');
          if (lastMove.cls) div.classList.add(`last-${lastMove.cls}`);
        }
        if (this.pieces[sq]) {
          const p = document.createElement('div');
          p.className = `piece ${this.pieces[sq]}`;
          div.append(p);
        }
        if (col === 0) div.insertAdjacentHTML('beforeend', `<span class="coord rank">${r + 1}</span>`);
        if (row === 7) div.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[f]}</span>`);
        frag.append(div);
      }
    }
    this.squares.replaceChildren(frag);

    for (const { from, to } of animate) this.animatePiece(from, to);

    this.svg.querySelectorAll('line').forEach((l) => l.remove());
    if (arrow) {
      const a = this.screenPos(arrow.from);
      const b = this.screenPos(arrow.to);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const shorten = 0.35 / len;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x - (b.x - a.x) * shorten);
      line.setAttribute('y2', b.y - (b.y - a.y) * shorten);
      line.setAttribute('marker-end', 'url(#arrowhead)');
      this.svg.append(line);
    }
  }

  drawBadge(badge, flipped, animate) {
    // Icône dans le coin supérieur droit de la case d'arrivée (ré-animée seulement si elle change).
    const badgeKey = badge ? `${badge.square}|${badge.html}|${flipped}` : '';
    if (badgeKey !== this.badgeKey) {
      this.badgeKey = badgeKey;
      this.badgeLayer.replaceChildren();
      if (badge) {
        const { x, y } = this.screenPos(badge.square);
        const holder = document.createElement('div');
        holder.className = 'board-badge';
        holder.style.left = `${((x + 0.5) / 8) * 100}%`;
        holder.style.top = `${((y - 0.5) / 8) * 100}%`;
        // On attend la fin du glissement de la pièce avant de faire apparaître l'icône.
        holder.style.setProperty('--badge-delay', animate.length ? `${ANIMATION_MS * 0.8}ms` : '0ms');
        holder.innerHTML = badge.html;
        this.badgeLayer.append(holder);
      }
    }
  }

  animatePiece(from, to) {
    const el = this.squareEl(to)?.querySelector('.piece');
    if (!el || typeof el.animate !== 'function') return;
    const a = this.screenPos(from);
    const b = this.screenPos(to);
    el.classList.add('moving');
    const anim = el.animate(
      [{ transform: `translate(${(a.x - b.x) * 100}%, ${(a.y - b.y) * 100}%)` }, { transform: 'translate(0, 0)' }],
      { duration: ANIMATION_MS, easing: 'cubic-bezier(.25, .8, .35, 1)' },
    );
    anim.onfinish = () => el.classList.remove('moving');
  }

  /* ---------- Déplacement des pièces (mode entraînement) ---------- */

  /**
   * color : couleur des pièces que l'on peut déplacer ;
   * dests(square) : cases d'arrivée légales ; onMove(from, to) : coup joué.
   */
  enableMoves({ color, dests, onMove }) {
    this.interaction = { color, dests, onMove };
    this.el.classList.add('interactive');
  }

  disableMoves() {
    this.interaction = null;
    this.select(null);
    this.cancelDrag();
    this.el.classList.remove('interactive');
  }

  /** Met en évidence une case (ex. indice). */
  hint(square) {
    this.squares.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint'));
    if (square) this.squareEl(square)?.classList.add('hint');
  }

  select(square) {
    this.selected = square;
    this.squares.querySelectorAll('.selected, .dest, .dest-capture').forEach((el) => {
      el.classList.remove('selected', 'dest', 'dest-capture');
    });
    if (!square || !this.interaction) return;
    this.squareEl(square)?.classList.add('selected');
    for (const d of this.interaction.dests(square)) {
      this.squareEl(d)?.classList.add(this.pieces[d] ? 'dest-capture' : 'dest');
    }
  }

  ownPiece(square) {
    return square && this.pieces[square]?.[0] === this.interaction?.color;
  }

  play(from, to, dragged = false) {
    const { onMove } = this.interaction;
    this.select(null);
    onMove(from, to, { dragged });
  }

  onPointerDown(e) {
    if (!this.interaction || e.button > 0) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (this.selected && sq !== this.selected && this.interaction.dests(this.selected).includes(sq)) {
      this.play(this.selected, sq);
      return;
    }
    if (!this.ownPiece(sq)) {
      this.select(null);
      return;
    }
    e.preventDefault();
    this.select(sq);
    const el = this.squareEl(sq).querySelector('.piece');
    this.drag = { from: sq, el, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    this.squares.setPointerCapture(e.pointerId);
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.el.classList.add('dragging');
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.cancelDrag();
    if (!d.moved) return; // simple clic : la pièce reste sélectionnée
    const target = this.squareAt(e.clientX, e.clientY);
    if (target && target !== d.from && this.interaction?.dests(d.from).includes(target)) this.play(d.from, target, true);
  }

  cancelDrag() {
    if (!this.drag) return;
    const { el, pointerId } = this.drag;
    el.classList.remove('dragging');
    el.style.transform = '';
    if (this.squares.hasPointerCapture?.(pointerId)) this.squares.releasePointerCapture(pointerId);
    this.drag = null;
  }
}
