import type { EditorMap, Tile } from "./layout";
import { MAX_LEVEL, PIECES, type PieceKind } from "./pieces";

/**
 * Code texte d'une map, à copier-coller pour la sauvegarder ou la partager.
 * Format « RL1- » + base64url de :
 *   version (1 octet), longueur du nom (1), nom en UTF-8, temps auteur en ms (4, 0 = aucun),
 *   nombre de pièces (2), puis 4 octets par pièce : type, x, z, étage × 4 + rotation.
 */
const KINDS = Object.keys(PIECES) as PieceKind[];
const PREFIX = "RL1-";

export function encodeMap(map: EditorMap): string {
  const name = new TextEncoder().encode(map.name.slice(0, 40)).slice(0, 80);
  const bytes = new Uint8Array(1 + 1 + name.length + 4 + 2 + map.tiles.length * 4);
  const view = new DataView(bytes.buffer);
  let o = 0;
  bytes[o++] = 1;
  bytes[o++] = name.length;
  bytes.set(name, o);
  o += name.length;
  view.setUint32(o, map.authorTime ? Math.round(map.authorTime * 1000) : 0);
  o += 4;
  view.setUint16(o, map.tiles.length);
  o += 2;
  for (const t of map.tiles) {
    bytes[o++] = KINDS.indexOf(t.kind);
    view.setInt8(o++, t.x);
    view.setInt8(o++, t.z);
    bytes[o++] = (t.level << 2) | (t.rot & 3);
  }
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeMap(code: string): EditorMap {
  const c = code.trim().replace(/\s+/g, "");
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
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error("Code incomplet");
  };
  let o = 0;
  need(2);
  if (bytes[o++] !== 1) throw new Error("Version de code inconnue");
  const nl = bytes[o++]!;
  need(nl + 6);
  const name = new TextDecoder().decode(bytes.slice(o, o + nl));
  o += nl;
  const ms = view.getUint32(o);
  o += 4;
  const count = view.getUint16(o);
  o += 2;
  need(count * 4);
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    const kind = KINDS[bytes[o++]!];
    const x = view.getInt8(o++);
    const z = view.getInt8(o++);
    const lr = bytes[o++]!;
    if (!kind) throw new Error("Pièce inconnue dans le code");
    tiles.push({ kind, x, z, level: Math.min(MAX_LEVEL, lr >> 2), rot: lr & 3 });
  }
  return { name, authorTime: ms ? ms / 1000 : null, tiles };
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
