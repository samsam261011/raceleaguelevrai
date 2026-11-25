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

- On pose des blocs librement sur une grille de cases de 20 m, à n'importe quelle hauteur (0 à 63, par crans de 2 m) :
  départ, route, trois virages (serré, moyen 2×2, grand 3×3), pente, pente raide, tremplin, plaque, plaque en pente,
  booster, checkpoint, arrivée. Rien n'oblige à suivre un chemin : ponts, sauts par-dessus le vide, routes côte à côte.
- Les piliers sont ajoutés tout seuls sous les blocs en hauteur. Deux routes posées côte à côte à la même hauteur
  perdent le rebord entre elles et forment une route plus large. Les plaques et le booster n'ont pas de rebord.
- Clic : poser · clic droit ou Gomme : effacer · R : tourner · 1 à 9 : choisir la pièce · Page haut/bas : hauteur ·
  glisser : déplacer la vue · molette : zoom · Q/E : tourner la vue · Ctrl+Z : annuler.
- Une pente prise dans l'autre sens descend. Tomber dans l'herbe fait recommencer l'essai.
- Il faut un seul départ et au moins une arrivée. Si plusieurs checkpoints sont posés, il faut tous les passer
  (dans n'importe quel ordre) pour que l'arrivée compte.
- **Tester** lance la course sur le circuit. Ton meilleur temps devient le temps auteur, qui fixe les médailles
  (or +5 %, argent +15 %, bronze +35 %).
- **Code** donne un texte `RL2-…` qui contient tout le circuit : à copier pour le garder ou l'envoyer.
  `race.html?code=RL2-…` joue directement un circuit. Les anciens codes `RL1-…` ne s'ouvrent plus.

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
