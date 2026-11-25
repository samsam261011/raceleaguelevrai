import * as THREE from "three";
import type { Track } from "../track/types";

/** Décor de jour : ciel bleu, soleil, nuages, sol vert et collines low-poly. */
export function buildEnvironment(scene: THREE.Scene, track: Track): void {
  scene.fog = new THREE.Fog(0xcfe6f5, 260, 900);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d8fe0) },
        horizon: { value: new THREE.Color(0xd8ecf8) },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h=clamp(vP.y,0.0,1.0); gl_FragColor=vec4(mix(horizon, top, pow(smoothstep(0.0,0.6,h),0.8)),1.0); }",
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);

  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x6f8f4a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
  sun.position.set(-180, 260, -120);
  scene.add(sun);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.count; i++) {
    minX = Math.min(minX, track.px[i]!);
    maxX = Math.max(maxX, track.px[i]!);
    minZ = Math.min(minZ, track.pz[i]!);
    maxZ = Math.max(maxZ, track.pz[i]!);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 80;
  // Sol sous la ligne de chute : on voit le vide sous les sauts sans pouvoir s'y poser.
  const groundY = track.minY - 34;

  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const nearTrack = (x: number, z: number, margin: number) => {
    for (let i = 0; i < track.count; i += 4) {
      const dx = track.px[i]! - x;
      const dz = track.pz[i]! - z;
      if (dx * dx + dz * dz < margin * margin) return true;
    }
    return false;
  };

  // Sol : grand disque vert légèrement vallonné (sommets déplacés au hasard)
  const groundGeo = new THREE.CircleGeometry(2200, 48, 0, Math.PI * 2);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ color: 0x7cbf4e, flatShading: true }),
  );
  ground.position.set(cx, groundY, cz);
  scene.add(ground);

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
    scene.add(h);
  }

  // Arbres en cônes près du sol
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a3a, flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8a3a, flatShading: true });
  const leafGeo = new THREE.ConeGeometry(4, 10, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.7, 0.9, 3, 5);
  for (let k = 0; k < 120; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.1 + rnd() * 1.4);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (nearTrack(x, z, 20)) continue;
    const s = 0.8 + rnd() * 0.9;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5;
    const leaves = new THREE.Mesh(leafGeo, leafMat);
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
    const by = track.minY + 90 + rnd() * 90;
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
