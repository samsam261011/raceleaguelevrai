import * as THREE from "three";
import { TILE } from "../world/pieces";
import type { World } from "../world/world";

/**
 * Ambiance « Ligue Solaire » : soleil chaud et bas, ciel bleu profond qui passe au pêche à l'horizon,
 * brume chaude, ombres portées bleu-violet. Renvoie le soleil pour que la vue fasse suivre ses ombres.
 */
export function buildEnvironment(scene: THREE.Scene, world: World): Lighting {
  const lighting = buildSky(scene);
  decorate(scene, world);
  return lighting;
}

export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

/** Couleurs de l'ambiance (palette de la direction artistique). */
export const AMBIANCE = {
  sun: 0xffd9a8,
  zenith: 0x3b7fd4,
  horizon: 0xf6d2ac,
  /** Lumière du ciel : bleu tirant sur le violet, c'est elle qui colore les ombres. */
  skyLight: 0xa3b2ff,
  /** Lumière renvoyée par le sol : ocre. */
  groundLight: 0xc98a5a,
  fogNear: 300,
  fogFar: 1200,
};

/** Direction vers le soleil : 35° au-dessus de l'horizon, derrière à gauche au départ (la voiture est éclairée, les ombres filent en diagonale vers l'avant). */
const SUN_ELEVATION = (35 * Math.PI) / 180;
const SUN_AZIMUTH = (220 * Math.PI) / 180;
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
).normalize();

/** Réglages des ombres : une seule carte, plus petite sur les machines modestes. */
export function shadowQuality(): { mapSize: number; radius: number } {
  let low = false;
  try {
    low = matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
  } catch {
    /* navigateur sans matchMedia : on garde la qualité normale */
  }
  return low ? { mapSize: 1024, radius: 55 } : { mapSize: 2048, radius: 70 };
}

/** Pelouse tondue en bandes (une bande par case) : on voit défiler le sol, donc la vitesse. */
export function buildGround(groundY: number): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#79c04a";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#6bb03f";
  g.fillRect(0, 0, 64, 128);
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,200" : "20,60,10"},${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const size = 4000;
  tex.repeat.set(size / (2 * TILE), size / (2 * TILE));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(TILE / 2, groundY, TILE / 2);
  ground.receiveShadow = true;
  return ground;
}

/** Ciel, brume, soleil et lumière d'ambiance. Utilisé aussi par l'éditeur. */
export function buildSky(scene: THREE.Scene): Lighting {
  scene.fog = new THREE.Fog(AMBIANCE.horizon, AMBIANCE.fogNear, AMBIANCE.fogFar);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(AMBIANCE.zenith) },
        horizon: { value: new THREE.Color(AMBIANCE.horizon) },
        sunColor: { value: new THREE.Color(AMBIANCE.sun) },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = d.y;
          // Dégradé : bleu profond en haut, pêche à l'horizon (et sous l'horizon, caché par la brume)
          vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.4, h), 0.65));
          float s = max(dot(d, sunDir), 0.0);
          // Bande plus chaude à l'horizon du côté du soleil
          col += sunColor * 0.22 * pow(1.0 - clamp(abs(h), 0.0, 1.0), 5.0) * pow(s, 2.0);
          // Halo : une large lueur et un cœur plus serré
          col += sunColor * (pow(s, 3.0) * 0.18 + pow(s, 8.0) * 0.25 + pow(s, 48.0) * 0.55 + pow(s, 400.0) * 0.9);
          // Disque du soleil
          col = mix(col, vec3(1.0, 0.97, 0.9) * 1.6, smoothstep(0.9990, 0.9996, s));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);

  // Ciel bleu-violet au-dessus, sol ocre en dessous : les faces à l'ombre virent au bleu-violet, jamais au gris
  const hemi = new THREE.HemisphereLight(AMBIANCE.skyLight, AMBIANCE.groundLight, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(AMBIANCE.sun, 2.7);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  scene.add(sun, sun.target);
  return { sun, hemi };
}

/**
 * Active les ombres du soleil. La zone d'ombre (un carré autour de la voiture) suit la course :
 * une seule carte d'ombre, quelle que soit la taille du circuit.
 */
export function enableSunShadows(sun: THREE.DirectionalLight, mapSize: number, radius: number): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 1;
  cam.far = 700;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
}

const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
/** Centre la zone d'ombre sur un point, aligné sur les texels pour que les bords d'ombre ne scintillent pas. */
export function followSunShadow(sun: THREE.DirectionalLight, x: number, y: number, z: number): void {
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  lightRight.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  lightUp.crossVectors(SUN_DIR, lightRight).normalize();
  const p = new THREE.Vector3(x, y, z);
  const r = Math.round(p.dot(lightRight) / texel) * texel - p.dot(lightRight);
  const u = Math.round(p.dot(lightUp) / texel) * texel - p.dot(lightUp);
  p.addScaledVector(lightRight, r).addScaledVector(lightUp, u);
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 300);
  sun.target.updateMatrixWorld();
}

function decorate(scene: THREE.Scene, world: World): void {
  const { minX, maxX, minZ, maxZ } = world.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 60;
  const groundY = world.groundY;

  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Pas de décor sur une case occupée (ni juste à côté)
  const nearTrack = (x: number, z: number, margin: number) => {
    const r = Math.ceil(margin / TILE);
    const gx = Math.round(x / TILE);
    const gz = Math.round(z / TILE);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (world.cells.has(`${gx + i},${gz + j}`)) return true;
    return false;
  };

  scene.add(buildGround(groundY));

  // Collines low-poly autour du circuit
  const hillMats = [0x6cb043, 0x86c95a, 0x5d9e3a].map(
    (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
  );
  for (let k = 0; k < 46; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.9 + rnd() * 1.8);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const r = 40 + rnd() * 90;
    if (nearTrack(x, z, r * 0.6 + 30)) continue;
    const geo = new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const h = new THREE.Mesh(geo, hillMats[k % 3]!);
    h.scale.y = 0.35 + rnd() * 0.5;
    h.position.set(x, groundY - 2, z);
    h.rotation.y = rnd() * 6;
    h.receiveShadow = true;
    scene.add(h);
  }

  // Arbres en cônes près du sol
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a3a, flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8a3a, flatShading: true });
  const leafGeo = new THREE.ConeGeometry(4, 10, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.7, 0.9, 3, 5);
  for (let k = 0; k < 260; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.1 + rnd() * 1.4);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (nearTrack(x, z, 14)) continue;
    const s = 0.8 + rnd() * 0.9;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    trunk.position.y = 1.5;
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.castShadow = leaves.receiveShadow = true;
    leaves.position.y = 7.5;
    t.add(trunk, leaves);
    t.scale.setScalar(s);
    t.position.set(x, groundY, z);
    scene.add(t);
  }

  // Nuages blancs en hauteur
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x9aa8b4 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  const puffs = 5;
  const count = 34;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, count * puffs);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (let k = 0; k < count; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.3 + rnd() * 2.2);
    const bx = cx + Math.cos(a) * d;
    const bz = cz + Math.sin(a) * d;
    const by = world.bounds.maxY + 80 + rnd() * 90;
    const base = 10 + rnd() * 14;
    for (let p = 0; p < puffs; p++) {
      const s = base * (0.6 + rnd() * 0.6);
      m.compose(
        new THREE.Vector3(bx + (p - 2) * base * 0.8, by + rnd() * base * 0.4, bz + (rnd() - 0.5) * base),
        q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)),
        new THREE.Vector3(s, s * 0.6, s),
      );
      clouds.setMatrixAt(n++, m);
    }
  }
  scene.add(clouds);
}
