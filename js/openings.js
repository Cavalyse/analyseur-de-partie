// Coups théoriques et nom de l'ouverture, à partir de data/openings.json
// (généré par scripts/build-openings.mjs depuis la base d'ouvertures de Lichess).

// Traduction des grandes familles d'ouvertures ; la variante reste en anglais.
const FAMILIES_FR = {
  'Alekhine Defense': 'Défense Alekhine',
  'Benoni Defense': 'Défense Benoni',
  'Benko Gambit': 'Gambit Benko',
  'Benko Gambit Accepted': 'Gambit Benko accepté',
  'Bird Opening': 'Ouverture Bird',
  "Bishop's Opening": 'Partie du fou',
  'Bogo-Indian Defense': 'Défense bogo-indienne',
  'Caro-Kann Defense': 'Défense Caro-Kann',
  'Catalan Opening': 'Ouverture catalane',
  'Center Game': 'Partie du centre',
  'Dutch Defense': 'Défense hollandaise',
  'English Defense': 'Défense anglaise',
  'English Opening': 'Ouverture anglaise',
  'Englund Gambit': 'Gambit Englund',
  'Four Knights Game': 'Partie des quatre cavaliers',
  'French Defense': 'Défense française',
  'Grob Opening': 'Ouverture Grob',
  'Grünfeld Defense': 'Défense Grünfeld',
  'Hungarian Opening': 'Ouverture hongroise',
  'Indian Defense': 'Défense indienne',
  'Italian Game': 'Partie italienne',
  "King's Gambit": 'Gambit du roi',
  "King's Gambit Accepted": 'Gambit du roi accepté',
  "King's Gambit Declined": 'Gambit du roi refusé',
  "King's Indian Attack": 'Attaque est-indienne',
  "King's Indian Defense": 'Défense est-indienne',
  "King's Pawn Game": 'Partie du pion roi',
  'Latvian Gambit': 'Gambit letton',
  'Latvian Gambit Accepted': 'Gambit letton accepté',
  'London System': 'Système de Londres',
  'Modern Defense': 'Défense moderne',
  'Nimzo-Indian Defense': 'Défense nimzo-indienne',
  'Nimzowitsch Defense': 'Défense Nimzowitsch',
  'Old Indian Defense': 'Défense vieille-indienne',
  'Owen Defense': 'Défense Owen',
  "Petrov's Defense": 'Défense Petrov',
  'Philidor Defense': 'Défense Philidor',
  'Pirc Defense': 'Défense Pirc',
  'Polish Opening': 'Ouverture polonaise',
  'Ponziani Opening': 'Partie Ponziani',
  "Queen's Gambit": 'Gambit dame',
  "Queen's Gambit Accepted": 'Gambit dame accepté',
  "Queen's Gambit Declined": 'Gambit dame refusé',
  "Queen's Indian Defense": 'Défense ouest-indienne',
  "Queen's Pawn Game": 'Partie du pion dame',
  'Réti Opening': 'Ouverture Réti',
  'Ruy Lopez': 'Partie espagnole',
  'Scandinavian Defense': 'Défense scandinave',
  'Scotch Game': 'Partie écossaise',
  'Semi-Slav Defense': 'Défense semi-slave',
  'Sicilian Defense': 'Défense sicilienne',
  'Slav Defense': 'Défense slave',
  'Tarrasch Defense': 'Défense Tarrasch',
  'Three Knights Opening': 'Partie des trois cavaliers',
  'Torre Attack': 'Attaque Torre',
  'Trompowsky Attack': 'Attaque Trompowsky',
  'Vienna Game': 'Partie viennoise',
  'Zukertort Opening': 'Ouverture Zukertort',
};

let data = null;
let loading = null;

/** Charge la base d'ouvertures (une seule fois). En cas d'échec, l'analyse continue sans. */
export function loadOpenings() {
  if (!loading) {
    loading = fetch('data/openings.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { data = json; })
      .catch(() => { data = null; });
  }
  return loading;
}

function translate(name) {
  const [family, ...rest] = name.split(':');
  const fr = FAMILIES_FR[family.trim()];
  if (!fr) return name;
  return rest.length ? `${fr} :${rest.join(':')}` : fr;
}

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

/**
 * Pour la liste des positions d'une partie (FEN), renvoie :
 *   bookPlies : nombre de demi-coups théoriques consécutifs depuis le début ;
 *   names     : tableau (index = demi-coup) du nom de l'ouverture atteint à ce moment, ou null.
 */
export function openingInfo(fens) {
  const names = new Array(fens.length).fill(null);
  let bookPlies = 0;
  if (!data) return { bookPlies, names };
  let current = null;
  let inBook = true;
  for (let i = 1; i < fens.length; i++) {
    const idx = data.positions[epd(fens[i])];
    if (inBook && idx !== undefined) bookPlies = i;
    else inBook = false;
    if (idx !== undefined && idx >= 0) current = translate(data.names[idx]);
    names[i] = current;
  }
  return { bookPlies, names };
}
