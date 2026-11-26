import { MAX_LEVEL, PIECES, type PieceKind } from "./pieces";
import type { Block } from "./world";

/** Une map telle que l'éditeur la garde. */
export interface EditorMap {
  name: string;
  /** Meilleur temps du créateur en test (secondes) : sert de temps auteur. */
  authorTime: number | null;
  blocks: Block[];
}

/**
 * Code texte d'une map, à copier-coller pour la garder ou la partager.
 * Format « RL2- » + base64url de :
 *   version (1 octet), longueur du nom (1), nom en UTF-8, temps auteur en ms (4, 0 = aucun),
 *   nombre de pièces (2), puis 4 octets par pièce : type, x, z, hauteur × 4 + rotation.
 */
/**
 * Numéros des pièces dans les codes : liste figée pour que les anciens codes restent lisibles.
 * Les boosters ont été retirés du jeu : un ancien code qui en contient les relit comme des plaques.
 */
const CODE_KINDS = [
  "depart",
  "route",
  "virage",
  "virage2",
  "virage3",
  "pente",
  "penteRaide",
  "tremplin",
  "plaque",
  "plaquePente",
  "booster",
  "checkpoint",
  "arrivee",
  // Ajoutées ensuite : toujours à la fin, pour que les anciens codes gardent leurs numéros
  "virageReleve",
  "mur",
  "looping",
  "virage4",
  "chicane",
  "chicaneG",
  "penteLongue",
  "bosse",
  "virageMontant",
  "grandVirageReleve",
  "routeLarge",
  "elargir",
  "virageLargeCourt",
  "virageLarge",
  "grandVirageLarge",
  "penteLarge",
  "departLarge",
  "checkpointLarge",
  "arriveeLarge",
  "virageMontantD",
  "penteBas",
  "penteHaut",
] as const;
const RENAMED: Partial<Record<(typeof CODE_KINDS)[number], PieceKind>> = { booster: "plaque" };
const PREFIX = "RL2-";

export function encodeMap(map: EditorMap): string {
  const name = new TextEncoder().encode(map.name.slice(0, 40)).slice(0, 80);
  const bytes = new Uint8Array(1 + 1 + name.length + 4 + 2 + map.blocks.length * 4);
  const view = new DataView(bytes.buffer);
  let o = 0;
  bytes[o++] = 2;
  bytes[o++] = name.length;
  bytes.set(name, o);
  o += name.length;
  view.setUint32(o, map.authorTime ? Math.round(map.authorTime * 1000) : 0);
  o += 4;
  view.setUint16(o, map.blocks.length);
  o += 2;
  for (const b of map.blocks) {
    bytes[o++] = CODE_KINDS.indexOf(b.kind as (typeof CODE_KINDS)[number]);
    view.setInt8(o++, b.x);
    view.setInt8(o++, b.z);
    bytes[o++] = (Math.min(MAX_LEVEL, b.level) << 2) | (b.rot & 3);
  }
  let bin = "";
  bytes.forEach((v) => (bin += String.fromCharCode(v)));
  return PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeMap(code: string): EditorMap {
  const c = code.trim().replace(/\s+/g, "");
  if (c.startsWith("RL1-")) throw new Error("Code de l'ancien éditeur : il n'est plus compatible");
  if (!c.startsWith(PREFIX)) throw new Error("Ce n'est pas un code de map RaceLeague");
  let b64 = c.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error("Code abîmé");
  }
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let o = 0;
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error("Code incomplet");
  };
  need(2);
  if (bytes[o++] !== 2) throw new Error("Version de code inconnue");
  const nl = bytes[o++]!;
  need(nl + 6);
  const name = new TextDecoder().decode(bytes.slice(o, o + nl));
  o += nl;
  const ms = view.getUint32(o);
  o += 4;
  const count = view.getUint16(o);
  o += 2;
  need(count * 4);
  const blocks: Block[] = [];
  for (let i = 0; i < count; i++) {
    const raw = CODE_KINDS[bytes[o++]!];
    const kind = raw ? (RENAMED[raw] ?? (raw as PieceKind)) : undefined;
    const x = view.getInt8(o++);
    const z = view.getInt8(o++);
    const lr = bytes[o++]!;
    if (!kind || !PIECES[kind]) throw new Error("Pièce inconnue dans le code");
    blocks.push({ kind, x, z, level: lr >> 2, rot: lr & 3 });
  }
  return { name, authorTime: ms ? ms / 1000 : null, blocks };
}

/** Petit hachage stable d'un texte (FNV-1a), pour ranger les records par map. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Identifiant stable d'une map d'éditeur : ne dépend que des pièces (ni du nom, ni du temps auteur). */
export function customMapId(blocks: Block[]): string {
  return "custom-" + hashText(encodeMap({ name: "", authorTime: null, blocks }));
}
