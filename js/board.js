// Affichage de l'échiquier (lecture seule) : surlignage du dernier coup, icône de classification
// sur la case d'arrivée et flèche du meilleur coup.

const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';

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
  }

  /** Coordonnées (colonne, ligne) à l'écran du centre d'une case. */
  screenPos(square) {
    const f = FILES.indexOf(square[0]);
    const r = Number(square[1]) - 1;
    return this.flipped ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
  }

  render({ fen, lastMove = null, arrow = null, badge = null, flipped = this.flipped }) {
    this.flipped = flipped;
    const pieces = parsePlacement(fen);
    const frag = document.createDocumentFragment();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const f = flipped ? 7 - col : col;
        const r = flipped ? row : 7 - row;
        const sq = FILES[f] + (r + 1);
        const div = document.createElement('div');
        div.className = `square ${(f + r) % 2 === 0 ? 'dark' : 'light'}`;
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
          div.classList.add('last');
          if (lastMove.cls) div.classList.add(`last-${lastMove.cls}`);
        }
        if (pieces[sq]) {
          const p = document.createElement('div');
          p.className = `piece ${pieces[sq]}`;
          div.append(p);
        }
        if (col === 0) div.insertAdjacentHTML('beforeend', `<span class="coord rank">${r + 1}</span>`);
        if (row === 7) div.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[f]}</span>`);
        frag.append(div);
      }
    }
    this.squares.replaceChildren(frag);

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

    // Icône dans le coin supérieur droit de la case d'arrivée (ré-animée à chaque coup).
    const badgeKey = badge ? `${badge.square}|${badge.html}|${flipped}` : '';
    if (badgeKey === this.badgeKey) return;
    this.badgeKey = badgeKey;
    this.badgeLayer.replaceChildren();
    if (badge) {
      const { x, y } = this.screenPos(badge.square);
      const holder = document.createElement('div');
      holder.className = 'board-badge';
      holder.style.left = `${((x + 0.5) / 8) * 100}%`;
      holder.style.top = `${((y - 0.5) / 8) * 100}%`;
      holder.innerHTML = badge.html;
      this.badgeLayer.append(holder);
    }
  }
}
