import * as THREE from 'three';
import { createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * ShadowGeometry
 * ----------------------------------------------------------------------
 * Constructores geométricos procedurales para el 9.º Maestro Elemental:
 * Control de Sombra (`'shadow'`).
 *  - Oscuridad líquida y energía umbría (Lanza Umbría, Portales de Paso
 *    Sombrío, Zarcillos Drenavida, Domo de Velo de Eclipse y guadañas del
 *    Aura Segador Nocturno): `createEnergyVFXMaterial` con gradiente Fresnel,
 *    `softEdge`, `fadeEnds` / `fadeEndsY` y núcleos `AdditiveBlending`
 *    carmesí/violeta SIN contorno negro de tinta (`noOutline = true`).
 */

export const SHADOW_PALETTE = {
  obsidian: '#09090b',
  midnightIndigo: '#1e1b4b',
  abyssViolet: '#6d28d9',
  crimsonNeon: '#f43f5e',
  softViolet: '#a78bfa',
  rivalCharcoal: '#18181b',
  rivalPurple: '#3b0764',
  rivalMagenta: '#e11d48',
};

/**
 * Geometría tubular orgánica con radio decreciente entre extremos (`t -> radius`),
 * ideal para zarcillos umbríos y cintas de humo sombrío sin vértices duros.
 */
export function createTaperingShadowTube(curve, tubularSegments = 24, rStart = 0.08, rEnd = 0.01, radialSegments = 10) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const uvs = [];
  const indices = [];
  const P = new THREE.Vector3();
  const v = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const radius = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.85));

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = -Math.cos(theta);
      v.copy(P)
        .addScaledVector(N, radius * cos)
        .addScaledVector(B, radius * sin);
      positions.push(v.x, v.y, v.z);
      uvs.push(t, j / radialSegments);
    }
  }

  const row = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, d, b, c, d);
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
 * Lanza Umbría aerodinámica de oscuridad líquida orientada hacia +Z
 * (`fadeEndsY` para desvanecer extremos, núcleo carmesí-violeta aditivo,
 * asta fina y punta de lanza alargada sin aspecto esférico).
 */
export function createShadowLanceGroup(length = 1.25, radius = 0.068, empowered = false, isRival = false) {
  const group = new THREE.Group();
  const scaleMod = empowered ? 1.24 : 1.0;
  const r = radius * scaleMod;
  const accentCol = isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon;
  const violetCol = isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet;

  // Silueta inequívoca de lanza pequeña: asta delgada en -Z, collarín/guarda y punta afilada en +Z
  const pts = [
    new THREE.Vector2(0.001, -0.58 * length),
    new THREE.Vector2(r * 0.24, -0.50 * length),
    new THREE.Vector2(r * 0.26, 0.02 * length),
    new THREE.Vector2(r * 0.42, 0.10 * length),
    new THREE.Vector2(r * 1.05, 0.14 * length),
    new THREE.Vector2(r * 0.88, 0.22 * length),
    new THREE.Vector2(r * 0.42, 0.40 * length),
    new THREE.Vector2(0.001, 0.62 * length),
  ];
  const outerGeo = new THREE.LatheGeometry(pts, 14);
  outerGeo.rotateX(Math.PI * 0.5);

  const outerMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: empowered ? accentCol : violetCol,
    opacity: 0.94,
    fresnelPower: 1.5,
    rimIntensity: empowered ? 1.65 : 1.35,
    fadeEndsY: true,
    depthWrite: false,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.userData.noOutline = true;

  // Núcleo interior afilado carmesí/violeta
  const coreGeo = new THREE.LatheGeometry(
    pts.map((p) => new THREE.Vector2(p.x * 0.54, p.y * 0.92)),
    10
  );
  coreGeo.rotateX(Math.PI * 0.5);
  const coreMat = createEnergyVFXMaterial({
    coreColor: accentCol,
    rimColor: SHADOW_PALETTE.softViolet,
    opacity: empowered ? 0.98 : 0.88,
    fresnelPower: 1.5,
    additive: true,
    fadeEndsY: true,
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.userData.noOutline = true;

  // 2 pares de aletas en cruz en la base de la punta para acentuar la forma de lanza
  const finGeo = new THREE.ConeGeometry(r * 0.92, length * 0.52, 4);
  finGeo.rotateX(Math.PI * 0.5);
  finGeo.scale(1.35, 0.22, 1.0);
  const finMat = createEnergyVFXMaterial({
    coreColor: violetCol,
    rimColor: accentCol,
    opacity: empowered ? 0.92 : 0.78,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const finH = new THREE.Mesh(finGeo, finMat);
  finH.position.z = length * 0.28;
  finH.userData.noOutline = true;

  const finV = new THREE.Mesh(finGeo, finMat);
  finV.position.z = length * 0.28;
  finV.rotation.z = Math.PI * 0.5;
  finV.userData.noOutline = true;

  group.add(outerMesh, coreMesh, finH, finV);

  return {
    group,
    update(dt, age = 0) {
      finH.rotation.z += dt * (empowered ? 9.5 : 5.5);
      finV.rotation.z = finH.rotation.z + Math.PI * 0.5;
      const pulse = 1 + Math.sin(age * 24) * 0.08;
      outerMesh.scale.set(pulse, pulse, 1);
      coreMesh.scale.set(0.96 + Math.cos(age * 28) * 0.06, 0.96 + Math.cos(age * 28) * 0.06, 1);
    },
    dispose() {
      outerGeo.dispose();
      coreGeo.dispose();
      finGeo.dispose();
      outerMat.dispose();
      coreMat.dispose();
      finMat.dispose();
    },
  };
}

/**
 * Portal circular de Paso Sombrío en el suelo: disco de vacío oscuro,
 * anillo espiral violeta-carmesí y volutas ascendentes al desaparecer/reaparecer.
 */
export function createShadowPortalGroup(radius = 1.05, isRival = false) {
  const group = new THREE.Group();
  const accentCol = isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon;
  const violetCol = isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet;

  const voidGeo = new THREE.CircleGeometry(radius * 0.96, 36);
  voidGeo.rotateX(-Math.PI * 0.5);
  const voidMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: SHADOW_PALETTE.midnightIndigo,
    opacity: 0.92,
    softEdge: true,
    depthWrite: false,
  });
  const voidMesh = new THREE.Mesh(voidGeo, voidMat);
  voidMesh.position.y = 0.04;
  voidMesh.userData.noOutline = true;

  const rimGeo = new THREE.RingGeometry(radius * 0.68, radius * 1.06, 42);
  rimGeo.rotateX(-Math.PI * 0.5);
  const rimMat = createEnergyVFXMaterial({
    coreColor: accentCol,
    rimColor: violetCol,
    opacity: 0.9,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.position.y = 0.055;
  rimMesh.userData.noOutline = true;

  const vortexCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(radius * 0.82, 0.08, 0),
    new THREE.Vector3(0, 0.25, radius * 0.68),
    new THREE.Vector3(-radius * 0.54, 0.58, 0),
    new THREE.Vector3(0, 1.05, -radius * 0.34),
    new THREE.Vector3(radius * 0.16, 1.55, 0),
  ]);
  const ribbonGeo = createTaperingShadowTube(vortexCurve, 26, 0.075, 0.012, 8);
  const ribbonMat = createEnergyVFXMaterial({
    coreColor: violetCol,
    rimColor: accentCol,
    opacity: 0.82,
    additive: true,
    fadeEnds: true,
    depthWrite: false,
  });
  const ribA = new THREE.Mesh(ribbonGeo, ribbonMat);
  const ribB = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribB.rotation.y = Math.PI;
  ribA.userData.noOutline = true;
  ribB.userData.noOutline = true;

  const wispGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const wispMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.midnightIndigo,
    rimColor: accentCol,
    opacity: 0.72,
    softEdge: true,
    depthWrite: false,
  });
  const wisps = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const w = new THREE.Mesh(wispGeo, wispMat);
    w.position.set(Math.cos(a) * radius * 0.62, 0.22 + (i % 3) * 0.25, Math.sin(a) * radius * 0.62);
    w.userData.noOutline = true;
    group.add(w);
    wisps.push({ mesh: w, angle: a, phase: i * 0.9 });
  }

  group.add(voidMesh, rimMesh, ribA, ribB);

  const mats = [
    { mat: voidMat, base: 0.92 },
    { mat: rimMat, base: 0.9 },
    { mat: ribbonMat, base: 0.82 },
    { mat: wispMat, base: 0.72 },
  ];

  return {
    group,
    update(dt, age = 0) {
      ribA.rotation.y += dt * 7.5;
      ribB.rotation.y += dt * 7.5;
      rimMesh.rotation.y -= dt * 4.2;
      for (const w of wisps) {
        const curA = w.angle + age * 4.5;
        const cycle = (age * 1.6 + w.phase * 0.35) % 1;
        const r = radius * (0.7 - cycle * 0.35);
        w.mesh.position.set(Math.cos(curA) * r, 0.15 + cycle * 1.45, Math.sin(curA) * r);
        w.mesh.scale.setScalar(1.0 - cycle * 0.65);
      }
    },
    setFade(alpha) {
      const a = THREE.MathUtils.clamp(alpha, 0, 1);
      for (const m of mats) {
        m.mat.uniforms.uOpacity.value = m.base * a;
      }
    },
    dispose() {
      voidGeo.dispose();
      rimGeo.dispose();
      ribbonGeo.dispose();
      wispGeo.dispose();
      voidMat.dispose();
      rimMat.dispose();
      ribbonMat.dispose();
      wispMat.dispose();
    },
  };
}

/**
 * Tentáculos Oscuros: tentáculos orgánicos retorcidos con gradiente Fresnel
 * oscuro-carmesí (sin bordes negros) que brotan del suelo por 2.0s y drenan orbes
 * de esencia vital hacia el lanzador.
 */
export function createShadowTendrilsGroup(radius = 3.2, isRival = false) {
  const group = new THREE.Group();
  const accentCol = isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon;
  const violetCol = isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet;

  const poolGeo = new THREE.CircleGeometry(radius * 0.95, 40);
  poolGeo.rotateX(-Math.PI * 0.5);
  const poolMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: accentCol,
    opacity: 0.78,
    softEdge: true,
    depthWrite: false,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.position.y = 0.04;
  poolMesh.userData.noOutline = true;
  group.add(poolMesh);

  const tendrilMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: accentCol,
    opacity: 0.94,
    fresnelPower: 1.5,
    rimIntensity: 1.35,
    fadeEnds: true,
    depthWrite: false,
  });

  const tentacleGeos = [];
  const tentacles = [];
  const count = 8;

  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.16;
    const baseR = radius * (0.48 + (i % 3) * 0.16);
    const h = 1.65 + (i % 3) * 0.35;
    const bx = Math.cos(ang) * baseR;
    const bz = Math.sin(ang) * baseR;
    const twistX = -Math.sin(ang) * 0.38;
    const twistZ = Math.cos(ang) * 0.38;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(bx, -0.05, bz),
      new THREE.Vector3(bx * 0.88 + twistX, h * 0.38, bz * 0.88 + twistZ),
      new THREE.Vector3(bx * 0.56 - twistX * 0.5, h * 0.78, bz * 0.56 - twistZ * 0.5),
      new THREE.Vector3(bx * 0.24, h * 1.06, bz * 0.24),
    ]);
    const tGeo = createTaperingShadowTube(curve, 20, 0.145, 0.014, 10);
    tentacleGeos.push(tGeo);

    const mesh = new THREE.Mesh(tGeo, tendrilMat);
    mesh.userData.noOutline = true;
    mesh.scale.set(1, 0.08, 1);
    group.add(mesh);
    tentacles.push({ mesh, phase: i * 0.75 });
  }

  // Orbes carmesí-violeta de esencia vital drenada que viajan hacia el lanzador
  const orbGeo = new THREE.SphereGeometry(0.14, 12, 10);
  const orbMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: accentCol,
    opacity: 0.95,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const drainOrbs = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const orb = new THREE.Mesh(orbGeo, orbMat);
    const startPos = new THREE.Vector3(Math.cos(ang) * radius * 0.55, 0.75 + (i % 2) * 0.4, Math.sin(ang) * radius * 0.55);
    orb.position.copy(startPos);
    orb.userData.noOutline = true;
    group.add(orb);
    drainOrbs.push({ mesh: orb, startPos, delay: i * 0.07, phase: i });
  }

  const waveRingGeo = new THREE.RingGeometry(radius * 0.78, radius * 1.02, 42);
  waveRingGeo.rotateX(-Math.PI * 0.5);
  const waveRingMat = createEnergyVFXMaterial({
    coreColor: accentCol,
    rimColor: violetCol,
    opacity: 0.86,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const waveRing = new THREE.Mesh(waveRingGeo, waveRingMat);
  waveRing.position.y = 0.06;
  waveRing.userData.noOutline = true;
  group.add(waveRing);

  return {
    group,
    update(progress, age = 0, casterLocalOffset = null) {
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      const grow = p < 0.14 ? THREE.MathUtils.smoothstep(p / 0.14, 0, 1) : 1;
      const fade = p > 0.8 ? Math.pow(1 - (p - 0.8) / 0.2, 1.3) : 1;

      for (const tc of tentacles) {
        const sy = Math.max(0.06, grow * (p > 0.82 ? Math.max(0.06, 1.0 - ((p - 0.82) / 0.18)) : 1.0));
        tc.mesh.scale.set(1, sy, 1);
        tc.mesh.rotation.y = Math.sin(age * 8.5 + tc.phase) * 0.14;
      }

      poolMat.uniforms.uOpacity.value = 0.78 * fade;
      tendrilMat.uniforms.uOpacity.value = 0.94 * fade;
      waveRingMat.uniforms.uOpacity.value = 0.86 * (1 - p);
      waveRing.scale.setScalar(0.45 + p * 0.7);

      const dest = casterLocalOffset || new THREE.Vector3(0, 1.2, 0);
      for (const o of drainOrbs) {
        const tOrb = (age * 1.15 + o.phase * 0.16) % 1;
        o.mesh.position.lerpVectors(o.startPos, dest, THREE.MathUtils.smoothstep(tOrb, 0, 1));
        o.mesh.position.y += Math.sin(tOrb * Math.PI) * 0.55;
        const sc = Math.sin(tOrb * Math.PI) * 1.15 * fade;
        o.mesh.scale.setScalar(Math.max(0.01, sc));
      }
    },
    dispose() {
      poolGeo.dispose();
      orbGeo.dispose();
      waveRingGeo.dispose();
      for (const g of tentacleGeos) g.dispose();
      poolMat.dispose();
      tendrilMat.dispose();
      orbMat.dispose();
      waveRingMat.dispose();
    },
  };
}

/**
 * Domo hemisférico de Velo de Eclipse (cúpula translúcida de penumbra densa
 * sin contorno negro, anillo lunar eclipsado y partículas oscuras flotantes).
 */
export function createEclipseVeilDomeGroup(radius = 4.8, isRival = false) {
  const group = new THREE.Group();
  const accentCol = isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon;
  const violetCol = isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet;

  // Cúpula hemisférica translúcida (softEdge para difuminar silueta sin corte negro)
  const domeGeo = new THREE.SphereGeometry(radius, 40, 22, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const domeMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: violetCol,
    opacity: 0.42,
    fresnelPower: 1.65,
    rimIntensity: 1.35,
    softEdge: true,
    depthWrite: false,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.userData.noOutline = true;

  // Capa interna de penumbra indigo-carmesí muy sutil
  const innerDomeGeo = new THREE.SphereGeometry(radius * 0.96, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const innerDomeMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.midnightIndigo,
    rimColor: accentCol,
    opacity: 0.24,
    fresnelPower: 2.2,
    softEdge: true,
    additive: true,
    depthWrite: false,
  });
  const innerDomeMesh = new THREE.Mesh(innerDomeGeo, innerDomeMat);
  innerDomeMesh.userData.noOutline = true;

  // Anillo lunar eclipsado en el borde del suelo
  const baseRingGeo = new THREE.RingGeometry(radius * 0.91, radius * 1.02, 56);
  baseRingGeo.rotateX(-Math.PI * 0.5);
  const baseRingMat = createEnergyVFXMaterial({
    coreColor: accentCol,
    rimColor: violetCol,
    opacity: 0.85,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const baseRingMesh = new THREE.Mesh(baseRingGeo, baseRingMat);
  baseRingMesh.position.y = 0.05;
  baseRingMesh.userData.noOutline = true;

  // Suelo oscurecido dentro del domo
  const floorGeo = new THREE.CircleGeometry(radius * 0.98, 48);
  floorGeo.rotateX(-Math.PI * 0.5);
  const floorMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: SHADOW_PALETTE.midnightIndigo,
    opacity: 0.52,
    softEdge: true,
    depthWrite: false,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = 0.035;
  floorMesh.userData.noOutline = true;

  // Corona solar eclipsada girando suavemente en lo alto del domo
  const crownRingGeo = new THREE.TorusGeometry(radius * 0.36, 0.045, 10, 42);
  crownRingGeo.rotateX(Math.PI * 0.5);
  const crownRingMat = createEnergyVFXMaterial({
    coreColor: accentCol,
    rimColor: SHADOW_PALETTE.softViolet,
    opacity: 0.72,
    additive: true,
    depthWrite: false,
  });
  const crownRingMesh = new THREE.Mesh(crownRingGeo, crownRingMat);
  crownRingMesh.position.y = radius * 0.92;
  crownRingMesh.userData.noOutline = true;

  // Motas flotantes de oscuridad / esencia dentro de la cúpula
  const moteGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const darkMoteMat = createEnergyVFXMaterial({
    coreColor: SHADOW_PALETTE.obsidian,
    rimColor: violetCol,
    opacity: 0.78,
    softEdge: true,
    depthWrite: false,
  });
  const glowMoteMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: accentCol,
    opacity: 0.88,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  const motes = [];
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    const dist = radius * (0.28 + ((i * 37) % 10) * 0.062);
    const baseY = 0.45 + ((i * 23) % 10) * (radius * 0.055);
    const mote = new THREE.Mesh(moteGeo, i % 3 === 0 ? glowMoteMat : darkMoteMat);
    mote.position.set(Math.cos(ang) * dist, baseY, Math.sin(ang) * dist);
    mote.userData.noOutline = true;
    group.add(mote);
    motes.push({ mesh: mote, ang, dist, baseY, speed: (i % 2 === 0 ? 1 : -1) * (0.35 + (i % 4) * 0.12), phase: i * 0.85 });
  }

  group.add(floorMesh, domeMesh, innerDomeMesh, baseRingMesh, crownRingMesh);

  return {
    group,
    update(dt, age = 0, fadeAlpha = 1) {
      crownRingMesh.rotation.z += dt * 0.85;
      baseRingMesh.rotation.y -= dt * 0.5;
      const pulse = 1 + Math.sin(age * 3.4) * 0.018;
      innerDomeMesh.scale.setScalar(pulse);
      for (const m of motes) {
        const a = m.ang + age * m.speed;
        m.mesh.position.set(
          Math.cos(a) * m.dist,
          m.baseY + Math.sin(age * 2.4 + m.phase) * 0.35,
          Math.sin(a) * m.dist
        );
      }
      domeMat.uniforms.uOpacity.value = 0.42 * fadeAlpha;
      innerDomeMat.uniforms.uOpacity.value = 0.24 * fadeAlpha;
      baseRingMat.uniforms.uOpacity.value = 0.85 * fadeAlpha;
      floorMat.uniforms.uOpacity.value = 0.52 * fadeAlpha;
      crownRingMat.uniforms.uOpacity.value = 0.72 * fadeAlpha;
    },
    dispose() {
      domeGeo.dispose();
      innerDomeGeo.dispose();
      baseRingGeo.dispose();
      floorGeo.dispose();
      crownRingGeo.dispose();
      moteGeo.dispose();
      domeMat.dispose();
      innerDomeMat.dispose();
      baseRingMat.dispose();
      floorMat.dispose();
      crownRingMat.dispose();
      darkMoteMat.dispose();
      glowMoteMat.dispose();
    },
  };
}

/**
 * Media luna / guadaña energética sombría sin borde negro para el Aura Segador Nocturno (`Tecla R`).
 */
export function createShadowScytheGeo(outerR = 0.56, thickness = 0.14) {
  const shape = new THREE.Shape();
  shape.moveTo(0, outerR);
  shape.quadraticCurveTo(outerR * 0.65, outerR * 0.38, outerR * 0.58, -outerR * 0.48);
  shape.quadraticCurveTo(outerR * 0.26, outerR * 0.05, -outerR * 0.08, outerR * 0.34);
  shape.quadraticCurveTo(outerR * 0.14, outerR * 0.64, 0, outerR);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * 0.24,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 16,
  });
  geo.center();
  return geo;
}
