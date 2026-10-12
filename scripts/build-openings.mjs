// Génère data/openings.json à partir de la base d'ouvertures de Lichess
// (https://github.com/lichess-org/chess-openings, domaine public / CC0).
//
// Usage : node scripts/build-openings.mjs <dossier contenant a.tsv … e.tsv>
//
// Chaque position rencontrée dans une ligne théorique est « théorique ». Le fichier associe
// la position (4 premiers champs du FEN) à l'indice du nom de l'ouverture, ou -1 si la
// position n'a pas de nom propre.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from '../js/vendor/chess.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage : node scripts/build-openings.mjs <dossier des fichiers .tsv>');
  process.exit(1);
}

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const names = [];
const nameIndex = new Map();
const positions = {};

for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(dir, `${file}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [, name, pgn] = line.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    history.forEach((m, i) => {
      const key = epd(m.after);
      if (i === history.length - 1) {
        if (!nameIndex.has(name)) {
          nameIndex.set(name, names.length);
          names.push(name);
        }
        positions[key] = nameIndex.get(name);
      } else if (!(key in positions)) {
        positions[key] = -1;
      }
    });
  }
}

writeFileSync(new URL('../data/openings.json', import.meta.url), JSON.stringify({ names, positions }));
console.log(`${names.length} noms, ${Object.keys(positions).length} positions théoriques.`);
