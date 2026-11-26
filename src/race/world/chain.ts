import { PIECES, SIDE_DIR, STEP, TILE, type PieceKind } from "./pieces";
import { blockPorts, placementsAt, type BlockPort } from "./route";
import type { Block } from "./world";

/**
 * Pose une suite de pièces bout à bout, comme on le ferait dans l'éditeur avec l'aimant :
 * chaque pièce se raccorde à la sortie de la précédente, sa case, sa rotation et sa hauteur sont calculées.
 * `rev` prend la pièce à l'envers : un virage à droite devient un virage à gauche, une pente monte ou descend.
 * Sert à écrire les maps officielles lisiblement ; le résultat est une simple liste de pièces.
 */
export class Chain {
  readonly blocks: Block[] = [];
  private port: BlockPort;

  constructor(start: Block) {
    this.blocks.push(start);
    const ps = blockPorts(start);
    this.port = ps[ps.length - 1]!;
  }

  /** Ajoute une pièce. `rev` : à l'envers. */
  add(kind: PieceKind, rev = false): this {
    const touches = (p: BlockPort) => Math.abs(p.x - this.port.x) < 0.5 && Math.abs(p.z - this.port.z) < 0.5 && Math.abs(p.y - this.port.y) < 0.5;
    const b = placementsAt(kind, this.port).find((o) => PIECES[kind].plate || touches(blockPorts(o)[0]!) !== rev);
    if (!b) throw new Error(`Impossible de raccorder ${kind}${rev ? " (à l'envers)" : ""} après la pièce ${this.blocks.length - 1}`);
    this.blocks.push(b);
    const ps = blockPorts(b);
    if (PIECES[kind].plate) {
      // On traverse la plaque tout droit
      this.port = ps.find((p) => p.side === this.port.side)!;
    } else {
      this.port = touches(ps[0]!) ? ps[1]! : ps[0]!;
    }
    return this;
  }

  /** Plusieurs fois la même pièce. */
  times(n: number, kind: PieceKind, rev = false): this {
    for (let i = 0; i < n; i++) this.add(kind, rev);
    return this;
  }

  /** Vide de `cells` cases (saut), la suite étant posée `drop` crans plus bas (négatif : plus haut). */
  gap(cells: number, drop = 0): this {
    const [dx, dz] = SIDE_DIR[this.port.side]!;
    // Après un tremplin, la sortie est au-dessus du niveau de la pièce : on repart de son niveau
    const last = this.blocks[this.blocks.length - 1]!;
    const y = last.kind === "tremplin" ? last.level * STEP : this.port.y;
    this.port = { ...this.port, x: this.port.x + dx * TILE * cells, z: this.port.z + dz * TILE * cells, y: y - drop * STEP };
    return this;
  }

  /** Raccord de sortie actuel (pour vérifier où l'on est). */
  get end(): BlockPort {
    return this.port;
  }
}
