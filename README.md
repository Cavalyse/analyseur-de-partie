# site-chess-analyser

Site web qui analyse les parties d'échecs jouées sur **Chess.com**, avec le moteur **Stockfish** exécuté directement dans le navigateur.

## Fonctionnalités

- Recherche des parties d'un joueur via son pseudo Chess.com (mois par mois), ou collage d'un PGN.
- Analyse coup par coup avec Stockfish 19 (version WebAssembly « lite », sans serveur).
- Classification des coups, avec les couleurs et icônes de la revue de partie Chess.com : brillant !!, meilleur coup ★,
  excellent, bon, imprécision ?!, erreur ?, gaffe ??. L'icône s'affiche sur l'échiquier, sur la case d'arrivée du coup.
- Précision de chaque joueur (formule de type Lichess) et, si disponible, la précision Chess.com.
- Meilleur coup proposé (flèche sur l'échiquier + variante principale).
- Barre et courbe d'évaluation cliquable, navigation au clavier (← → ↑ ↓, `F` pour retourner l'échiquier).
- Profondeur d'analyse réglable, interface sombre façon Chess.com, adaptée au mobile.

## Lancer le site en local

Le site est 100 % statique (HTML/CSS/JS, aucune étape de build). Il faut simplement le servir via HTTP
(ouvrir `index.html` directement ne marche pas à cause du Web Worker du moteur) :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne

N'importe quel hébergeur de fichiers statiques convient (GitHub Pages, Netlify, Vercel…).
Avec GitHub Pages : *Settings → Pages → Deploy from a branch*, choisir la branche et le dossier `/ (root)`.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page |
| `css/style.css` | Mise en page et thème (palette inspirée de Chess.com) |
| `css/pieces.css` | Images des pièces (SVG intégrés) |
| `js/app.js` | Logique de l'interface : recherche, chargement d'une partie, boucle d'analyse, affichage |
| `js/chesscom.js` | Appels à l'API publique Chess.com |
| `js/engine.js` | Client UCI pour piloter Stockfish dans un Web Worker |
| `js/analysis.js` | Pourcentage de gain, classification des coups, précision |
| `js/board.js` | Dessin de l'échiquier et des flèches |
| `js/graph.js` | Courbe d'évaluation |
| `js/vendor/chess.js` | [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 (règles du jeu, lecture des PGN) |
| `engine/` | [Stockfish.js](https://github.com/nmrugg/stockfish.js) 19 « lite single-threaded » |

## Comment l'analyse fonctionne

Pour chaque position de la partie, Stockfish calcule une évaluation et le meilleur coup. L'évaluation est convertie en
probabilité de gain (0–100 %). La perte de probabilité causée par un coup détermine sa classification :

| Perte de probabilité de gain | Classification |
| --- | --- |
| coup identique à celui du moteur | Meilleur coup |
| < 2 % | Excellent |
| < 5 % | Bon |
| < 10 % | Imprécision |
| < 20 % | Erreur |
| ≥ 20 % | Gaffe |

Un coup est **brillant** s'il est le meilleur (ou excellent), que la pièce jouée est sacrifiée (l'adversaire la prend et
garde au moins 2 pions d'avance en matériel dans la meilleure suite) et que la position reste bonne pour le joueur.

La précision d'un coup vaut `103,1668 × e^(−0,04354 × perte) − 3,1669` (formule publiée par Lichess). Les chiffres
peuvent donc différer légèrement de ceux de Chess.com, dont la méthode n'est pas publique.

## Licences

- Stockfish est distribué sous licence GPLv3 (`engine/COPYING-stockfish.txt`).
- chess.js est sous licence BSD-2 (`js/vendor/chess.js.LICENSE`).
- Pièces « cburnett » par Colin M.L. Burnett, sous licence CC BY-SA 3.0.
- Icônes étoile, pouce et coche : Material Icons (Google), licence Apache 2.0.
