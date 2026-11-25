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
| Drift | Espace | bouton Drift |
| Recommencer tout de suite | R ou Entrée | bouton ↺ |
| Retour au menu | Échap | bouton ‹ |

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
src/
  menu/               menu (profil, classé, salles, maps, battle cards)
  race/
    math/             maths déterministes (mêmes résultats sur toutes les machines)
    physics/          voiture : réglages, entrées, simulation pas à pas
    track/            pistes : construction, recherche de position, maps
    sim/              un essai (chrono, checkpoints, arrivée) et pilote automatique
    session/          les 10 essais d'un match, médailles, affichage des temps
    replay/           compression des replays
    input/            clavier et boutons tactiles
    render/           affichage 3D (Three.js) : décor, piste, voiture, caméra
    ui/               interface par-dessus la course
    main.ts           boucle de jeu
tests/                tests automatiques (Vitest)
docs/                 concept, architecture et feuille de route
```

Pour aller plus loin : [docs/CONCEPT.md](docs/CONCEPT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md).
