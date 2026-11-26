import { opposite, PIECES, rotSide, rotXZ, SIDE_DIR, type Side } from "./pieces";
import { blockPath, type Block } from "./world";

/** Le chemin « normal » d'une map, du départ à l'arrivée (pilote automatique, longueur estimée). */
export interface Route {
  px: number[];
  py: number[];
  pz: number[];
  dist: number[];
  length: number;
  /** Indices des pièces traversées, dans l'ordre. */
  order: number[];
}

interface WorldPort {
  x: number;
  z: number;
  side: Side;
  level: number;
}

function ports(b: Block): WorldPort[] {
  return PIECES[b.kind].ports.map((p) => {
    const [rx, rz] = rotXZ(p.cell[0], p.cell[1], b.rot);
    return { x: b.x + rx, z: b.z + rz, side: rotSide(p.side, b.rot), level: b.level + p.h };
  });
}

/**
 * Suit les raccords depuis le départ. Après un tremplin (ou n'importe quelle sortie dans le vide),
 * cherche la pièce d'atterrissage jusqu'à 5 cases plus loin, au même niveau ou plus bas.
 * Renvoie null si le chemin n'arrive pas jusqu'à l'arrivée.
 */
export function findRoute(blocks: Block[]): Route | null {
  const start = blocks.findIndex((b) => b.kind === "depart");
  if (start < 0) return null;
  const route: Route = { px: [], py: [], pz: [], dist: [], length: 0, order: [] };
  const used = new Set<number>();
  let cur = start;
  let entry: WorldPort | null = null;

  for (let guard = 0; guard < 2000; guard++) {
    used.add(cur);
    route.order.push(cur);
    const b = blocks[cur]!;
    const ps = ports(b);
    const def = PIECES[b.kind];
    // Sortie : l'autre raccord, ou en face pour une plaque
    let exit: WorldPort | undefined;
    if (def.plate && entry) {
      const want = opposite(entry.side);
      exit = ps.find((p) => p.side === want);
    } else {
      exit = ps.find((p) => !entry || !(p.x === entry.x && p.z === entry.z && p.side === entry.side && p.level === entry.level));
    }
    // Tracé dans le bon sens
    let pts = blockPath(b);
    if (def.plate && entry) {
      const [dx, dz] = SIDE_DIR[opposite(entry.side)]!;
      const cx = b.x * 20, cz = b.z * 20, y = pts[0]!.y;
      pts = [
        { x: cx - dx * 10, y, z: cz - dz * 10 },
        { x: cx + dx * 10, y, z: cz + dz * 10 },
      ];
    } else if (entry && ps.length >= 2) {
      const first = ps[0]!;
      const enteredByFirst = first.x === entry.x && first.z === entry.z && first.side === entry.side;
      if (!enteredByFirst) pts = pts.reverse();
    }
    for (const p of pts) push(route, p.x, p.y, p.z);
    if (b.kind === "arrivee") return route;
    if (!exit) return null;

    const [dx, dz] = SIDE_DIR[exit.side]!;
    const want = opposite(exit.side);
    let found = -1;
    let foundPort: WorldPort | null = null;
    for (let k = 1; k <= 5 && found < 0; k++) {
      const nx = exit.x + dx * k;
      const nz = exit.z + dz * k;
      const minLevel = k === 1 ? exit.level : 0;
      for (let lv = exit.level + (k === 1 ? 0 : 2); lv >= minLevel && found < 0; lv--) {
        for (let i = 0; i < blocks.length && found < 0; i++) {
          if (used.has(i)) continue;
          const c = blocks[i]!;
          if (c.kind === "depart") continue;
          for (const p of ports(c)) {
            if (p.x === nx && p.z === nz && p.side === want && p.level === lv) {
              found = i;
              foundPort = p;
              break;
            }
          }
        }
      }
    }
    if (found < 0 || !foundPort) return null;
    cur = found;
    entry = foundPort;
  }
  return null;
}

function push(r: Route, x: number, y: number, z: number): void {
  const n = r.px.length;
  if (n > 0) {
    const dx = x - r.px[n - 1]!;
    const dy = y - r.py[n - 1]!;
    const dz = z - r.pz[n - 1]!;
    // Distance réelle : un looping monte et redescend
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return;
    r.length += d;
  }
  r.px.push(x);
  r.py.push(y);
  r.pz.push(z);
  r.dist.push(r.length);
}
