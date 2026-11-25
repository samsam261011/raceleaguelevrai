# Architecture

## Principe : la course est déterministe

La physique tourne à **120 pas par seconde**, indépendamment de l'écran. À chaque pas, l'entrée du joueur
tient sur un octet (gaz, frein, gauche, droite). Avec les mêmes entrées, la simulation donne
**exactement** le même résultat sur toutes les machines.

C'est ce qui permet :

- **les fantômes** : on rejoue les entrées du meilleur essai à côté de l'essai en cours ;
- **les replays** : un essai de 30 s pèse quelques centaines d'octets (`src/race/replay/codec.ts`) ;
- **l'anti-triche** : le serveur rejouera les entrées envoyées et ne validera un temps que s'il retombe dessus
  (`replayAttempt` dans `src/race/sim/attempt.ts`).

Pour garantir ce déterminisme, la physique n'utilise que `+ - * /` et `Math.sqrt` (identiques partout selon la
norme IEEE 754). `Math.sin` et `Math.cos` peuvent varier d'un navigateur à l'autre : on utilise nos propres
versions (`src/race/math/dmath.ts`). L'affichage, lui, peut utiliser ce qu'il veut.

## Séparation simulation / affichage

```
Entrées (clavier, tactile) ──► Simulation (physics, track, sim) ──► État de la voiture
                                         ▲                                 │
                         replays, fantômes, serveur                         ▼
                                                              Affichage (render, ui)
```

- `physics/` et `track/` ne connaissent ni Three.js ni le navigateur : ils tournent aussi dans les tests et,
  plus tard, sur le serveur.
- `render/` interpole entre deux pas de physique pour que l'image reste fluide à 60, 120 ou 144 images/s.

## Pistes

Une map est une liste de points de contrôle (`src/race/track/maps/`). `buildTrack` en tire une piste
échantillonnée finement (courbes de Catmull-Rom). Un point marqué `gap: true` ouvre un trou à sauter.
Les checkpoints sont donnés en fraction de la longueur. Les temps des médailles sont calibrés avec le
pilote automatique (`src/race/sim/autopilot.ts`), qui sert aussi aux tests pour vérifier qu'une map est faisable.

## Multijoueur (à venir)

Les voitures ne se touchent pas : chaque joueur conduit en local et voit les autres en fantômes.
Le serveur (Node.js + Colyseus + PostgreSQL) gérera les salles, le matchmaking et la validation des temps.
Les comptes seront ceux de la plateforme (SDK Poki ou CrazyGames).
