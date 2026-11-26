# RaceLeague

Jeu de course 3D en duel, jouable directement dans le navigateur, sur ordinateur et sur téléphone.

**Le principe** : une map tirée au sort parmi 20, chaque joueur a **10 essais**, le meilleur temps gagne.
On joue en classé contre des inconnus de son niveau, ou entre potes avec un code de salle.

## Lancer le jeu sur ton ordinateur

Il faut [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install      # une seule fois
npm run dev      # lance le jeu sur http://localhost:5173
```

- `http://localhost:5173/` : le menu principal
- `http://localhost:5173/race.html` : la course (map « Le Grand Saut »)

## Commandes

| Action | Clavier | Téléphone |
| --- | --- | --- |
| Accélérer | ↑ ou Z/W | bouton Gaz |
| Freiner / marche arrière | ↓ ou S | bouton Frein |
| Tourner | ← → ou Q/A D | flèches à gauche |
| Recommencer tout de suite | R ou Entrée | bouton ↺ |
| Retour au menu | Échap | bouton ‹ |

Les touches se changent dans **Paramètres** (menu principal ou roue dentée pendant la course).
Le chrono de chaque essai ne démarre qu'à la première touche de conduite : pas de décompte.

En développement (`npm run dev`), `race.html?pilote` fait conduire un pilote automatique tant qu'on tient le gaz,
pratique pour tester le fantôme et l'écran de fin.

## Éditeur de circuits

`editor.html` (bouton « Créer un circuit » dans Maps, ou « Éditeur de circuits » dans le menu ☰).

- **Aimant** (activé par défaut, touche A) : on choisit une pièce et on l'approche d'une **flèche orange**
  (un bout de piste libre). Elle s'y raccorde toute seule : bonne case, bonne rotation, bonne hauteur.
  **Sens** (touche F) passe d'un raccord à l'autre : virage à gauche ou à droite, pente qui monte ou qui descend.
  Loin des flèches, la pièce se pose librement sur la grille, à la hauteur choisie (0 à 63, par crans de 2 m).
- Les pièces sont rangées par familles, avec une vignette 3D :
  - Course : départ, checkpoint, arrivée, route.
  - Virages : serré, moyen (2×2), grand (3×3), très grand (4×4), chicanes gauche et droite.
  - Relief : pente, pied de pente, haut de pente, pente raide, longue pente, bosse, virages en montée gauche et droite, tremplin.
    Pied de pente + Pente + Haut de pente font une côte sans aucune cassure, qu'on monte ou descend à fond.
  - Double voie (40 m de large) : route, élargissement, virages double serré, double et grand double, pente,
    départ, checkpoint et arrivée doubles.
  - Figures : virage relevé, grand virage relevé, mur, looping.
  - Plaques : plaque, plaque en pente.
- Les piliers sont ajoutés tout seuls sous les blocs en hauteur. Deux routes posées côte à côte à la même hauteur
  perdent le rebord entre elles. Le statut signale les pièces trop proches l'une de l'autre en hauteur (moins de 6 m).
- Clic : poser · clic droit ou Gomme : effacer · R : tourner · F : sens · C ou clic molette : copier la pièce visée ·
  1 à 9 : choisir la pièce de la famille · Page haut/bas : hauteur · glisser : déplacer la vue · molette : zoom ·
  Q/E : tourner la vue · V : tout voir · Ctrl+Z / Ctrl+Y : annuler / rétablir.
- Il faut un seul départ et au moins une arrivée. Si plusieurs checkpoints sont posés, il faut tous les passer
  (dans n'importe quel ordre) pour que l'arrivée compte. Le statut dit si le tracé est relié du départ à l'arrivée.
- **Tester** lance la course sur le circuit. Ton meilleur temps devient le temps auteur, qui fixe les médailles
  (or +5 %, argent +15 %, bronze +35 %).
- **Circuits** : enregistrer ses circuits, en ouvrir un, partir d'une copie d'une des 8 maps du jeu,
  et le code `RL2-…` qui contient tout le circuit (à copier pour le garder ou l'envoyer).
  `race.html?code=RL2-…` joue directement un circuit. Les anciens codes `RL1-…` ne s'ouvrent plus.

## Les 8 maps officielles

`src/race/world/maps/m1…m8` : Le Grand Saut, Spirale, Fil du Rasoir, Double Boucle, La Chute, Serpentin,
Pont Cassé, Tremplin. Elles sont écrites pièce après pièce avec `Chain` (comme l'aimant de l'éditeur).
`tests/maps.test.ts` vérifie que chacune est valide, sans pièces qui se gênent, et qu'elle se termine au
pilote automatique dans son temps auteur (le temps auteur est le meilleur temps du pilote automatique).

## Autres commandes utiles

```bash
npm test           # tests automatiques (physique, replays, règles des 10 essais)
npm run typecheck  # vérification TypeScript
npm run build      # version prête à publier, dans dist/
npm run preview    # teste la version publiée en local
```

## Organisation du projet

```
index.html            menu principal
race.html             écran de course
editor.html           éditeur de circuits
src/
  menu/               menu (profil, classé, salles, maps, battle cards)
  editor/             éditeur : pose des blocs, aperçu, codes, interface
  shared/             touches modifiables (menu et course)
  race/
    math/             maths déterministes (mêmes résultats sur toutes les machines)
    physics/          voiture : réglages, entrées, simulation pas à pas
    world/            blocs : pièces, monde (sol sous la voiture, rebords, portiques), codes, maps
    sim/              un essai (chrono, checkpoints, arrivée) et pilote automatique
    session/          les 10 essais d'un match, médailles, affichage des temps
    replay/           compression des replays
    input/            clavier et boutons tactiles
    render/           affichage 3D (Three.js) : décor, blocs, voiture, caméra, traits de vitesse
    ui/               interface par-dessus la course
    main.ts           boucle de jeu
tests/                tests automatiques (Vitest)
docs/                 concept, architecture et feuille de route
```

Pour aller plus loin : [docs/CONCEPT.md](docs/CONCEPT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md).
