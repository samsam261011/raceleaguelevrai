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
Entrées (clavier, tactile) ──► Simulation (physics, world, sim) ──► État de la voiture
                                         ▲                                 │
                         replays, fantômes, serveur                         ▼
                                                              Affichage (render, ui)
```

- `physics/` et `world/` ne connaissent ni Three.js ni le navigateur : ils tournent aussi dans les tests et,
  plus tard, sur le serveur.
- `render/` interpole entre deux pas de physique pour que l'image reste fluide à 60, 120 ou 144 images/s.

## Pistes

Une map est une liste de blocs posés : type, case (x, z), hauteur (crans de 2 m) et quart de tour
(`src/race/world/`). Chaque type de pièce (`pieces.ts`) a une ligne centrale ; sa surface fait 20 m de large
autour de cette ligne. `buildWorld` range les blocs par case. À chaque pas, la physique cherche dans la case de la
voiture la surface la plus haute qui n'est pas au-dessus d'elle (`groundAt`) : c'est le sol. Pas de sol, la voiture
vole ; sous la hauteur de l'herbe, l'essai est perdu. Les rebords sont sur les côtés des pièces, sauf si un autre
bloc est collé de ce côté à la même hauteur.

`findRoute` suit les raccords du départ à l'arrivée (en cherchant l'atterrissage jusqu'à 5 cases après un saut).
Il sert au pilote automatique, aux tests et à estimer la longueur d'un circuit. Les temps des médailles sont
calibrés avec ce pilote (`src/race/sim/autopilot.ts`).

## Multijoueur (à venir)

Les voitures ne se touchent pas : chaque joueur conduit en local et voit les autres en fantômes.
Le serveur (Node.js + Colyseus + PostgreSQL) gérera les salles, le matchmaking et la validation des temps.
Les comptes seront ceux de la plateforme (SDK Poki ou CrazyGames).
