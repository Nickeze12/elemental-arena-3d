import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * StormGeometry
 * ----------------------------------------------------------------------
 * Constructores geométricos orgánicos y volumétricos para el 7.º Maestro
 * Elemental: Control de Tormenta (`'storm'`).
 *  - Niebla vaporosa multicapa con desvanecimiento Fresnel suave en bordes (`softEdge`).
 *  - Cumulonimbus oscuro esculpido sin contorno negro con destellos eléctricos internos.
 *  - Rayos quebrados multirramificados con núcleo blanco-celeste brillante y
 *    resplandor eléctrico exterior (`AdditiveBlending`), CERO contornos negros.
 */

export const STORM_PALETTE = {
  slate: '#1e293b',
  slateDark: '#0f172a',
  cloudDark: '#334155',
  electricBlue: '#38bdf8',
  boltGold: '#fde047',
  mistSilver: '#e2e8f0',
};

/**
 * Crea una geometría quebrada en zigzag entre dos puntos y devuelve `{ geo, pts }`
 * para permitir ramificaciones secundarias sobre los vértices de la polilínea.
 */
export function createZigzagBoltData(start, end, { segments = 6, radius = 0.045, jitter = 0.16, seed = 1 } = {}) {
  const pts = [];
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length() || 1;
  dir.divideScalar(len);

  const ref = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const sideA = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const sideB = new THREE.Vector3().crossVectors(dir, sideA).normalize();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    if (i > 0 && i < segments) {
      const a = Math.sin(seed * 19.3 + i * 7.7) * jitter * (i % 2 === 0 ? 1 : -1);
      const b = Math.cos(seed * 13.1 + i * 5.3) * jitter * 0.65;
      p.addScaledVector(sideA, a).addScaledVector(sideB, b);
    }
    pts.push(p);
  }

  const radial = 5;
  const positions = [];
  const indices = [];
  const v = new THREE.Vector3();

  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const r = radius * (1 - t * 0.42);
    const tangent = new THREE.Vector3();
    if (i < pts.length - 1) tangent.subVectors(pts[i + 1], pts[i]);
    else tangent.subVectors(pts[i], pts[i - 1]);
    if (tangent.lengthSq() < 1e-6) tangent.copy(dir);
    else tangent.normalize();

    const nA = new THREE.Vector3()
      .crossVectors(tangent, Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .normalize();
    const nB = new THREE.Vector3().crossVectors(tangent, nA).normalize();

    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      v.copy(pts[i])
        .addScaledVector(nA, Math.cos(ang) * r)
        .addScaledVector(nB, Math.sin(ang) * r);
      positions.push(v.x, v.y, v.z);
    }
  }

  const row = radial + 1;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, pts };
}

/** Wrapper compatible que devuelve directamente la BufferGeometry quebrada */
export function createZigzagBoltGeometry(start, end, opts = {}) {
  return createZigzagBoltData(start, end, opts).geo;
}

/**
 * Proyectil de rayo quebrado multirramificado hacia +Z con núcleo blanco-celeste
 * brillante (`AdditiveBlending`) y resplandor eléctrico exterior sin bordes negros.
 */
export function createStormBoltGroup(length = 1.4, radius = 0.055, isChain = false) {
  const group = new THREE.Group();
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: isChain ? '#e0f2fe' : '#fef08a',
    opacity: 0.98,
    additive: true,
    depthWrite: false,
  });
  const glowMat = createEnergyVFXMaterial({
    coreColor: isChain ? STORM_PALETTE.electricBlue : STORM_PALETTE.boltGold,
    rimColor: STORM_PALETTE.electricBlue,
    opacity: 0.62,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  const mainBuild = createZigzagBoltData(
    new THREE.Vector3(0, 0, -length * 0.5),
    new THREE.Vector3(0, 0, length * 0.5),
    { segments: 6, radius: radius * 0.72, jitter: 0.14, seed: isChain ? 3.2 : 1.4 }
  );
  const glowBuild = createZigzagBoltData(
    new THREE.Vector3(0, 0, -length * 0.5),
    new THREE.Vector3(0, 0, length * 0.5),
    { segments: 6, radius: radius * 1.45, jitter: 0.14, seed: isChain ? 3.2 : 1.4 }
  );

  // Ramificación lateral pequeña partiendo del punto medio
  const midPt = mainBuild.pts[Math.floor(mainBuild.pts.length * 0.5)].clone();
  const forkEnd = midPt.clone().add(new THREE.Vector3(0.24, 0.18, length * 0.28));
  const forkBuild = createZigzagBoltData(midPt, forkEnd, {
    segments: 3,
    radius: radius * 0.42,
    jitter: 0.08,
    seed: isChain ? 9.4 : 6.1,
  });

  const mainMesh = new THREE.Mesh(mainBuild.geo, coreMat);
  const subMesh = new THREE.Mesh(glowBuild.geo, glowMat);
  const forkMesh = new THREE.Mesh(forkBuild.geo, glowMat);
  mainMesh.userData.noOutline = true;
  subMesh.userData.noOutline = true;
  forkMesh.userData.noOutline = true;

  group.add(subMesh, mainMesh, forkMesh);

  return {
    group,
    mainMesh,
    subMesh,
    dispose() {
      mainBuild.geo.dispose();
      glowBuild.geo.dispose();
      forkBuild.geo.dispose();
      coreMat.dispose();
      glowMat.dispose();
    },
  };
}

/**
 * Cúmulo volumétrico vaporoso multicapa con desvanecimiento Fresnel en bordes y arcos
 * eléctricos internos (`Forma de Niebla`), completamente suavizado y SIN contornos negros.
 */
export function createMistClusterGroup(scale = 1) {
  const group = new THREE.Group();
  const coreMistMat = createEnergyVFXMaterial({
    coreColor: '#f8fafc',
    rimColor: '#93c5fd',
    opacity: 0.36,
    softEdge: true,
    fresnelPower: 1.5,
    depthWrite: false,
  });
  const outerMistMat = createEnergyVFXMaterial({
    coreColor: STORM_PALETTE.mistSilver,
    rimColor: STORM_PALETTE.electricBlue,
    opacity: 0.24,
    softEdge: true,
    fresnelPower: 1.8,
    depthWrite: false,
  });
  const sparkMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: STORM_PALETTE.electricBlue,
    opacity: 0.92,
    additive: true,
    depthWrite: false,
  });

  // Velo central suave que envuelve la silueta vaporosa
  const veilGeo = new THREE.SphereGeometry(0.64 * scale, 18, 14);
  veilGeo.scale(1.05, 1.38, 1.05);
  const veil = new THREE.Mesh(veilGeo, outerMistMat);
  veil.userData.noOutline = true;
  group.add(veil);

  // 10 volutas de niebla suavizadas en múltiples capas alrededor del cuerpo
  const puffGeo = new THREE.SphereGeometry(0.34 * scale, 16, 12);
  const puffs = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p = new THREE.Mesh(puffGeo, i % 2 === 0 ? coreMistMat : outerMistMat);
    const rad = (0.34 + (i % 3) * 0.14) * scale;
    const py = (-0.42 + (i % 5) * 0.24) * scale;
    p.position.set(Math.cos(a) * rad, py, Math.sin(a) * rad);
    const sx = (0.85 + (i % 3) * 0.24) * scale;
    p.scale.set(sx, sx * 0.72, sx);
    p.userData.noOutline = true;
    group.add(p);
    puffs.push({ mesh: p, baseY: py, radius: rad, phase: a });
  }

  // Arcos eléctricos brillantes dentro de la niebla
  const arcGeos = [];
  const arcs = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const g = createZigzagBoltGeometry(
      new THREE.Vector3(Math.cos(ang) * 0.62 * scale, -0.35 * scale, Math.sin(ang) * 0.62 * scale),
      new THREE.Vector3(Math.cos(ang + 1.4) * 0.58 * scale, 0.78 * scale, Math.sin(ang + 1.4) * 0.58 * scale),
      { segments: 5, radius: 0.022 * scale, jitter: 0.12 * scale, seed: 2.3 + i * 3.1 }
    );
    const m = new THREE.Mesh(g, sparkMat);
    m.userData.noOutline = true;
    group.add(m);
    arcGeos.push(g);
    arcs.push(m);
  }

  return {
    group,
    puffs,
    arcs,
    dispose() {
      veilGeo.dispose();
      puffGeo.dispose();
      for (const g of arcGeos) g.dispose();
      coreMistMat.dispose();
      outerMistMat.dispose();
      sparkMat.dispose();
    },
  };
}

/**
 * Cumulonimbus oscuro esculpido (`Nube de Trueno`, E) sin bordes negros, con
 * destellos eléctricos internos previos a cada descarga y anillo eléctrico sutil.
 */
export function createThunderCloudGroup(radius = 4.6, height = 5.5) {
  const group = new THREE.Group();

  // Cumulonimbus denso y esculpido (sombreado suave, sin contornos negros)
  const cloudMat = createToonMaterial('#2a374a', {
    emissive: '#1e293b',
    emissiveIntensity: 0.45,
  });
  cloudMat.userData.noOutline = true;

  const rimMat = createToonMaterial('#3f5169', {
    emissive: STORM_PALETTE.electricBlue,
    emissiveIntensity: 0.22,
  });
  rimMat.userData.noOutline = true;

  const internalFlashMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: STORM_PALETTE.electricBlue,
    opacity: 0.45,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  const canopy = new THREE.Group();
  canopy.position.y = height;
  group.add(canopy);

  const puffGeo = new THREE.SphereGeometry(1, 20, 14);
  const puffCount = 11;
  const puffs = [];
  for (let i = 0; i < puffCount; i++) {
    const isCenter = i === 0;
    const ang = (i / Math.max(1, puffCount - 1)) * Math.PI * 2;
    const pr = isCenter ? radius * 0.48 : radius * (0.28 + (i % 3) * 0.05);
    const dist = isCenter ? 0 : radius * (0.44 + (i % 2) * 0.08);
    const m = new THREE.Mesh(puffGeo, i % 2 === 0 ? cloudMat : rimMat);
    m.position.set(Math.cos(ang) * dist, isCenter ? 0.5 : (i % 2) * 0.28, Math.sin(ang) * dist);
    m.scale.set(pr, pr * 0.44, pr);
    m.userData.noOutline = true;
    canopy.add(m);
    puffs.push(m);
  }

  // Núcleo de relámpago interno que destella antes de cada descarga
  const underCoreGeo = new THREE.SphereGeometry(radius * 0.48, 18, 12);
  underCoreGeo.scale(1.15, 0.34, 1.15);
  const underCore = new THREE.Mesh(underCoreGeo, internalFlashMat);
  underCore.position.y = -0.22;
  underCore.userData.noOutline = true;
  canopy.add(underCore);

  // Anillo eléctrico suave en el suelo marcando el área de descarga
  const floorGeo = new THREE.RingGeometry(Math.max(0.4, radius - 0.16), radius, 48);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = createEnergyVFXMaterial({
    coreColor: '#bae6fd',
    rimColor: STORM_PALETTE.electricBlue,
    opacity: 0.55,
    additive: true,
    depthWrite: false,
  });
  const floorRing = new THREE.Mesh(floorGeo, floorMat);
  floorRing.position.y = 0.06;
  floorRing.userData.noOutline = true;
  group.add(floorRing);

  return {
    group,
    canopy,
    underCore,
    floorRing,
    setInternalFlash(amount) {
      const flash = THREE.MathUtils.clamp(amount, 0, 1);
      internalFlashMat.opacity = 0.35 + flash * 0.62;
      underCore.scale.set(1.12 + flash * 0.42, 0.34 + flash * 0.28, 1.12 + flash * 0.42);
      rimMat.emissiveIntensity = 0.22 + flash * 0.85;
      cloudMat.emissive.set('#1e293b').lerp(new THREE.Color('#38bdf8'), flash * 0.45);
    },
    dispose() {
      puffGeo.dispose();
      underCoreGeo.dispose();
      floorGeo.dispose();
      cloudMat.dispose();
      rimMat.dispose();
      internalFlashMat.dispose();
      floorMat.dispose();
    },
  };
}

/**
 * Relámpago vertical multirramificado que cae desde la nube con núcleo blanco-celeste
 * brillante y halo eléctrico exterior (`AdditiveBlending`), sin bordes negros.
 */
export function createVerticalLightningGroup(height = 5.5, radius = 0.12, seed = 1) {
  const group = new THREE.Group();
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: '#e0f2fe',
    opacity: 0.98,
    additive: true,
    depthWrite: false,
  });
  const haloMat = createEnergyVFXMaterial({
    coreColor: STORM_PALETTE.electricBlue,
    rimColor: STORM_PALETTE.boltGold,
    opacity: 0.65,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  const mainBuild = createZigzagBoltData(
    new THREE.Vector3(0, height, 0),
    new THREE.Vector3(0, 0, 0),
    { segments: 10, radius: radius * 0.78, jitter: 0.38, seed }
  );
  const mainMesh = new THREE.Mesh(mainBuild.geo, coreMat);
  mainMesh.userData.noOutline = true;
  group.add(mainMesh);

  const haloBuild = createZigzagBoltData(
    new THREE.Vector3(0, height, 0),
    new THREE.Vector3(0, 0.05, 0),
    { segments: 8, radius: radius * 1.55, jitter: 0.42, seed: seed + 0.3 }
  );
  const haloMesh = new THREE.Mesh(haloBuild.geo, haloMat);
  haloMesh.userData.noOutline = true;
  group.add(haloMesh);

  // 2 ramas secundarias quebradas saliendo desde el tronco del relámpago
  const branchGeos = [];
  for (let b = 0; b < 2; b++) {
    const idx = Math.floor(mainBuild.pts.length * (b === 0 ? 0.35 : 0.65));
    const branchStart = mainBuild.pts[idx].clone();
    const ang = seed * 1.7 + b * 2.5;
    const branchEnd = branchStart
      .clone()
      .add(new THREE.Vector3(Math.cos(ang) * 1.15, -height * 0.28, Math.sin(ang) * 1.15));
    const br = createZigzagBoltData(branchStart, branchEnd, {
      segments: 4,
      radius: radius * 0.44,
      jitter: 0.22,
      seed: seed + b * 7.3,
    });
    const bm = new THREE.Mesh(br.geo, b === 0 ? coreMat : haloMat);
    bm.userData.noOutline = true;
    group.add(bm);
    branchGeos.push(br.geo);
  }

  return {
    group,
    dispose() {
      mainBuild.geo.dispose();
      haloBuild.geo.dispose();
      for (const g of branchGeos) g.dispose();
      coreMat.dispose();
      haloMat.dispose();
    },
  };
}
