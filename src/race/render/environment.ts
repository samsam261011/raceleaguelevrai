import * as THREE from "three";
import type { Track } from "../track/types";

/** Ciel du coucher de soleil, lumières, brouillard, rochers flottants et mer de nuages. */
export function buildEnvironment(scene: THREE.Scene, track: Track): void {
  scene.fog = new THREE.Fog(0x7a4560, 120, 520);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x1c1438) },
        mid: { value: new THREE.Color(0x8a3d6a) },
        low: { value: new THREE.Color(0xf08a3c) },
      },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.05 ? mix(mid, top, smoothstep(0.05,0.55,h)) : mix(low, mid, smoothstep(-0.2,0.05,h)); gl_FragColor=vec4(c,1.0); }",
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
  // Le ciel suit la caméra
  sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);

  scene.add(new THREE.HemisphereLight(0xffd6b0, 0x3a2050, 0.9));
  const sun = new THREE.DirectionalLight(0xffb070, 1.6);
  sun.position.set(-200, 160, -120);
  scene.add(sun);

  // Centre et taille de la map
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

  // Générateur pseudo-aléatoire fixe : le décor est le même à chaque partie.
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

  const rockSide = new THREE.MeshLambertMaterial({ color: 0x9a5a48, flatShading: true });
  const rockTop = new THREE.MeshLambertMaterial({ color: 0xd98a5a, flatShading: true });
  const grass = new THREE.MeshLambertMaterial({ color: 0x7f9a4a, flatShading: true });
  for (let k = 0; k < 70; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.2 + rnd() * 1.3);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const r = 4 + rnd() * 16;
    if (nearTrack(x, z, r + 18)) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.4, 6), rockSide);
    body.rotation.x = Math.PI;
    body.position.y = -r * 1.2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, r * 0.4, 6), rnd() > 0.5 ? rockTop : grass);
    g.add(body, top);
    g.position.set(x, -30 + rnd() * 50, z);
    g.rotation.y = rnd() * 6;
    scene.add(g);
  }

  // Mer de nuages sous la piste
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xf6c6c0, flatShading: true, transparent: true, opacity: 0.75 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 140);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let k = 0; k < 140; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * radius * 2.2;
    const s = 18 + rnd() * 40;
    m.compose(
      new THREE.Vector3(cx + Math.cos(a) * d, track.minY - 95 - rnd() * 30, cz + Math.sin(a) * d),
      q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)),
      new THREE.Vector3(s, s * 0.35, s),
    );
    clouds.setMatrixAt(k, m);
  }
  scene.add(clouds);
}
