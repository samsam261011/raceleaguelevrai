import { HALF, MAX_LEVEL, opposite, PIECES, SIDE_DIR, STEP, TILE, type PieceKind, type Side } from "./pieces";
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

/**
 * Raccord d'une pièce posée : un bout de sa ligne centrale, la direction vers laquelle il sort
 * (un des quatre côtés) et la largeur de la route à cet endroit.
 * Deux pièces se raccordent quand deux de leurs bouts se touchent, en sens opposés, avec la même largeur.
 */
export interface BlockPort {
  x: number;
  y: number;
  z: number;
  side: Side;
  /** Demi-largeur de la route à ce bout (10 m, 20 m pour une double voie). */
  half: number;
  /** 0 : début de la ligne centrale, 1 : fin ; -1 : bord d'une plaque. */
  end: 0 | 1 | -1;
}

/** Côté de la grille le plus proche d'une direction au sol. */
function sideOf(dx: number, dz: number): Side {
  if (Math.abs(dz) >= Math.abs(dx)) return dz > 0 ? 0 : 2;
  return dx > 0 ? 1 : 3;
}

export function blockPorts(b: Block): BlockPort[] {
  const def = PIECES[b.kind];
  const pts = blockPath(b);
  if (def.plate) {
    // Une plaque se traverse dans les quatre sens
    return ([0, 1, 2, 3] as Side[]).map((side) => {
      const [dx, dz] = SIDE_DIR[side]!;
      return { x: b.x * TILE + dx * HALF, y: b.level * STEP, z: b.z * TILE + dz * HALF, side, half: HALF, end: -1 as const };
    });
  }
  const n = pts.length;
  const a = pts[0]!;
  const a1 = pts[1]!;
  const z = pts[n - 1]!;
  const z1 = pts[n - 2]!;
  const w = def.width ?? [HALF, HALF];
  return [
    { x: a.x, y: a.y, z: a.z, side: sideOf(a.x - a1.x, a.z - a1.z), half: w[0], end: 0 },
    { x: z.x, y: z.y, z: z.z, side: sideOf(z.x - z1.x, z.z - z1.z), half: w[1], end: 1 },
  ];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** Les deux raccords se touchent-ils (même point, sens opposés, même largeur) ? */
export function portsMatch(p: BlockPort, q: BlockPort): boolean {
  return near(p.x, q.x) && near(p.y, q.y) && near(p.z, q.z) && q.side === opposite(p.side) && near(p.half, q.half);
}

/** Raccords libres d'un circuit : les bouts de pièces auxquels rien n'est encore raccordé. */
export function openPorts(blocks: Block[]): (BlockPort & { block: number })[] {
  const all = blocks.map(blockPorts);
  const out: (BlockPort & { block: number })[] = [];
  all.forEach((ps, i) => {
    // Les bords d'une plaque ne comptent pas : elle se traverse dans tous les sens
    if (PIECES[blocks[i]!.kind].plate) return;
    for (const p of ps) {
      const taken = all.some((qs, j) => j !== i && qs.some((q) => portsMatch(p, q)));
      if (!taken) out.push({ ...p, block: i });
    }
  });
  return out;
}

const isInt = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;

/**
 * Toutes les façons de poser une pièce pour qu'elle se raccorde à `port` : rotation, case et hauteur.
 * D'abord celles où l'on entre par le début de la pièce (elle se déroule dans son sens), puis à l'envers
 * (un virage à droite pris à l'envers devient un virage à gauche).
 */
export function placementsAt(kind: PieceKind, port: BlockPort): Block[] {
  const forward: Block[] = [];
  const backward: Block[] = [];
  const seen = new Set<string>();
  for (let rot = 0; rot < 4; rot++) {
    const probe: Block = { kind, x: 0, z: 0, level: 0, rot };
    for (const p of blockPorts(probe)) {
      if (p.side !== opposite(port.side) || !near(p.half, port.half)) continue;
      const bx = (port.x - p.x) / TILE;
      const bz = (port.z - p.z) / TILE;
      const lv = (port.y - p.y) / STEP;
      if (!isInt(bx) || !isInt(bz) || !isInt(lv)) continue;
      // « || 0 » : jamais de -0 (il s'affiche 0 mais se compare mal)
      const b: Block = { kind, x: Math.round(bx) || 0, z: Math.round(bz) || 0, level: Math.round(lv) || 0, rot };
      if (b.level < 0 || b.level > MAX_LEVEL) continue;
      // Une plaque est la même dans les quatre rotations
      const key = PIECES[kind].plate ? `${b.x},${b.z},${b.level}` : `${b.x},${b.z},${b.level},${b.rot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (p.end === 1 ? backward : forward).push(b);
    }
  }
  return [...forward, ...backward];
}

/**
 * Suit les raccords depuis le départ. Après un tremplin (ou n'importe quelle sortie dans le vide),
 * cherche la pièce d'atterrissage jusqu'à 4 cases plus loin, au même niveau ou plus bas (ou un peu plus haut).
 * Renvoie null si le chemin n'arrive pas jusqu'à l'arrivée.
 */
export function findRoute(blocks: Block[]): Route | null {
  const start = blocks.findIndex((b) => PIECES[b.kind].gate === "start");
  if (start < 0) return null;
  const route: Route = { px: [], py: [], pz: [], dist: [], length: 0, order: [] };
  const used = new Set<number>();
  const portsOf = blocks.map(blockPorts);
  let cur = start;
  let entry: BlockPort | null = null;

  for (let guard = 0; guard < 2000; guard++) {
    used.add(cur);
    route.order.push(cur);
    const b = blocks[cur]!;
    const ps = portsOf[cur]!;
    const def = PIECES[b.kind];
    // Sortie : l'autre bout, ou le côté d'en face pour une plaque
    let exit: BlockPort | undefined;
    let pts = blockPath(b);
    if (def.plate) {
      const want = entry ? opposite(entry.side) : 0;
      exit = ps.find((p) => p.side === want);
      const [dx, dz] = SIDE_DIR[want]!;
      const cx = b.x * TILE;
      const cz = b.z * TILE;
      const y = pts[0]!.y;
      pts = [
        { x: cx - dx * HALF, y, z: cz - dz * HALF },
        { x: cx + dx * HALF, y, z: cz + dz * HALF },
      ];
    } else {
      const reversed = entry !== null && entry.end === 1;
      exit = ps[reversed ? 0 : 1];
      if (reversed) pts = pts.reverse();
    }
    for (const p of pts) push(route, p.x, p.y, p.z);
    if (def.gate === "finish") return route;
    if (!exit) return null;

    // Pièce suivante : collée à la sortie, ou plus loin dans le prolongement (saut)
    const [dx, dz] = SIDE_DIR[exit.side]!;
    let found = -1;
    let foundPort: BlockPort | null = null;
    for (let k = 0; k <= 4 && found < 0; k++) {
      const tx = exit.x + dx * TILE * k;
      const tz = exit.z + dz * TILE * k;
      const maxY = exit.y + (k === 0 ? 0.25 : 2 * STEP);
      let bestY = -Infinity;
      for (let i = 0; i < blocks.length; i++) {
        if (used.has(i) || PIECES[blocks[i]!.kind].gate === "start") continue;
        for (const p of portsOf[i]!) {
          if (!near(p.x, tx) || !near(p.z, tz) || p.side !== opposite(exit.side) || !near(p.half, exit.half)) continue;
          if (p.y > maxY || p.y <= bestY) continue;
          bestY = p.y;
          found = i;
          foundPort = p;
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
