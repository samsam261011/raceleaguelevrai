import * as THREE from "three";
import type { Track } from "../track/types";
import { WALL_HEIGHT } from "../physics/constants";

const THICKNESS = 1.6;
const CURB = 0.9;
const CURB_LEN = 4;

const WALL_T = 0.6;

const COL_ROAD = new THREE.Color(0x5d6169);
const COL_ROAD_DARK = new THREE.Color(0x565a62);
const COL_SIDE = new THREE.Color(0x9a9ca3);
const COL_UNDER = new THREE.Color(0x6a6c74);
const COL_CURB_A = new THREE.Color(0xe0393b);
const COL_CURB_B = new THREE.Color(0xf6f6f6);
const COL_WALL = new THREE.Color(0xeef1f5);
const COL_WALL_TOP = new THREE.Color(0x2f6fd6);

/** Construit la piste en 3D : dalle, murets latéraux, bordures rouges et blanches, portiques de checkpoint, départ et arrivée. */
export function buildTrackMesh(track: Track): THREE.Group {
  const group = new THREE.Group();
  const pos: number[] = [];
  const col: number[] = [];

  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v.x, v.y, v.z);
      col.push(color.r, color.g, color.b);
    }
  };

  const edge = (i: number, off: number, dy = 0) => {
    // Droite de la piste (vue de derrière) : (-tz, tx), comme la physique
    const rx = -track.tz[i]!;
    const rz = track.tx[i]!;
    return new THREE.Vector3(track.px[i]! + rx * off, track.py[i]! + dy, track.pz[i]! + rz * off);
  };

  for (let i = 0; i < track.count - 1; i++) {
    if (!track.solid[i]) continue;
    const h0 = track.width[i]! / 2;
    const h1 = track.width[i + 1]! / 2;
    const band = Math.floor(track.dist[i]! / 12) % 2 === 0 ? COL_ROAD : COL_ROAD_DARK;
    // Dalle (sans les bordures)
    quad(edge(i, -h0 + CURB), edge(i + 1, -h1 + CURB), edge(i + 1, h1 - CURB), edge(i, h0 - CURB), band);
    // Bordures alternées
    const curb = Math.floor(track.dist[i]! / CURB_LEN) % 2 === 0 ? COL_CURB_A : COL_CURB_B;
    quad(edge(i, -h0, 0.04), edge(i + 1, -h1, 0.04), edge(i + 1, -h1 + CURB, 0.04), edge(i, -h0 + CURB, 0.04), curb);
    quad(edge(i, h0 - CURB, 0.04), edge(i + 1, h1 - CURB, 0.04), edge(i + 1, h1, 0.04), edge(i, h0, 0.04), curb);
    // Murets : ils ralentissent la voiture au contact (voir physics/car.ts)
    for (const s of [-1, 1]) {
      const a0 = s * h0, a1 = s * h1;
      const b0 = s * (h0 + WALL_T), b1 = s * (h1 + WALL_T);
      const top = WALL_HEIGHT;
      quad(edge(i, a0), edge(i + 1, a1), edge(i + 1, a1, top), edge(i, a0, top), COL_WALL);
      quad(edge(i, a0, top), edge(i + 1, a1, top), edge(i + 1, b1, top), edge(i, b0, top), COL_WALL_TOP);
      quad(edge(i, b0, -THICKNESS), edge(i + 1, b1, -THICKNESS), edge(i + 1, b1, top), edge(i, b0, top), COL_SIDE);
    }
    // Dessous
    const o0 = h0 + WALL_T, o1 = h1 + WALL_T;
    quad(edge(i, o0, -THICKNESS), edge(i + 1, o1, -THICKNESS), edge(i + 1, -o1, -THICKNESS), edge(i, -o0, -THICKNESS), COL_UNDER);
    // Bouts de dalle au bord d'un trou ou aux extrémités
    const capStart = i === 0 || !track.solid[i - 1];
    const capEnd = i === track.count - 2 || !track.solid[i + 1];
    if (capStart) quad(edge(i, o0), edge(i, o0, -THICKNESS), edge(i, -o0, -THICKNESS), edge(i, -o0), COL_SIDE);
    if (capEnd) quad(edge(i + 1, -o1), edge(i + 1, -o1, -THICKNESS), edge(i + 1, o1, -THICKNESS), edge(i + 1, o1), COL_SIDE);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.add(mesh);

  // Portiques
  const indexAt = (d: number) => {
    let i = 0;
    while (i < track.count - 1 && track.dist[i]! < d) i++;
    return i;
  };
  track.checkpointDist.forEach((d) => group.add(gate(track, indexAt(d), "checkpoint")));
  group.add(gate(track, 2, "start"));
  group.add(gate(track, indexAt(track.length - 0.5), "finish"));
  return group;
}

let checkerTex: THREE.CanvasTexture | null = null;
function checker(): THREE.Texture {
  if (checkerTex) return checkerTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d")!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#14101f" : "#ffffff";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  checkerTex = new THREE.CanvasTexture(c);
  checkerTex.magFilter = THREE.NearestFilter;
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  return checkerTex;
}

function gate(track: Track, i: number, kind: "start" | "finish" | "checkpoint"): THREE.Group {
  const g = new THREE.Group();
  const w = track.width[i]! / 2 + WALL_T + 0.6;
  const height = kind === "checkpoint" ? 6 : 7.5;
  const pillarMat = new THREE.MeshLambertMaterial({ color: kind === "checkpoint" ? 0xffb23e : 0x24324a, flatShading: true });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, height, 0.9), pillarMat);
    p.position.set(side * w, height / 2, 0);
    g.add(p);
  }
  const barMat =
    kind === "checkpoint"
      ? new THREE.MeshLambertMaterial({ color: 0xffb23e, emissive: 0x5a2a00 })
      : new THREE.MeshLambertMaterial({ map: checker(), emissive: 0x222222 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.9, kind === "checkpoint" ? 0.7 : 1.6, 0.5), barMat);
  bar.position.set(0, height, 0);
  g.add(bar);
  g.position.set(track.px[i]!, track.py[i]!, track.pz[i]!);
  g.rotation.y = Math.atan2(track.tx[i]!, track.tz[i]!);
  return g;
}
