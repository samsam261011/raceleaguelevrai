import * as THREE from "three";
import type { World } from "../world/world";
import { decorate } from "./canyon";

export { buildGround } from "./canyon";

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
  groundLight: 0xd29a62,
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

