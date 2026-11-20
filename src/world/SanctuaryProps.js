import * as THREE from 'three';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';
import { createJaggedStalagmite } from '../utils/RockGeometry.js';
import { createLayeredFlame } from '../utils/FlameGeometry.js';
import {
  createCutStoneTexture,
  createWoodPlankTexture,
  createAsianRoofTileTexture,
  createStylizedWaterTexture,
  createGrassAndPetalsTexture,
} from '../utils/ProceduralTextures.js';
import { mulberry32 } from './Arena.js';

/**
 * SanctuaryProps
 * ----------------------------------------------------------------------
 * Fábrica arquitectónica y orgánica Cel-Shaded / Anime de alta calidad
 * para el Santuario de las Cuatro Naciones y elementos compartidos
 * (barriles torneados, techos curvos orientales, árbol espíritu,
 * puentes arqueados y faroles esculpidos). Todas las mallas aquí creadas
 * se marcan con `userData.noCollision = true` para conservar intactos
 * los colisionadores de física e IA.
 */

export function markNoCollision(obj) {
  obj.userData.noCollision = true;
  obj.traverse((c) => {
    c.userData.noCollision = true;
  });
  return obj;
}

/**
 * Geometría tubular orgánica suave con radio variable a lo largo de una curva.
 */
export function createVariableTubeGeometry(curve, radiusFn, tubularSegments = 24, radialSegments = 16) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const uvs = [];
  const indices = [];

  const P = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = Math.max(0.01, radiusFn(t));

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      vertex.x = P.x + r * (cos * N.x + sin * B.x);
      vertex.y = P.y + r * (cos * N.y + sin * B.y);
      vertex.z = P.z + r * (cos * N.z + sin * B.z);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(j / radialSegments, t * 2);
    }
  }

  const row = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Barril torneado real con `LatheGeometry` (duelas abombadas, tapa hundida,
 * textura de madera con vetas y dos zunchos metálicos remachados).
 */
export function createTurnedBarrelMesh(radius = 0.5, height = 1.15, darkVariant = false) {
  const g = new THREE.Group();
  const woodTex = createWoodPlankTexture({
    baseColor: darkVariant ? '#734523' : '#965e33',
    grainColor: '#482811',
    highlightColor: '#c2834f',
    planks: 10,
    withHoops: false,
    repeatX: 2,
    repeatY: 1,
    seed: darkVariant ? 61 : 29,
  });

  // Perfil lathe del barril con fondo cerrado, barriga suave y borde superior hundido
  const profile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(radius * 0.84, 0),
    new THREE.Vector2(radius * 0.90, height * 0.14),
    new THREE.Vector2(radius * 0.99, height * 0.34),
    new THREE.Vector2(radius * 1.03, height * 0.50),
    new THREE.Vector2(radius * 0.99, height * 0.66),
    new THREE.Vector2(radius * 0.91, height * 0.86),
    new THREE.Vector2(radius * 0.87, height),
    new THREE.Vector2(radius * 0.77, height),
    new THREE.Vector2(radius * 0.75, height - 0.06),
    new THREE.Vector2(0.001, height - 0.06),
  ];

  const latheGeo = new THREE.LatheGeometry(profile, 20);
  latheGeo.computeVertexNormals();
  const bodyMat = createToonMaterial('#ffffff', { map: woodTex, flatShading: false });
  const body = new THREE.Mesh(latheGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Dos zunchos metálicos remachados siguiendo el diámetro de cada altura
  const hoopMat = createToonMaterial('#333b47', { flatShading: false });
  const rivetMat = createToonMaterial('#8d9aa8', { flatShading: false });
  const hoopSpecs = [
    { y: height * 0.23, r: radius * 0.955 },
    { y: height * 0.77, r: radius * 0.955 },
  ];
  for (const hs of hoopSpecs) {
    const hoopGeo = new THREE.CylinderGeometry(hs.r, hs.r * 1.01, height * 0.075, 20, 1, false);
    const hoop = new THREE.Mesh(hoopGeo, hoopMat);
    hoop.position.y = hs.y;
    hoop.castShadow = true;
    g.add(hoop);

    for (let rIdx = 0; rIdx < 6; rIdx++) {
      const a = (rIdx / 6) * Math.PI * 2;
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), rivetMat);
      rivet.position.set(Math.cos(a) * (hs.r + 0.006), hs.y, Math.sin(a) * (hs.r + 0.006));
      rivet.userData.noOutline = true;
      g.add(rivet);
    }
  }

  addOutline(g, 0.018, 0x18120e);
  return g;
}

/**
 * Crea un lóbulo orgánico suavizado (sin facetas rígidas) para copas y arbustos.
 */
function createSmoothFoliageGeo(radius = 1, seed = 1, wSeg = 18, hSeg = 14) {
  const geo = new THREE.SphereGeometry(radius, wSeg, hSeg);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 3.1 + seed) * 0.07 +
      Math.cos(v.z * 3.4 - seed * 0.7) * 0.07 +
      Math.sin(v.y * 4.2 + seed * 1.3) * 0.05;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Árbol Espíritu Monumental tipo Bonsái esculpido y orgánico en el centro del Santuario.
 */
export function createSpiritTreeHero() {
  const group = new THREE.Group();
  const solidTrunkMeshes = [];
  const hangingVines = [];
  const motes = [];

  const barkTex = createWoodPlankTexture({
    baseColor: '#6b4228',
    grainColor: '#3b2111',
    highlightColor: '#8d5d3b',
    planks: 6,
    repeatX: 2,
    repeatY: 3,
    seed: 91,
  });
  const barkMat = createToonMaterial('#ffffff', { map: barkTex, flatShading: false });
  const rootMat = createToonMaterial('#d9c2ae', { map: barkTex, flatShading: false });

  // Montículo central orgánico con textura de césped y pétalos
  const grassTex = createGrassAndPetalsTexture({
    baseColor: '#48a64d',
    darkGreen: '#318038',
    lightGreen: '#75d460',
    repeatX: 2,
    repeatY: 2,
    seed: 108,
  });
  const moundMat = createToonMaterial('#ffffff', { map: grassTex, flatShading: false });
  const moundGeo = new THREE.CylinderGeometry(2.6, 4.3, 0.44, 32, 3);
  const mp = moundGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const mx = mp.getX(i);
    const mz = mp.getZ(i);
    const r = Math.hypot(mx, mz);
    if (mp.getY(i) > 0 && r < 3.6) {
      mp.setY(i, mp.getY(i) + Math.cos((r / 3.6) * Math.PI * 0.5) * 0.16);
    }
  }
  moundGeo.computeVertexNormals();
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.y = 0.78;
  mound.receiveShadow = true;
  markNoCollision(mound);
  group.add(mound);

  // Tronco principal curvado en 'S' suave (24 segmentos tubulares × 16 radiales)
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.55, 0),
    new THREE.Vector3(-0.36, 2.2, 0.28),
    new THREE.Vector3(0.45, 4.2, -0.22),
    new THREE.Vector3(0.05, 6.4, 0.1),
  ]);
  const trunkGeo = createVariableTubeGeometry(
    trunkCurve,
    (t) => 1.82 * (1 - t * 0.48) + Math.sin(t * Math.PI) * 0.14,
    24,
    16
  );
  const trunkMesh = new THREE.Mesh(trunkGeo, barkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  addOutline(trunkMesh, 0.052, 0x1d120a);
  group.add(trunkMesh);
  solidTrunkMeshes.push(trunkMesh);

  // 6 Raíces gruesas retorcidas suavizadas abrazando el montículo
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.18;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const sideX = -sin;
    const sideZ = cos;
    const rCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cos * 1.1, 1.65, sin * 1.1),
      new THREE.Vector3(cos * 2.2 + sideX * 0.36, 0.96, sin * 2.2 + sideZ * 0.36),
      new THREE.Vector3(cos * 3.5 - sideX * 0.22, 0.7, sin * 3.5 - sideZ * 0.22),
      new THREE.Vector3(cos * 4.35, 0.54, sin * 4.35),
    ]);
    const rGeo = createVariableTubeGeometry(rCurve, (t) => 0.66 * (1 - t * 0.78), 16, 12);
    const rootMesh = new THREE.Mesh(rGeo, rootMat);
    rootMesh.castShadow = true;
    rootMesh.receiveShadow = true;
    addOutline(rootMesh, 0.038, 0x1d120a);
    markNoCollision(rootMesh);
    group.add(rootMesh);
  }

  // 6 Ramas principales con sub-ramillas orgánicas y lóbulos frondosos suavizados
  const branchConfigs = [
    { startY: 4.8, angle: 0.25, len: 5.4, endY: 7.4, baseR: 0.68, padRadius: 3.4, shade: 1 },
    { startY: 5.1, angle: 1.38, len: 4.9, endY: 7.0, baseR: 0.62, padRadius: 3.1, shade: 0 },
    { startY: 5.4, angle: 2.55, len: 5.2, endY: 7.7, baseR: 0.64, padRadius: 3.2, shade: 2 },
    { startY: 4.7, angle: 3.62, len: 4.7, endY: 6.7, baseR: 0.60, padRadius: 3.0, shade: 1 },
    { startY: 5.7, angle: 4.82, len: 4.5, endY: 8.1, baseR: 0.58, padRadius: 2.9, shade: 2 },
    { startY: 6.0, angle: 5.65, len: 4.1, endY: 8.5, baseR: 0.54, padRadius: 2.7, shade: 0 },
  ];

  const leafMats = [
    createToonMaterial('#288045', { flatShading: false }),
    createToonMaterial('#44b35c', { flatShading: false }),
    createToonMaterial('#82de68', { flatShading: false }),
  ];
  const vineMat = createToonMaterial('#3d8540', { flatShading: false });
  const orbGlowMat = new THREE.MeshBasicMaterial({ color: '#e8ffe0' });

  for (let bi = 0; bi < branchConfigs.length; bi++) {
    const b = branchConfigs[bi];
    const cx = Math.cos(b.angle);
    const cz = Math.sin(b.angle);
    const midPt = new THREE.Vector3(cx * (b.len * 0.48), b.startY + 0.9, cz * (b.len * 0.48));
    const endPt = new THREE.Vector3(cx * b.len, b.endY, cz * b.len);
    const bCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx * 0.2, b.startY, cz * 0.2),
      midPt,
      endPt,
    ]);
    const bGeo = createVariableTubeGeometry(bCurve, (t) => b.baseR * (1 - t * 0.62), 16, 12);
    const bMesh = new THREE.Mesh(bGeo, barkMat);
    bMesh.castShadow = true;
    addOutline(bMesh, 0.038, 0x1d120a);
    markNoCollision(bMesh);
    group.add(bMesh);

    // Sub-rama lateral curva desde la mitad de la rama principal
    const subA = b.angle + (bi % 2 === 0 ? 0.48 : -0.48);
    const subTip = new THREE.Vector3(
      midPt.x + Math.cos(subA) * b.len * 0.45,
      b.endY - 0.25,
      midPt.z + Math.sin(subA) * b.len * 0.45
    );
    const subCurve = new THREE.CatmullRomCurve3([
      midPt.clone(),
      midPt.clone().lerp(subTip, 0.5).add(new THREE.Vector3(0, 0.35, 0)),
      subTip,
    ]);
    const subGeo = createVariableTubeGeometry(subCurve, (t) => b.baseR * 0.44 * (1 - t * 0.65), 10, 10);
    const subMesh = new THREE.Mesh(subGeo, barkMat);
    subMesh.castShadow = true;
    markNoCollision(subMesh);
    group.add(subMesh);

    // Lóbulos de follaje suavizados superpuestos (cero aristas poligonales duras)
    const tipX = endPt.x;
    const tipZ = endPt.z;
    const rng = mulberry32(700 + bi * 31);
    for (let p = 0; p < 4; p++) {
      const offA = b.angle + (p - 1.5) * 0.62;
      const offD = p === 0 ? 0 : b.padRadius * 0.52;
      const mat = leafMats[(b.shade + p) % leafMats.length];
      const puffGeo = createSmoothFoliageGeo(1, bi * 13 + p * 7, 18, 14);
      const puff = new THREE.Mesh(puffGeo, mat);
      const basePos = p === 3 ? subTip : new THREE.Vector3(
        tipX + Math.cos(offA) * offD,
        b.endY + (p === 2 ? 0.6 : -0.1 + rng() * 0.42),
        tipZ + Math.sin(offA) * offD
      );
      puff.position.copy(basePos);
      const sx = b.padRadius * (p === 0 ? 1.05 : p === 3 ? 0.65 : 0.74);
      puff.scale.set(sx, sx * 0.44, sx * 0.94);
      puff.castShadow = true;
      puff.receiveShadow = true;
      addOutline(puff, 0.036, 0x11361a);
      markNoCollision(puff);
      group.add(puff);
    }

    // Liana colgante suave con flor/farol espiritual brillante
    if (bi % 2 === 0) {
      const vinePivot = new THREE.Group();
      vinePivot.position.set(tipX * 0.82, b.endY - 0.35, tipZ * 0.82);

      const vLen = 1.65 + (bi % 3) * 0.35;
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, vLen, 10), vineMat);
      strand.position.y = -vLen / 2;

      const miniLantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), orbGlowMat);
      miniLantern.scale.set(0.9, 1.35, 0.9);
      miniLantern.position.y = -vLen - 0.14;
      addOutline(miniLantern, 0.022, 0x2d6b45);

      vinePivot.add(strand, miniLantern);
      markNoCollision(vinePivot);
      group.add(vinePivot);
      hangingVines.push({ pivot: vinePivot, phase: bi * 1.4 });
    }
  }

  // Corona central superior en 4 capas orgánicas suavizadas
  const topCrown = [
    { x: 0, y: 9.0, z: 0, sx: 4.6, sy: 1.6, sz: 4.5, mat: leafMats[0], seed: 11 },
    { x: 1.35, y: 9.8, z: -0.9, sx: 3.5, sy: 1.38, sz: 3.4, mat: leafMats[1], seed: 23 },
    { x: -1.15, y: 10.2, z: 0.9, sx: 3.1, sy: 1.28, sz: 3.0, mat: leafMats[2], seed: 37 },
    { x: 0.1, y: 11.0, z: 0.0, sx: 2.5, sy: 1.1, sz: 2.5, mat: leafMats[2], seed: 51 },
  ];
  for (const tc of topCrown) {
    const m = new THREE.Mesh(createSmoothFoliageGeo(1, tc.seed, 20, 16), tc.mat);
    m.position.set(tc.x, tc.y, tc.z);
    m.scale.set(tc.sx, tc.sy, tc.sz);
    m.castShadow = true;
    m.receiveShadow = true;
    addOutline(m, 0.036, 0x11361a);
    markNoCollision(m);
    group.add(m);
  }

  // Motas luminosas espirituales flotando alrededor del árbol
  const moteMat = new THREE.MeshBasicMaterial({ color: '#eaffb0', transparent: true, opacity: 0.88 });
  const moteGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const mrng = mulberry32(8123);
  for (let m = 0; m < 22; m++) {
    const mesh = new THREE.Mesh(moteGeo, moteMat);
    const radius = 3.2 + mrng() * 6.0;
    const baseY = 2.0 + mrng() * 6.8;
    const phase = mrng() * Math.PI * 2;
    const speed = 0.25 + mrng() * 0.35;
    mesh.position.set(Math.cos(phase) * radius, baseY, Math.sin(phase) * radius);
    markNoCollision(mesh);
    group.add(mesh);
    motes.push({ mesh, radius, baseY, phase, speed });
  }

  return { group, solidTrunkMeshes, hangingVines, motes };
}

/**
 * Poste ceremonial tradicional de la plaza central torneado y farol luminoso.
 */
export function createPlazaSpiritPost() {
  const g = new THREE.Group();
  const stoneTex = createCutStoneTexture({ baseColor: '#968b78', mortarColor: '#4c453a', cols: 2, rows: 2 });
  const stoneMat = createToonMaterial('#ffffff', { map: stoneTex, flatShading: false });
  const postMat = createToonMaterial('#df512c', { flatShading: false });
  const capMat = createToonMaterial('#382b24', { flatShading: false });
  const lanternCore = new THREE.MeshBasicMaterial({ color: '#fffde0' });
  const haloMat = new THREE.MeshBasicMaterial({
    color: '#fff4c8',
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  // Base torneada escalonada
  const plinthPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.52, 0),
    new THREE.Vector2(0.50, 0.14),
    new THREE.Vector2(0.40, 0.22),
    new THREE.Vector2(0.38, 0.38),
    new THREE.Vector2(0.01, 0.38),
  ];
  const plinth = new THREE.Mesh(new THREE.LatheGeometry(plinthPts, 16), stoneMat);
  plinth.castShadow = true;
  addOutline(plinth, 0.03, 0x1d1a16);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.29, 2.35, 18), postMat);
  post.position.y = 1.52;
  post.castShadow = true;
  addOutline(post, 0.032, 0x26120b);

  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.14, 12), capMat);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.y = 2.66;
  addOutline(crossbar, 0.024, 0x18120e);

  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), lanternCore);
  orb.position.y = 3.08;

  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), haloMat);
  halo.position.copy(orb.position);

  // Techo de farol curvo torneado con remate
  const roofPts = [
    new THREE.Vector2(0.001, 0.44),
    new THREE.Vector2(0.12, 0.36),
    new THREE.Vector2(0.18, 0.24),
    new THREE.Vector2(0.44, 0.08),
    new THREE.Vector2(0.58, 0.0),
    new THREE.Vector2(0.001, 0.0),
  ];
  const capRoof = new THREE.Mesh(new THREE.LatheGeometry(roofPts, 16), capMat);
  capRoof.position.y = 3.28;
  addOutline(capRoof, 0.025, 0x18120e);

  g.add(plinth, post, crossbar, orb, halo, capRoof);
  return { group: g, postMesh: post, orb, halo };
}

/**
 * Farol de piedra tradicional (Tōrō) esculpido con `LatheGeometry` y tejado curvo.
 */
export function createStonePathLantern(glowColor = '#ffe999') {
  const g = new THREE.Group();
  const stoneTex = createCutStoneTexture({ baseColor: '#aba08e', mortarColor: '#5c5448', cols: 2, rows: 2 });
  const stoneMat = createToonMaterial('#ffffff', { map: stoneTex, flatShading: false });
  const darkStone = createToonMaterial('#766d5e', { flatShading: false });
  const lightMat = new THREE.MeshBasicMaterial({ color: glowColor });

  // Pedestal y fuste continuos mediante LatheGeometry suavizado (16 segmentos)
  const bodyPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.48, 0),
    new THREE.Vector2(0.44, 0.18),
    new THREE.Vector2(0.28, 0.30),
    new THREE.Vector2(0.21, 0.44),
    new THREE.Vector2(0.16, 1.24),
    new THREE.Vector2(0.34, 1.38),
    new THREE.Vector2(0.40, 1.48),
    new THREE.Vector2(0.01, 1.48),
  ];
  const pillarMesh = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 16), stoneMat);
  pillarMesh.castShadow = true;
  pillarMesh.receiveShadow = true;
  addOutline(pillarMesh, 0.024, 0x201d18);

  const firebox = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 12), lightMat);
  firebox.position.y = 1.67;

  // 4 columnillas finas enmarcando la cámara de luz
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.4, 8), darkStone);
    bar.position.set(Math.cos(a) * 0.25, 1.67, Math.sin(a) * 0.25);
    g.add(bar);
  }

  // Capitel curvo japonés + brote de loto (*hoju*) en torno suave
  const capPts = [
    new THREE.Vector2(0.001, 0.56),
    new THREE.Vector2(0.09, 0.50),
    new THREE.Vector2(0.06, 0.40),
    new THREE.Vector2(0.20, 0.28),
    new THREE.Vector2(0.46, 0.10),
    new THREE.Vector2(0.62, 0.0),
    new THREE.Vector2(0.001, 0.0),
  ];
  const roof = new THREE.Mesh(new THREE.LatheGeometry(capPts, 16), darkStone);
  roof.position.y = 1.85;
  roof.castShadow = true;
  addOutline(roof, 0.026, 0x201d18);

  g.add(pillarMesh, firebox, roof);
  return markNoCollision(g);
}

/** Arbusto estilizado orgánico suave con lóbulos Cel-Shaded */
export function createStylizedBush(scale = 1, seed = 1, tone = 'earth') {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const palettes = {
    earth: ['#3c7a38', '#569c46', '#7bc257'],
    water: ['#2e7f6b', '#41a384', '#6ec79e'],
    air: ['#4e9649', '#6ab855', '#93d668'],
  };
  const cols = palettes[tone] || palettes.earth;
  const mats = cols.map((c) => createToonMaterial(c, { flatShading: false }));

  const count = 4;
  for (let i = 0; i < count; i++) {
    const r = (i === 0 ? 0.62 : 0.44 + rng() * 0.2) * scale;
    const geo = createSmoothFoliageGeo(r, seed + i * 17, 16, 12);
    const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
    const a = (i / 3) * Math.PI * 2 + rng() * 0.4;
    const dist = i === 0 ? 0 : 0.48 * scale;
    mesh.position.set(Math.cos(a) * dist, r * 0.72, Math.sin(a) * dist);
    mesh.scale.set(1.1, 0.84, 1.05);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addOutline(mesh, 0.026 * scale, 0x152b15);
    g.add(mesh);
  }
  return markNoCollision(g);
}

/** Matas de juncos / pasto alto para orillas de agua y jardines */
export function createReedCluster(seed = 1, hasCattails = true) {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const bladeMat = createToonMaterial('#509e48', { flatShading: false });
  const tipMat = createToonMaterial('#7ac454', { flatShading: false });
  const stalkMat = createToonMaterial('#6b4423', { flatShading: false });

  for (let i = 0; i < 6; i++) {
    const h = 0.75 + rng() * 0.55;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.075, h, 8), i % 2 === 0 ? bladeMat : tipMat);
    const a = rng() * Math.PI * 2;
    const dist = rng() * 0.35;
    blade.position.set(Math.cos(a) * dist, h * 0.46, Math.sin(a) * dist);
    blade.rotation.set((rng() - 0.5) * 0.36, rng() * Math.PI, (rng() - 0.5) * 0.36);
    g.add(blade);
  }
  if (hasCattails) {
    for (let k = 0; k < 2; k++) {
      const h = 1.15 + rng() * 0.35;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, h, 8), bladeMat);
      stem.position.set((k - 0.5) * 0.25, h * 0.5, (rng() - 0.5) * 0.2);
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.16, 4, 10), stalkMat);
      head.position.set(stem.position.x, h * 0.88, stem.position.z);
      g.add(stem, head);
    }
  }
  return markNoCollision(g);
}

/** Rocas redondeadas de jardín suavizadas y vasijas de barro torneadas */
export function createWallPropsCluster(seed = 1) {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const clayMat = createToonMaterial('#b3643b', { flatShading: false });
  const rockTex = createCutStoneTexture({ baseColor: '#8d8678', mortarColor: '#5c564c', cols: 2, rows: 2 });
  const rockMat = createToonMaterial('#ffffff', { map: rockTex, flatShading: false });
  const woodTex = createWoodPlankTexture({ baseColor: '#845733', planks: 4 });
  const woodMat = createToonMaterial('#ffffff', { map: woodTex, flatShading: false });

  const pts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.24, 0.05),
    new THREE.Vector2(0.36, 0.34),
    new THREE.Vector2(0.22, 0.62),
    new THREE.Vector2(0.28, 0.72),
    new THREE.Vector2(0.19, 0.72),
  ];
  const jar = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), clayMat);
  jar.castShadow = true;
  addOutline(jar, 0.024, 0x26150d);
  g.add(jar);

  // Rocas de jardín redondeadas y suavizadas
  for (let i = 0; i < 2; i++) {
    const r = 0.28 + rng() * 0.16;
    const stone = new THREE.Mesh(createSmoothFoliageGeo(r, seed + i * 19, 14, 10), rockMat);
    stone.position.set(0.45 + i * 0.34, r * 0.5, (rng() - 0.5) * 0.38);
    stone.scale.set(1.25, 0.72, 1.04);
    stone.rotation.y = rng() * Math.PI;
    addOutline(stone, 0.022, 0x22201d);
    g.add(stone);
  }

  if (rng() > 0.35) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.56, 0.62), woodMat);
    crate.position.set(-0.62, 0.28, 0.1);
    crate.rotation.y = 0.25;
    crate.castShadow = true;
    addOutline(crate, 0.024, 0x1e130b);
    g.add(crate);
  }
  return markNoCollision(g);
}

/**
 * Construye una geometría de techo pagoda cóncavo real (`BufferGeometry` paramétrica)
 * con faldones curvos hacia adentro y puntas de alero levantadas (*sori*) en las 4 esquinas.
 */
function createSweptPagodaRoofGeometry(width, depth, roofHeight, gridN = 12) {
  const halfW = width * 0.62;
  const halfD = depth * 0.62;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let iz = 0; iz <= gridN; iz++) {
    const vz = iz / gridN;
    const nz = vz * 2 - 1; // -1..1
    for (let ix = 0; ix <= gridN; ix++) {
      const ux = ix / gridN;
      const nx = ux * 2 - 1; // -1..1

      const ax = Math.abs(nx);
      const az = Math.abs(nz);
      const u = Math.max(ax, az);
      const cornerFactor = ax * az;

      // Abocinamiento suave en las esquinas levantadas
      const flare = 1 + 0.085 * u * u * (0.4 + cornerFactor * 0.6);
      const x = nx * halfW * flare;
      const z = nz * halfD * flare;

      // Caída cóncava elegante desde la cumbrera hasta el alero + levantamiento en esquinas
      const slope = Math.pow(Math.max(0, 1 - u), 1.38) * roofHeight;
      const eaveCurl = Math.pow(u, 2.3) * (0.14 + 0.38 * cornerFactor) * roofHeight;
      const y = slope + eaveCurl;

      positions.push(x, y, z);
      uvs.push(ux, vz);
    }
  }

  const row = gridN + 1;
  for (let iz = 0; iz < gridN; iz++) {
    for (let ix = 0; ix < gridN; ix++) {
      const a = iz * row + ix;
      const b = iz * row + ix + 1;
      const c = (iz + 1) * row + ix;
      const d = (iz + 1) * row + ix + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Techo curvo oriental real con tejas esmaltadas, limatesas curvas en las 4 diagonales,
 * puntas levantadas ornamentales y caballete con remates dorados.
 */
export function createCurvedEastRoof(width, depth, roofHeight, mainColor, trimColor, outlineColor = 0x151a22) {
  const g = new THREE.Group();
  const tileTex = createAsianRoofTileTexture({
    baseColor: mainColor,
    ridgeColor: '#ffffff',
    shadeColor: '#141c26',
    repeatX: 4,
    repeatY: 3,
    seed: Math.round(width * 17 + depth * 11),
  });

  const mainMat = createToonMaterial('#ffffff', {
    map: tileTex,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const trimMat = createToonMaterial(trimColor, { flatShading: false });
  const underBeamMat = createToonMaterial('#472c1b', { flatShading: false });

  const roofGeo = createSweptPagodaRoofGeometry(width, depth, roofHeight, 12);
  const roofMesh = new THREE.Mesh(roofGeo, mainMat);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  addOutline(roofMesh, 0.036, outlineColor);
  g.add(roofMesh);

  // Canecillos / base de madera bajo el alero
  const eaveBox = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.16, depth * 0.94), underBeamMat);
  eaveBox.position.y = 0.04;
  g.add(eaveBox);

  // 4 Limatesas curvas doradas (*hip ridges*) siguiendo la curvatura de cada esquina
  const halfW = width * 0.62;
  const halfD = depth * 0.62;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pts = [];
      for (let s = 0; s <= 5; s++) {
        const u = s / 5;
        const flare = 1 + 0.085 * u * u;
        const y =
          Math.pow(1 - u, 1.38) * roofHeight + Math.pow(u, 2.3) * 0.52 * roofHeight + 0.07;
        pts.push(new THREE.Vector3(sx * halfW * u * flare, y, sz * halfD * u * flare));
      }
      const ribGeo = createVariableTubeGeometry(
        new THREE.CatmullRomCurve3(pts),
        (t) => 0.11 + t * 0.04,
        12,
        8
      );
      const rib = new THREE.Mesh(ribGeo, trimMat);
      addOutline(rib, 0.022, outlineColor);
      g.add(rib);

      // Punta ornamental levantada (*sori finial*) en el extremo de cada esquina
      const tip = pts[pts.length - 1];
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.62, 10), trimMat);
      horn.position.set(tip.x * 1.04, tip.y + 0.2, tip.z * 1.04);
      horn.rotation.z = -sx * 0.65;
      horn.rotation.x = sz * 0.65;
      addOutline(horn, 0.022, outlineColor);
      g.add(horn);
    }
  }

  // Caballete superior curvo con remate central dorado
  const ridgeSpan = Math.min(width, depth) * 0.24;
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, Math.max(0.8, ridgeSpan), 12), trimMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = roofHeight + 0.1;
  addOutline(ridge, 0.025, outlineColor);
  g.add(ridge);

  const finialBall = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), trimMat);
  finialBall.position.y = roofHeight + 0.34;
  addOutline(finialBall, 0.024, outlineColor);
  g.add(finialBall);

  return markNoCollision(g);
}

/**
 * Embellece los edificios bajos del Distrito Tierra con zócalo de piedra labrada,
 * pilastras cilíndricas/biseladas, puertas de madera con vetas y ventanas.
 */
export function createEarthBuildingDetail(b) {
  const g = new THREE.Group();
  const stoneTex = createCutStoneTexture({ baseColor: '#917d57', mortarColor: '#4a3d27', cols: 3, rows: 3 });
  const darkTex = createCutStoneTexture({ baseColor: '#665b48', mortarColor: '#362e22', cols: 3, rows: 2 });
  const woodTex = createWoodPlankTexture({ baseColor: '#734828', grainColor: '#3d220e', planks: 5 });

  const darkStone = createToonMaterial('#ffffff', { map: darkTex, flatShading: false });
  const trimStone = createToonMaterial('#ffffff', { map: stoneTex, flatShading: false });
  const oliveStone = createToonMaterial('#5c703d', { flatShading: false });
  const woodMat = createToonMaterial('#ffffff', { map: woodTex, flatShading: false });
  const windowMat = createToonMaterial('#352d26', { flatShading: false });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.32, 0.48, b.d + 0.32), darkStone);
  plinth.position.set(b.cx, 0.24, b.cz);
  addOutline(plinth, 0.03, 0x1a1c22);
  g.add(plinth);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, b.h + 0.12, 12), trimStone);
      pil.position.set(b.cx + sx * (b.w * 0.5 - 0.16), b.h * 0.5, b.cz + sz * (b.d * 0.5 - 0.16));
      pil.castShadow = true;
      addOutline(pil, 0.028, 0x1b1e24);
      g.add(pil);
    }
  }

  const doorSideZ = 1;
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.88, 0.24), darkStone);
  doorFrame.position.set(b.cx, 0.94, b.cz + doorSideZ * (b.d * 0.5 + 0.04));
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.64, 0.28), woodMat);
  doorLeaf.position.set(b.cx, 0.82, b.cz + doorSideZ * (b.d * 0.5 + 0.06));
  addOutline(doorFrame, 0.025, 0x1b1610);
  g.add(doorFrame, doorLeaf);

  const rampAxis = b.ramp.axis;
  const rampDirSign = Math.sign(b.ramp.offsetX || b.ramp.offsetZ);
  const faces = [
    { name: 'px', axis: 'x', sign: 1 },
    { name: 'nx', axis: 'x', sign: -1 },
    { name: 'nz', axis: 'z', sign: -1 },
  ];
  for (const f of faces) {
    if (f.axis === rampAxis && f.sign === rampDirSign) continue;
    for (const off of [-1.45, 1.45]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.88, 0.18), trimStone);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.64, 0.22), windowMat);
      if (f.axis === 'x') {
        frame.rotation.y = Math.PI / 2;
        pane.rotation.y = Math.PI / 2;
        frame.position.set(b.cx + f.sign * (b.w * 0.5 + 0.03), b.h * 0.56, b.cz + off);
        pane.position.set(b.cx + f.sign * (b.w * 0.5 + 0.04), b.h * 0.56, b.cz + off);
      } else {
        frame.position.set(b.cx + off, b.h * 0.56, b.cz + f.sign * (b.d * 0.5 + 0.03));
        pane.position.set(b.cx + off, b.h * 0.56, b.cz + f.sign * (b.d * 0.5 + 0.04));
      }
      g.add(frame, pane);
    }
  }

  const addCrenelRow = (count, isAlongX, fixedSign) => {
    const span = isAlongX ? b.w - 1.4 : b.d - 1.4;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : -0.5 + i / (count - 1);
      const posAlong = t * span;
      if (isAlongX && rampAxis === 'z' && fixedSign === rampDirSign && Math.abs(posAlong) < 2.2) continue;
      if (!isAlongX && rampAxis === 'x' && fixedSign === rampDirSign && Math.abs(posAlong) < 2.2) continue;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.34), oliveStone);
      if (!isAlongX) merlon.rotation.y = Math.PI / 2;
      merlon.position.set(
        isAlongX ? b.cx + posAlong : b.cx + fixedSign * (b.w * 0.5 + 0.05),
        b.h + 0.21,
        isAlongX ? b.cz + fixedSign * (b.d * 0.5 + 0.05) : b.cz + posAlong
      );
      addOutline(merlon, 0.025, 0x1b2016);
      g.add(merlon);
    }
  };
  addCrenelRow(4, true, 1);
  addCrenelRow(4, true, -1);
  addCrenelRow(3, false, 1);
  addCrenelRow(3, false, -1);

  return markNoCollision(g);
}

/**
 * Pirámide monumental escalonada tipo Zigurat para el horizonte Norte con textura de piedra.
 */
export function createZigguratPyramid(baseRadius, height, col, stepCol, capCol) {
  const g = new THREE.Group();
  const stoneTex = createCutStoneTexture({
    baseColor: col,
    mortarColor: '#69522d',
    cols: 6,
    rows: 2,
    repeatX: 3,
    repeatY: 1,
  });
  const bodyMat = createToonMaterial('#ffffff', { map: stoneTex, flatShading: false });
  const stepMat = createToonMaterial(stepCol, { flatShading: false });
  const capMat = createToonMaterial(capCol, { flatShading: false });

  const tiers = 5;
  const totalBaseW = baseRadius * 1.45;
  for (let i = 0; i < tiers; i++) {
    const frac = i / tiers;
    const w = totalBaseW * (1 - frac * 0.72);
    const tierH = (height * 0.84) / tiers;
    const y = i * tierH + tierH * 0.5;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, tierH, w), i % 2 === 0 ? bodyMat : stepMat);
    block.position.y = y;
    addOutline(block, 0.14, 0x3b2d18);
    g.add(block);
  }

  const rampLen = height * 0.92;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(totalBaseW * 0.18, rampLen, 2.2), stepMat);
  ramp.position.set(0, height * 0.4, totalBaseW * 0.33);
  ramp.rotation.x = -0.62;
  addOutline(ramp, 0.11, 0x3b2d18);
  g.add(ramp);

  const topY = height * 0.84;
  const shrine = new THREE.Mesh(new THREE.BoxGeometry(totalBaseW * 0.2, height * 0.11, totalBaseW * 0.2), stepMat);
  shrine.position.y = topY + height * 0.055;
  addOutline(shrine, 0.11, 0x3b2d18);

  const cap = createCurvedEastRoof(totalBaseW * 0.24, totalBaseW * 0.24, height * 0.15, capCol, '#ffeaa0', 0x3b2d18);
  cap.position.y = topY + height * 0.11;
  g.add(shrine, cap);

  return markNoCollision(g);
}

/**
 * Volcán rocoso Cel-Shaded con crestas de basalto, cráter incandescente y humo redondeado.
 */
export function createVolcanoMountain(rBase, rTop, height, seed = 1) {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const volcMat = createToonMaterial('#473b3a', { flatShading: true });
  const ridgeMat = createToonMaterial('#5c4d4b', { flatShading: true });
  const lavaMat = new THREE.MeshBasicMaterial({ color: '#ff5d1a' });
  const lavaCoreMat = new THREE.MeshBasicMaterial({ color: '#ffe052' });
  const smokeMat = createToonMaterial('#c2c8d1', { transparent: true, opacity: 0.72, flatShading: false });

  const mainGeo = new THREE.CylinderGeometry(rTop, rBase, height, 18, 6);
  const pos = mainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const hNorm = (y + height * 0.5) / height;
    const ridge = Math.sin(ang * 5 + seed) * 0.14 + Math.cos(ang * 3 + hNorm * 4) * 0.09;
    const scale = 1 + ridge * (1 - hNorm * 0.4);
    pos.setX(i, x * scale);
    pos.setZ(i, z * scale);
  }
  mainGeo.computeVertexNormals();

  const cone = new THREE.Mesh(mainGeo, volcMat);
  cone.position.y = height * 0.5 - 2;
  addOutline(cone, 0.2, 0x1a1414);
  g.add(cone);

  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng() * 0.4;
    const buttressGeo = createJaggedStalagmite(height * (0.45 + rng() * 0.2), rBase * 0.28, seed + k * 19);
    const buttress = new THREE.Mesh(buttressGeo, ridgeMat);
    buttress.position.set(Math.cos(a) * rBase * 0.62, -2, Math.sin(a) * rBase * 0.62);
    addOutline(buttress, 0.15, 0x1a1414);
    g.add(buttress);
  }

  const crater = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 0.88, rTop * 0.75, 0.6, 16), lavaMat);
  crater.position.y = height - 2.05;
  const craterCore = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 0.5, rTop * 0.5, 0.68, 16), lavaCoreMat);
  craterCore.position.y = height - 2.0;
  g.add(crater, craterCore);

  const slopeAngle = Math.atan2(rBase - rTop, height);
  const streakLen = Math.hypot(rBase - rTop, height) * 0.86;
  const midR = (rTop + rBase) * 0.51;
  for (let k = -1; k <= 1; k++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, height * 0.5 - 2, 0);
    pivot.rotation.y = -Math.PI / 2 + k * 0.34;
    const streak = new THREE.Mesh(
      new THREE.CylinderGeometry(k === 0 ? 0.8 : 0.55, k === 0 ? 1.1 : 0.75, streakLen, 8),
      k === 0 ? lavaCoreMat : lavaMat
    );
    streak.position.set(0, 0, midR);
    streak.rotation.x = -slopeAngle;
    pivot.add(streak);
    g.add(pivot);
  }

  const smokePuffs = [];
  for (let p = 0; p < 5; p++) {
    const puff = new THREE.Mesh(createSmoothFoliageGeo(2.8 + p * 0.55, seed + p * 11, 14, 10), smokeMat);
    puff.position.set(0, height + 1 + p * 4.0, 0);
    g.add(puff);
    smokePuffs.push({ mesh: puff, phase: p * 1.25 + seed * 0.07, baseY: height + 0.5 });
  }

  return { group: markNoCollision(g), smokePuffs };
}

/**
 * Pebetero de hierro ornamental torneado con `LatheGeometry` y llama animada.
 */
export function createOrnamentalBrazier(seed = 1) {
  const g = new THREE.Group();
  const ironMat = createToonMaterial('#352e2d', { flatShading: false });
  const goldTrim = createToonMaterial('#dba038', { flatShading: false });

  const pts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.58, 0),
    new THREE.Vector2(0.52, 0.14),
    new THREE.Vector2(0.28, 0.24),
    new THREE.Vector2(0.26, 0.42),
    new THREE.Vector2(0.64, 0.68),
    new THREE.Vector2(0.68, 0.88),
    new THREE.Vector2(0.54, 0.88),
    new THREE.Vector2(0.46, 0.66),
    new THREE.Vector2(0.01, 0.66),
  ];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), ironMat);
  bowl.castShadow = true;
  bowl.receiveShadow = true;
  addOutline(bowl, 0.032, 0x151210);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.07, 10, 20), goldTrim);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.88;

  const flame = createLayeredFlame(0.48, 1.45, seed, 0.16, 0.02);
  flame.group.position.y = 0.84;

  g.add(bowl, rim, flame.group);
  return { group: g, flame };
}

/**
 * Isla aérea rocosa fracturada con estalactitas debajo, césped suavizado, templo con techo curvo y cascada.
 */
export function createSkyTempleIsland(r, h, hasTemple, seed = 1) {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const rockMat = createToonMaterial('#828d96', { flatShading: true });
  const rockDarkMat = createToonMaterial('#636d75', { flatShading: true });
  const grassTex = createGrassAndPetalsTexture({ baseColor: '#55b856', darkGreen: '#388a3e', lightGreen: '#80e068' });
  const grassMat = createToonMaterial('#ffffff', { map: grassTex, flatShading: false });
  const mistMat = createToonMaterial('#d9f6ff', { transparent: true, opacity: 0.72, flatShading: false });

  const mainGeo = createJaggedStalagmite(h, r * 0.98, seed);
  const mainRock = new THREE.Mesh(mainGeo, rockMat);
  mainRock.rotation.x = Math.PI;
  addOutline(mainRock, 0.09, 0x1b2128);
  g.add(mainRock);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng() * 0.5;
    const subGeo = createJaggedStalagmite(h * (0.48 + rng() * 0.22), r * 0.32, seed + i * 29);
    const sub = new THREE.Mesh(subGeo, rockDarkMat);
    sub.rotation.x = Math.PI;
    sub.position.set(Math.cos(a) * r * 0.55, -0.35, Math.sin(a) * r * 0.55);
    addOutline(sub, 0.07, 0x1b2128);
    g.add(sub);
  }

  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 0.94, 1.05, 22), grassMat);
  topCap.position.y = 0.42;
  addOutline(topCap, 0.07, 0x17351a);
  g.add(topCap);

  if (hasTemple) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.46, 2.1, 16), createToonMaterial('#f5ebd2'));
    body.position.y = 1.95;
    addOutline(body, 0.055, 0x26221b);
    const roof = createCurvedEastRoof(r * 0.92, r * 0.92, 2.2, '#47b2ad', '#ecc149', 0x133333);
    roof.position.y = 3.0;
    g.add(body, roof);

    const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, h * 0.85, 10), mistMat);
    fall.position.set(0, -h * 0.36, -r * 0.92);
    g.add(fall);
  } else {
    const bush = createStylizedBush(1.4, seed + 5, 'air');
    bush.position.y = 0.95;
    g.add(bush);
  }

  return markNoCollision(g);
}

/**
 * Crea la geometría visual de puente arqueado suavemente con postes torneados (`LatheGeometry`),
 * barandillas y faroles azules brillantes sin interferir con los colisionadores planos de física.
 */
export function createBridgeDecor(deckW, deckD, height, axis) {
  const g = new THREE.Group();
  const stoneTex = createCutStoneTexture({
    baseColor: '#98a7b8',
    mortarColor: '#48586b',
    cols: 3,
    rows: 2,
    repeatX: 2,
    repeatY: 1,
  });
  const stoneMat = createToonMaterial('#ffffff', { map: stoneTex, flatShading: false });
  const darkStone = createToonMaterial('#5c6c7d', { flatShading: false });
  const glowBlue = new THREE.MeshBasicMaterial({ color: '#94ecff' });

  const span = axis === 'z' ? deckD : deckW;
  const cross = axis === 'z' ? deckW : deckD;

  // Arco parabólico tallado bajo el tablero del puente
  const archShape = new THREE.Shape();
  const halfSpan = span * 0.5;
  archShape.moveTo(-halfSpan, 0);
  archShape.lineTo(-halfSpan, height + 0.02);
  archShape.lineTo(halfSpan, height + 0.02);
  archShape.lineTo(halfSpan, 0);
  archShape.lineTo(halfSpan * 0.72, 0);
  archShape.quadraticCurveTo(0, height * 0.86, -halfSpan * 0.72, 0);
  archShape.closePath();

  const archGeo = new THREE.ExtrudeGeometry(archShape, {
    depth: cross - 0.16,
    bevelEnabled: false,
    curveSegments: 14,
  });
  archGeo.translate(0, 0, -(cross - 0.16) * 0.5);
  if (axis === 'z') archGeo.rotateY(Math.PI * 0.5);
  const archMesh = new THREE.Mesh(archGeo, stoneMat);
  archMesh.receiveShadow = true;
  addOutline(archMesh, 0.022, 0x1b2530);
  g.add(archMesh);

  // Balaustrada lateral con pasamanos + postes intermedios torneados (`LatheGeometry`)
  const balusterPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.11, 0),
    new THREE.Vector2(0.09, 0.08),
    new THREE.Vector2(0.055, 0.16),
    new THREE.Vector2(0.085, 0.24),
    new THREE.Vector2(0.055, 0.34),
    new THREE.Vector2(0.095, 0.42),
    new THREE.Vector2(0.01, 0.42),
  ];
  const balusterGeo = new THREE.LatheGeometry(balusterPts, 14);
  const postPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.22, 0),
    new THREE.Vector2(0.19, 0.15),
    new THREE.Vector2(0.16, 0.78),
    new THREE.Vector2(0.22, 0.90),
    new THREE.Vector2(0.12, 0.96),
    new THREE.Vector2(0.01, 0.96),
  ];
  const postGeo = new THREE.LatheGeometry(postPts, 16);

  const halfCross = cross * 0.5 - 0.16;
  const balusterCount = 5;
  for (const side of [-1, 1]) {
    const railGeo =
      axis === 'z'
        ? new THREE.CylinderGeometry(0.11, 0.11, span - 0.5, 12)
        : new THREE.CylinderGeometry(0.11, 0.11, span - 0.5, 12);
    if (axis === 'z') railGeo.rotateX(Math.PI * 0.5);
    else railGeo.rotateZ(Math.PI * 0.5);
    const rail = new THREE.Mesh(railGeo, stoneMat);
    rail.position.set(axis === 'z' ? side * halfCross : 0, height + 0.44, axis === 'z' ? 0 : side * halfCross);
    rail.castShadow = true;
    addOutline(rail, 0.022, 0x1b2530);
    g.add(rail);

    // Balaustres torneados a lo largo de la barandilla
    for (let b = 0; b < balusterCount; b++) {
      const t = (b / (balusterCount - 1) - 0.5) * (span - 2.2);
      const bx = axis === 'z' ? side * halfCross : t;
      const bz = axis === 'z' ? t : side * halfCross;
      const bal = new THREE.Mesh(balusterGeo, darkStone);
      bal.position.set(bx, height, bz);
      g.add(bal);
    }

    // 2 postes esquineros torneados con farol azul brillante
    for (const endSign of [-1, 1]) {
      const ex = axis === 'z' ? side * halfCross : endSign * (span * 0.5 - 0.4);
      const ez = axis === 'z' ? endSign * (span * 0.5 - 0.4) : side * halfCross;
      const post = new THREE.Mesh(postGeo, darkStone);
      post.position.set(ex, height, ez);
      addOutline(post, 0.024, 0x151e28);

      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), glowBlue);
      orb.position.set(ex, height + 1.12, ez);
      g.add(post, orb);
    }
  }

  return markNoCollision(g);
}

/** Mantiene exportación heredada por compatibilidad */
export function createDistantMountainRing(radius = 138, count = 24) {
  const g = new THREE.Group();
  const rng = mulberry32(5501);
  const mountainMat = new THREE.MeshToonMaterial({ color: '#7ea4ba' });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const h = 22 + rng() * 26;
    const r = 18 + rng() * 14;
    const mGeo = new THREE.ConeGeometry(r, h, 14);
    const mesh = new THREE.Mesh(mGeo, mountainMat);
    const dist = radius + rng() * 26;
    mesh.position.set(Math.cos(a) * dist, h * 0.45 - 3, Math.sin(a) * dist);
    g.add(mesh);
  }
  return markNoCollision(g);
}

/** Exportación delegada a `ProceduralTextures.createStylizedWaterTexture` */
export function createWaterSurfaceTexture() {
  return createStylizedWaterTexture();
}
