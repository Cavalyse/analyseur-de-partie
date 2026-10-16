// Courbe d'évaluation de la partie (probabilité de gain des Blancs), cliquable.

import { whiteWinPercent } from './analysis.js';

const W = 600;
const H = 120;

export class EvalGraph {
  constructor(el, onSelect) {
    this.el = el;
    this.onSelect = onSelect;
    this.plyCount = 0;
    this.el.addEventListener('click', (e) => {
      if (!this.plyCount) return;
      const rect = this.el.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      this.onSelect(Math.round(ratio * this.plyCount));
    });
  }

  /**
   * positions : tableau (index = demi-coup) d'objets { eval } ;
   * moves : tableau d'objets { classification } (index = demi-coup - 1).
   */
  render(positions, moves, currentPly) {
    this.plyCount = positions.length - 1;
    const x = (i) => (this.plyCount ? (i / this.plyCount) * W : 0);
    const y = (wp) => H - (wp / 100) * H;

    const pts = [];
    positions.forEach((p, i) => {
      if (p.eval) pts.push([x(i), y(whiteWinPercent(p.eval))]);
    });

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe d'évaluation">`;
    svg += `<rect class="graph-bg" x="0" y="0" width="${W}" height="${H}"/>`;
    if (pts.length > 1) {
      const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
      const lastX = pts[pts.length - 1][0].toFixed(1);
      svg += `<polygon class="graph-white" points="0,${H} ${line} ${lastX},${H}"/>`;
      svg += `<polyline class="graph-line" points="${line}"/>`;
    }
    svg += `<line class="graph-mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>`;
    moves.forEach((m, i) => {
      const p = positions[i + 1];
      if (!m.classification || !p.eval) return;
      if (['mistake', 'blunder', 'inaccuracy', 'miss'].includes(m.classification)) {
        svg += `<circle class="graph-dot ${m.classification}" cx="${x(i + 1)}" cy="${y(whiteWinPercent(p.eval))}" r="3.5"/>`;
      }
    });
    svg += `<line class="graph-cursor" x1="${x(currentPly)}" y1="0" x2="${x(currentPly)}" y2="${H}"/>`;
    svg += '</svg>';
    this.el.innerHTML = svg;
  }
}
