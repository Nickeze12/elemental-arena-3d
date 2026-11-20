import * as THREE from 'three';
import { createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * PsychicGeometry
 * ----------------------------------------------------------------------
 * Constructores geométricos orgánicos de energía astral pura para el 6.º
 * Maestro Elemental: Control Psíquico (`'psychic'`).
 *  - Esferas de plasma Fresnel, anillos rúnicos de luz pura (`AdditiveBlending`),
 *    cintas espirales suavizadas y vórtices nebulosos.
 *  - CERO contornos negros en toda la energía psíquica.
 */

export const PSYCHIC_PALETTE = {
  indigo: '#3b0764',
  darkIndigo: '#1a052d',
  royalViolet: '#7e22ce',
  magenta: '#e879f9',
  lavender: '#f3e8ff',
  glowPink: '#f0abfc',
};

let sharedNebulaTex = null;
let sharedRuneDiscTex = null;

function getNebulaVortexTexture() {
  if (sharedNebulaTex) return sharedNebulaTex;
  const size = 256;
  const c = size * 0.5;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  // Fondo radial nebuloso que se desvanece a alfa 0 en el borde
  const bg = g.createRadialGradient(c, c, size * 0.05, c, c, size * 0.49);
  bg.addColorStop(0, 'rgba(243, 232, 255, 0.92)');
  bg.addColorStop(0.28, 'rgba(232, 121, 249, 0.68)');
  bg.addColorStop(0.68, 'rgba(126, 34, 206, 0.28)');
  bg.addColorStop(1, 'rgba(59, 7, 100, 0.0)');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // Brazos espirales luminosos de luz astral
  for (let arm = 0; arm < 4; arm++) {
    const startAng = (arm / 4) * Math.PI * 2;
    g.strokeStyle = arm % 2 === 0 ? 'rgba(243, 232, 255, 0.85)' : 'rgba(240, 171, 252, 0.72)';
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 28; i++) {
      const u = i / 28;
      const a = startAng + u * Math.PI * 2.1;
      const r = size * (0.08 + u * 0.39);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineWidth = 6;
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedNebulaTex = tex;
  return tex;
}

function getRuneDiscTexture() {
  if (sharedRuneDiscTex) return sharedRuneDiscTex;
  const size = 256;
  const c = size * 0.5;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  // Anillos concéntricos finos + segmentos rúnicos luminosos
  g.strokeStyle = 'rgba(243, 232, 255, 0.92)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c, c, size * 0.44, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = 'rgba(232, 121, 249, 0.82)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c, c, size * 0.36, 0, Math.PI * 2);
  g.stroke();

  // Glifos geométricos radiales
  const glyphs = 12;
  for (let i = 0; i < glyphs; i++) {
    const a = (i / glyphs) * Math.PI * 2;
    g.save();
    g.translate(c + Math.cos(a) * size * 0.4, c + Math.sin(a) * size * 0.4);
    g.rotate(a + Math.PI * 0.5);
    g.strokeStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(240, 171, 252, 0.9)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-6, -4);
    g.lineTo(0, 6);
    g.lineTo(6, -4);
    if (i % 2 === 0) g.closePath();
    g.stroke();
    g.restore();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedRuneDiscTex = tex;
  return tex;
}

/** Genera una cinta tubular en espiral suave con extremos afilados */
function createTaperedSpiralTube(curve, segments = 24, maxRadius = 0.04, radial = 7) {
  const geo = new THREE.TubeGeometry(curve, segments, maxRadius, radial, false);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const center = new THREE.Vector3();
  const off = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    curve.getPointAt(u, center);
    off.fromBufferAttribute(pos, i).sub(center);
    const taper = 0.08 + 0.92 * Math.sin(u * Math.PI);
    off.multiplyScalar(taper);
    pos.setXYZ(i, center.x + off.x, center.y + off.y, center.z + off.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Orbe telequinético con esfera de plasma Fresnel + aura externa + anillos rúnicos
 * de luz pura (`AdditiveBlending`, SIN contorno negro).
 */
export function createPsychicOrbGroup(radius = 0.24, ringCount = 2) {
  const group = new THREE.Group();
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.96,
    fresnelPower: 1.5,
    rimIntensity: 1.25,
    additive: false,
    depthWrite: false,
  });
  const auraMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.magenta,
    rimColor: PSYCHIC_PALETTE.royalViolet,
    opacity: 0.56,
    additive: true,
    softEdge: true,
    fresnelPower: 1.7,
    depthWrite: false,
  });
  const ringMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.lavender,
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.92,
    additive: true,
    fresnelPower: 1.4,
    depthWrite: false,
  });

  const coreGeo = new THREE.SphereGeometry(radius * 0.9, 20, 16);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.userData.noOutline = true;
  group.add(core);

  const auraGeo = new THREE.SphereGeometry(radius * 1.24, 18, 14);
  const aura = new THREE.Mesh(auraGeo, auraMat);
  aura.userData.noOutline = true;
  group.add(aura);

  const ringGeo = new THREE.TorusGeometry(radius * 1.48, radius * 0.08, 10, 32);
  const rings = [];
  for (let i = 0; i < ringCount; i++) {
    const r = new THREE.Mesh(ringGeo, ringMat);
    r.rotation.set(0.6 + i * 0.9, i * 1.1, i * 0.7);
    r.userData.noOutline = true;
    group.add(r);
    rings.push(r);
  }

  return {
    group,
    rings,
    dispose() {
      coreGeo.dispose();
      auraGeo.dispose();
      ringGeo.dispose();
      coreMat.dispose();
      auraMat.dispose();
      ringMat.dispose();
    },
  };
}

/**
 * Proyectil espiral de `Pulso de Confusión` (Click Der) con plasma Fresnel y cinta
 * luminosa de luz pura (`AdditiveBlending`, sin bordes negros).
 */
export function createConfusionPulseMesh(radius = 0.3) {
  const group = new THREE.Group();
  const innerMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.95,
    additive: true,
    fresnelPower: 1.5,
    depthWrite: false,
  });
  const outerMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.glowPink,
    rimColor: PSYCHIC_PALETTE.royalViolet,
    opacity: 0.85,
    additive: true,
    fadeEnds: true,
    fresnelPower: 1.6,
    depthWrite: false,
  });

  const coreGeo = new THREE.SphereGeometry(radius * 0.56, 18, 14);
  coreGeo.scale(0.95, 0.95, 1.48);
  const core = new THREE.Mesh(coreGeo, innerMat);
  core.userData.noOutline = true;
  group.add(core);

  const spiralPts = [];
  const turns = 22;
  for (let i = 0; i <= turns; i++) {
    const t = i / turns;
    const ang = t * Math.PI * 3.8;
    const rr = radius * (0.28 + t * 0.92);
    spiralPts.push(new THREE.Vector3(Math.cos(ang) * rr, Math.sin(ang) * rr, (0.48 - t) * radius * 1.05));
  }
  const curve = new THREE.CatmullRomCurve3(spiralPts);
  const spiralGeo = createTaperedSpiralTube(curve, 26, radius * 0.11, 7);
  const spiral = new THREE.Mesh(spiralGeo, outerMat);
  spiral.userData.noOutline = true;
  group.add(spiral);

  return {
    group,
    spiral,
    dispose() {
      coreGeo.dispose();
      spiralGeo.dispose();
      innerMat.dispose();
      outerMat.dispose();
    },
  };
}

/**
 * Espiral hipnótica magenta + destellos rúnicos luminosos sobre la cabeza (`setConfused`).
 */
export function createHypnoticSpiralGroup() {
  const group = new THREE.Group();
  const magMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: '#e879f9',
    opacity: 0.94,
    additive: true,
    fadeEnds: true,
    depthWrite: false,
  });
  const lavMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.lavender,
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.92,
    additive: true,
    depthWrite: false,
  });

  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const ang = t * Math.PI * 4.4;
    const r = 0.05 + t * 0.29;
    pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(t * Math.PI) * 0.06, Math.sin(ang) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const spiralGeo = createTaperedSpiralTube(curve, 28, 0.025, 6);
  const spiral = new THREE.Mesh(spiralGeo, magMat);
  spiral.userData.noOutline = true;
  group.add(spiral);

  const prismGeo = new THREE.SphereGeometry(0.044, 10, 8);
  prismGeo.scale(0.65, 1.5, 0.65);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = new THREE.Mesh(prismGeo, lavMat);
    p.position.set(Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34);
    p.userData.noOutline = true;
    group.add(p);
  }

  return {
    group,
    dispose() {
      spiralGeo.dispose();
      prismGeo.dispose();
      magMat.dispose();
      lavMat.dispose();
    },
  };
}

/**
 * Aro / corona de runas de luz pura (`AdditiveBlending`, sin contorno negro).
 */
export function createRuneHaloGroup(radius = 0.36, shardCount = 6, scale = 1) {
  const group = new THREE.Group();
  const ringMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.lavender,
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.9,
    additive: true,
    depthWrite: false,
  });
  const glyphDiscMat = new THREE.MeshBasicMaterial({
    map: getRuneDiscTexture(),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shardMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.92,
    additive: true,
    depthWrite: false,
  });

  const ringGeo = new THREE.TorusGeometry(radius, 0.015 * scale, 10, 32);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.userData.noOutline = true;
  group.add(ring);

  const discGeo = new THREE.PlaneGeometry(radius * 2.35, radius * 2.35);
  const disc = new THREE.Mesh(discGeo, glyphDiscMat);
  disc.userData.noOutline = true;
  group.add(disc);

  const shardGeo = new THREE.OctahedronGeometry(0.042 * scale, 1);
  shardGeo.scale(0.65, 1.45, 0.55);
  for (let i = 0; i < shardCount; i++) {
    const a = (i / shardCount) * Math.PI * 2;
    const s = new THREE.Mesh(shardGeo, shardMat);
    s.position.set(Math.cos(a) * (radius + 0.05 * scale), Math.sin(a) * (radius + 0.05 * scale), 0);
    s.rotation.z = a - Math.PI * 0.5;
    s.userData.noOutline = true;
    group.add(s);
  }

  return {
    group,
    dispose() {
      ringGeo.dispose();
      discGeo.dispose();
      shardGeo.dispose();
      ringMat.dispose();
      glyphDiscMat.dispose();
      shardMat.dispose();
    },
  };
}

/**
 * Singularidad / Vórtice Nebuloso Espiral para `Implosión Astral` (Tecla E):
 *  - Núcleo oscuro gravitatorio con intenso horizonte de sucesos Fresnel magenta.
 *  - Disco espiral nebuloso translúcido con luz astral (`AdditiveBlending`) sin borde negro.
 *  - Órbitas luminosas inclinadas suaves.
 */
export function createGravityVortexGroup(radius = 4.6) {
  const group = new THREE.Group();
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#120324',
    rimColor: PSYCHIC_PALETTE.glowPink,
    opacity: 0.98,
    fresnelPower: 2.1,
    rimIntensity: 1.5,
    depthWrite: false,
  });
  const outerShellMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.royalViolet,
    rimColor: PSYCHIC_PALETTE.lavender,
    opacity: 0.52,
    additive: true,
    softEdge: true,
    fresnelPower: 1.6,
    depthWrite: false,
  });
  const nebulaMat = new THREE.MeshBasicMaterial({
    map: getNebulaVortexTexture(),
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMat = createEnergyVFXMaterial({
    coreColor: PSYCHIC_PALETTE.lavender,
    rimColor: PSYCHIC_PALETTE.magenta,
    opacity: 0.9,
    additive: true,
    depthWrite: false,
  });

  const coreGeo = new THREE.SphereGeometry(0.62, 24, 18);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.userData.noOutline = true;
  group.add(core);

  const shellGeo = new THREE.SphereGeometry(0.95, 22, 16);
  const shell = new THREE.Mesh(shellGeo, outerShellMat);
  shell.userData.noOutline = true;
  group.add(shell);

  // Vórtice nebuloso espiral sobre el plano del campo gravitatorio
  const fieldGeo = new THREE.CircleGeometry(radius * 1.05, 48);
  fieldGeo.rotateX(-Math.PI * 0.5);
  const fieldRing = new THREE.Mesh(fieldGeo, nebulaMat);
  fieldRing.position.y = -0.35;
  fieldRing.userData.noOutline = true;
  group.add(fieldRing);

  const innerOrbitGeo = new THREE.TorusGeometry(1.28, 0.052, 10, 36);
  const orbitA = new THREE.Mesh(innerOrbitGeo, ringMat);
  orbitA.rotation.x = 0.7;
  orbitA.userData.noOutline = true;

  const orbitB = new THREE.Mesh(innerOrbitGeo, ringMat);
  orbitB.rotation.set(-0.7, 0.8, 0);
  orbitB.userData.noOutline = true;
  group.add(orbitA, orbitB);

  return {
    group,
    core,
    orbitA,
    orbitB,
    fieldRing,
    dispose() {
      if (group.parent) group.parent.remove(group);
      coreGeo.dispose();
      shellGeo.dispose();
      fieldGeo.dispose();
      innerOrbitGeo.dispose();
      coreMat.dispose();
      outerShellMat.dispose();
      nebulaMat.dispose();
      ringMat.dispose();
    },
  };
}
