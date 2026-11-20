import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial, addOutline } from './ToonMaterial.js';
import { createWoodPlankTexture } from './ProceduralTextures.js';

/**
 * NatureGeometry
 * ----------------------------------------------------------------------
 * Constructores geométricos orgánicos para el 5.º Maestro Elemental:
 * Naturaleza / Planta (`'nature'`).
 *  - Materia vegetal sólida (espinas, lianas con grosor decreciente, hojas con
 *    nervadura central curva y pétalos del brote): sombreado Cel-Shaded con
 *    textura vegetal y contorno fino de tinta (`OUTLINE_COLOR`).
 *  - Esporas luminosas y halos de polen: materiales energéticos luminosos
 *    sin contorno negro.
 */

export const NATURE_PALETTE = {
  deepForest: '#2d6a4f',
  forestDark: '#1b4332',
  emerald: '#52b788',
  brightLeaf: '#74c69d',
  spore: '#4ade80',
  sporeGlow: '#a7f3d0',
  bark: '#5c4033',
  barkDark: '#3d281f',
  mossGold: '#c2b955',
  thornTip: '#e6f9ed',
  mouthDark: '#1f1024',
};

const OUTLINE_COLOR = 0x18211b;

/**
 * Crea un `TubeGeometry` curvo orgánico con grosor decreciente y leve torsión vegetal.
 * @param {THREE.Curve} curve
 * @param {number} [tubularSegs=14]
 * @param {number} [radiusStart=0.07]
 * @param {number} [radiusEnd=0.014]
 * @param {number} [radialSegs=7]
 */
export function createOrganicVineTubeGeometry(
  curve,
  tubularSegs = 14,
  radiusStart = 0.07,
  radiusEnd = 0.014,
  radialSegs = 7
) {
  const geo = new THREE.TubeGeometry(curve, tubularSegs, radiusStart, radialSegs, false);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const center = new THREE.Vector3();
  const offset = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    curve.getPointAt(u, center);
    offset.fromBufferAttribute(pos, i).sub(center);
    const targetScale = THREE.MathUtils.lerp(1.0, radiusEnd / Math.max(1e-4, radiusStart), Math.pow(u, 0.85));
    // Pequeños nudos orgánicos suaves a lo largo de la liana
    const knot = 1 + Math.sin(u * Math.PI * 5.0) * 0.08 * (1 - u * 0.5);
    offset.multiplyScalar(targetScale * knot);
    pos.setXYZ(i, center.x + offset.x, center.y + offset.y, center.z + offset.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Hoja afilada esculpida con curvatura longitudinal y nervadura central realzada hacia +Z.
 * @param {number} [length=0.5]
 * @param {number} [width=0.22]
 * @param {number} [thickness=0.03]
 */
export function createLeafBladeGeometry(length = 0.5, width = 0.22, thickness = 0.03) {
  const segL = 8;
  const segW = 4;
  const geo = new THREE.BoxGeometry(width, thickness, length, segW, 1, segL);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i);
    const oy = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((z + length * 0.5) / length, 0, 1); // 0 tallo -> 1 punta
    const xNorm = ox / (width * 0.5 || 1);

    // Silueta lanceolada afilada en punta y estrechada en el pecíolo
    const widthProfile = Math.sin(Math.pow(t, 0.65) * Math.PI);
    const x = ox * (0.12 + 0.92 * widthProfile);

    // Arco suave de hoja cayendo + pliegue en V marcado desde la nervadura central
    const archY = Math.sin(t * Math.PI) * length * 0.09 - Math.pow(t, 2.2) * length * 0.05;
    const midribFold = (1 - Math.abs(xNorm)) * thickness * 1.15;
    const y = oy * (0.45 + 0.55 * (1 - Math.abs(xNorm))) + archY + (oy >= 0 ? midribFold : midribFold * 0.35);

    pos.setXYZ(i, x, y, z);
  }
  geo.userData.isSculpted = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crea un dardo de espina vegetal sólido + 2 hojitas curvadas con nervadura central (+Z).
 */
export function createThornDartMesh(scale = 1) {
  const group = new THREE.Group();
  const spineMat = createToonMaterial(NATURE_PALETTE.emerald, {
    emissive: '#2d6a4f',
    emissiveIntensity: 0.25,
  });
  const tipMat = createToonMaterial(NATURE_PALETTE.thornTip, {
    emissive: '#4ade80',
    emissiveIntensity: 0.35,
  });
  const leafMat = createToonMaterial(NATURE_PALETTE.deepForest);

  const bodyGeo = new THREE.ConeGeometry(0.08 * scale, 0.72 * scale, 8);
  bodyGeo.rotateX(Math.PI * 0.5);
  const body = new THREE.Mesh(bodyGeo, spineMat);
  addOutline(body, 0.011, OUTLINE_COLOR);

  const tipGeo = new THREE.ConeGeometry(0.052 * scale, 0.28 * scale, 7);
  tipGeo.rotateX(Math.PI * 0.5);
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.z = 0.28 * scale;
  addOutline(tip, 0.009, OUTLINE_COLOR);

  const wingGeo = createLeafBladeGeometry(0.34 * scale, 0.17 * scale, 0.024 * scale);
  const leafL = new THREE.Mesh(wingGeo, leafMat);
  leafL.position.set(0.075 * scale, 0.01 * scale, -0.18 * scale);
  leafL.rotation.set(0.08, -0.35, 0.22);
  addOutline(leafL, 0.009, OUTLINE_COLOR);

  const leafR = new THREE.Mesh(wingGeo, leafMat);
  leafR.position.set(-0.075 * scale, -0.01 * scale, -0.18 * scale);
  leafR.rotation.set(-0.08, 0.35, -0.22);
  addOutline(leafR, 0.009, OUTLINE_COLOR);

  group.add(body, tip, leafL, leafR);
  return {
    group,
    dispose() {
      bodyGeo.dispose();
      tipGeo.dispose();
      wingGeo.dispose();
      spineMat.dispose();
      tipMat.dispose();
      leafMat.dispose();
    },
  };
}

/**
 * Crea un racimo orgánico de lianas retorcidas con grosor decreciente, textura vegetal
 * y hojitas/espinas para `Raíces Enredaderas` (Tecla Q) y estado `setRooted`.
 */
export function createRootClusterGroup(height = 0.95, spread = 0.35, seed = 1) {
  const group = new THREE.Group();
  const vineTex = createWoodPlankTexture({
    baseColor: NATURE_PALETTE.deepForest,
    grainColor: NATURE_PALETTE.forestDark,
    highlightColor: NATURE_PALETTE.emerald,
    planks: 4,
    repeatX: 1,
    repeatY: 3,
  });
  const barkTex = createWoodPlankTexture({
    baseColor: NATURE_PALETTE.bark,
    grainColor: NATURE_PALETTE.barkDark,
    highlightColor: '#7a5948',
    planks: 4,
    repeatX: 1,
    repeatY: 2,
  });

  const vineMat = createToonMaterial(NATURE_PALETTE.deepForest, { map: vineTex });
  const barkMat = createToonMaterial(NATURE_PALETTE.bark, { map: barkTex });
  const thornMat = createToonMaterial(NATURE_PALETTE.emerald);
  const disposables = [vineMat, barkMat, thornMat];

  const leafGeo = createLeafBladeGeometry(0.24, 0.11, 0.02);
  disposables.push(leafGeo);

  const count = 4;
  for (let i = 0; i < count; i++) {
    const ang = ((i + (seed % 3) * 0.25) / count) * Math.PI * 2;
    const h = height * (0.76 + ((i * 37 + seed) % 10) * 0.036);
    const pts = [
      new THREE.Vector3(Math.cos(ang) * spread * 0.65, 0, Math.sin(ang) * spread * 0.65),
      new THREE.Vector3(Math.cos(ang + 0.48) * spread * 0.48, h * 0.36, Math.sin(ang + 0.48) * spread * 0.48),
      new THREE.Vector3(Math.cos(ang + 1.05) * spread * 0.26, h * 0.74, Math.sin(ang + 1.05) * spread * 0.26),
      new THREE.Vector3(Math.cos(ang + 1.45) * spread * 0.08, h, Math.sin(ang + 1.45) * spread * 0.08),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = createOrganicVineTubeGeometry(curve, 14, 0.064, 0.015, 7);
    const mesh = new THREE.Mesh(tubeGeo, i % 2 === 0 ? vineMat : barkMat);
    mesh.castShadow = true;
    addOutline(mesh, 0.011, OUTLINE_COLOR);
    group.add(mesh);
    disposables.push(tubeGeo);

    // Hojita brotando en el tercio medio de cada liana
    const bract = new THREE.Mesh(leafGeo, thornMat);
    bract.position.copy(pts[1]);
    bract.rotation.set(0.35, -ang + 0.8, 0.25);
    addOutline(bract, 0.008, OUTLINE_COLOR);
    group.add(bract);

    const tipGeo = new THREE.ConeGeometry(0.044, 0.2, 6);
    const tip = new THREE.Mesh(tipGeo, thornMat);
    tip.position.copy(pts[3]);
    tip.rotation.set(Math.sin(ang) * 0.3, ang, Math.cos(ang) * 0.3);
    addOutline(tip, 0.009, OUTLINE_COLOR);
    group.add(tip);
    disposables.push(tipGeo);
  }

  return {
    group,
    dispose() {
      for (const d of disposables) {
        if (d && d.dispose) d.dispose();
      }
    },
  };
}

/**
 * Orbe de esporas con núcleo energético luminoso + halo vaporoso esmeralda SIN borde negro
 * rodeado de 4 hojas curvadas con nervadura central (`Tormenta de Esporas`, Tecla E).
 */
export function createSporeOrbGroup(radius = 0.28) {
  const group = new THREE.Group();
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#f0fdf4',
    rimColor: NATURE_PALETTE.spore,
    opacity: 0.96,
    additive: true,
    fresnelPower: 1.5,
    depthWrite: false,
  });
  const haloMat = createEnergyVFXMaterial({
    coreColor: NATURE_PALETTE.spore,
    rimColor: NATURE_PALETTE.emerald,
    opacity: 0.45,
    softEdge: true,
    fresnelPower: 1.7,
    depthWrite: false,
  });
  const leafMat = createToonMaterial(NATURE_PALETTE.deepForest, {
    emissive: '#1b4332',
    emissiveIntensity: 0.2,
  });

  const coreGeo = new THREE.SphereGeometry(radius * 0.82, 18, 14);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.userData.noOutline = true;
  group.add(core);

  const haloGeo = new THREE.SphereGeometry(radius * 1.32, 18, 14);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.userData.noOutline = true;
  group.add(halo);

  const leafGeo = createLeafBladeGeometry(radius * 1.5, radius * 0.72, radius * 0.14);
  const ring = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const lf = new THREE.Mesh(leafGeo, leafMat);
    lf.position.set(Math.cos(a) * radius * 1.2, Math.sin(i * 1.5) * radius * 0.25, Math.sin(a) * radius * 1.2);
    lf.rotation.set(0.35, -a + Math.PI * 0.5, 0.2);
    addOutline(lf, 0.01, OUTLINE_COLOR);
    ring.add(lf);
  }
  group.add(ring);

  return {
    group,
    ring,
    dispose() {
      coreGeo.dispose();
      haloGeo.dispose();
      leafGeo.dispose();
      coreMat.dispose();
      haloMat.dispose();
      leafMat.dispose();
    },
  };
}

/**
 * Crea el proyectil de semilla veloz disparado por el Brote Escupesemillas.
 */
export function createSeedProjectileMesh() {
  const group = new THREE.Group();
  const seedMat = createToonMaterial('#d9f99d', {
    emissive: '#4ade80',
    emissiveIntensity: 0.45,
  });
  const huskMat = createToonMaterial(NATURE_PALETTE.deepForest);
  const glowMat = createEnergyVFXMaterial({
    coreColor: '#bef264',
    rimColor: '#22c55e',
    opacity: 0.48,
    additive: true,
    softEdge: true,
  });

  const coreGeo = new THREE.SphereGeometry(0.16, 14, 10);
  coreGeo.scale(0.85, 0.85, 1.38);
  const core = new THREE.Mesh(coreGeo, seedMat);
  addOutline(core, 0.01, OUTLINE_COLOR);

  const glowGeo = new THREE.SphereGeometry(0.22, 12, 10);
  glowGeo.scale(0.85, 0.85, 1.38);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.userData.noOutline = true;

  const collarGeo = new THREE.ConeGeometry(0.14, 0.22, 8);
  collarGeo.rotateX(-Math.PI * 0.5);
  const collar = new THREE.Mesh(collarGeo, huskMat);
  collar.position.z = -0.14;
  addOutline(collar, 0.01, OUTLINE_COLOR);

  group.add(core, glow, collar);
  return {
    group,
    dispose() {
      coreGeo.dispose();
      glowGeo.dispose();
      collarGeo.dispose();
      seedMat.dispose();
      huskMat.dispose();
      glowMat.dispose();
    },
  };
}

/**
 * Construye una Planta Carnívora / Escupesemillas orgánica y articulada:
 *  - Base de raíces curvadas con grosor decreciente + roseta de hojas con nervadura.
 *  - Tallo curvo orgánico de grosor decreciente + hojas laterales.
 *  - Capullo / cabeza orientable (`headPivot`) con pétalos en capas superpuestas y garganta luminosa.
 */
export function createSpitterPlantRig() {
  const root = new THREE.Group();
  const disposables = [];

  const stemTex = createWoodPlankTexture({
    baseColor: NATURE_PALETTE.deepForest,
    grainColor: NATURE_PALETTE.forestDark,
    highlightColor: NATURE_PALETTE.emerald,
    planks: 4,
    repeatX: 1,
    repeatY: 3,
  });

  const leafDarkMat = createToonMaterial(NATURE_PALETTE.deepForest);
  const leafBrightMat = createToonMaterial(NATURE_PALETTE.emerald);
  const stemMat = createToonMaterial(NATURE_PALETTE.deepForest, { map: stemTex });
  const barkMat = createToonMaterial(NATURE_PALETTE.bark);
  const sepalMat = createToonMaterial(NATURE_PALETTE.brightLeaf, {
    emissive: '#2d6a4f',
    emissiveIntensity: 0.22,
  });
  const petalMat = createToonMaterial('#a7f3d0', {
    emissive: '#22c55e',
    emissiveIntensity: 0.25,
  });
  const mouthMat = createEnergyVFXMaterial({
    coreColor: '#d9f99d',
    rimColor: '#16a34a',
    opacity: 0.94,
    additive: true,
    depthWrite: false,
  });
  const toothMat = createToonMaterial(NATURE_PALETTE.thornTip);
  const allFlashable = [leafDarkMat, leafBrightMat, stemMat, barkMat, sepalMat, petalMat, toothMat];
  disposables.push(...allFlashable, mouthMat);

  // Montículo redondeado y raíces orgánicas abrazando el suelo (y = 0)
  const moundGeo = new THREE.SphereGeometry(0.46, 14, 10);
  moundGeo.scale(1.0, 0.34, 1.0);
  const mound = new THREE.Mesh(moundGeo, barkMat);
  mound.position.y = 0.08;
  mound.castShadow = true;
  mound.receiveShadow = true;
  addOutline(mound, 0.011, OUTLINE_COLOR);
  root.add(mound);
  disposables.push(moundGeo);

  // Roseta de 6 hojas en la base con nervadura central
  const baseLeafGeo = createLeafBladeGeometry(0.76, 0.34, 0.042);
  disposables.push(baseLeafGeo);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(baseLeafGeo, i % 2 === 0 ? leafDarkMat : leafBrightMat);
    leaf.position.set(Math.cos(ang) * 0.38, 0.14, Math.sin(ang) * 0.38);
    leaf.rotation.set(0.32, -ang + Math.PI * 0.5, 0);
    leaf.castShadow = true;
    addOutline(leaf, 0.01, OUTLINE_COLOR);
    root.add(leaf);
  }

  // Tallo curvo orgánico con grosor decreciente hacia el capullo
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.12, 0),
    new THREE.Vector3(0.08, 0.52, -0.06),
    new THREE.Vector3(-0.05, 0.92, 0.04),
    new THREE.Vector3(0, 1.24, 0.06),
  ]);
  const stemGeo = createOrganicVineTubeGeometry(stemCurve, 14, 0.115, 0.075, 10);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.castShadow = true;
  addOutline(stem, 0.011, OUTLINE_COLOR);
  root.add(stem);
  disposables.push(stemGeo);

  // Dos hojas laterales articuladas saliendo del tallo
  const sideLeafGeo = createLeafBladeGeometry(0.48, 0.22, 0.032);
  disposables.push(sideLeafGeo);
  for (const s of [-1, 1]) {
    const sl = new THREE.Mesh(sideLeafGeo, leafBrightMat);
    sl.position.set(s * 0.16, 0.72, 0);
    sl.rotation.set(0.28, s * 1.15, s * 0.35);
    sl.castShadow = true;
    addOutline(sl, 0.01, OUTLINE_COLOR);
    root.add(sl);
  }

  // Cabeza / capullo orientable (`headPivot` en la cima del tallo)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.24, 0.06);
  root.add(headPivot);

  const bulbGroup = new THREE.Group();
  headPivot.add(bulbGroup);

  const bulbGeo = new THREE.SphereGeometry(0.29, 18, 14);
  bulbGeo.scale(1.0, 0.95, 1.24);
  const bulb = new THREE.Mesh(bulbGeo, sepalMat);
  bulb.castShadow = true;
  addOutline(bulb, 0.011, OUTLINE_COLOR);
  bulbGroup.add(bulb);
  disposables.push(bulbGeo);

  // Collar de 6 pétalos en capas rodeando el capullo
  const petalGeo = createLeafBladeGeometry(0.42, 0.22, 0.03);
  disposables.push(petalGeo);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, i % 2 === 0 ? petalMat : leafBrightMat);
    petal.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.08);
    petal.rotation.set(-Math.PI * 0.38, 0, a - Math.PI * 0.5);
    addOutline(petal, 0.009, OUTLINE_COLOR);
    bulbGroup.add(petal);
  }

  // Boca / cañón delantero (+Z) con brillo energético interno sin contorno
  const rimGeo = new THREE.TorusGeometry(0.17, 0.055, 10, 20);
  const rim = new THREE.Mesh(rimGeo, leafDarkMat);
  rim.position.z = 0.28;
  addOutline(rim, 0.011, OUTLINE_COLOR);
  bulbGroup.add(rim);
  disposables.push(rimGeo);

  const throatGeo = new THREE.CircleGeometry(0.16, 18);
  const throat = new THREE.Mesh(throatGeo, mouthMat);
  throat.position.z = 0.295;
  throat.userData.noOutline = true;
  bulbGroup.add(throat);
  disposables.push(throatGeo);

  // 4 dientes / espinas alrededor de la boca + cresta dorsal
  const toothGeo = new THREE.ConeGeometry(0.038, 0.11, 5);
  disposables.push(toothGeo);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const t = new THREE.Mesh(toothGeo, toothMat);
    t.position.set(Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.315);
    t.rotation.set(Math.PI * 0.42, 0, a - Math.PI * 0.5);
    addOutline(t, 0.008, OUTLINE_COLOR);
    bulbGroup.add(t);
  }

  const crestGeo = createLeafBladeGeometry(0.4, 0.18, 0.03);
  disposables.push(crestGeo);
  const crest = new THREE.Mesh(crestGeo, leafBrightMat);
  crest.position.set(0, 0.25, -0.08);
  crest.rotation.set(-0.48, Math.PI, 0);
  addOutline(crest, 0.01, OUTLINE_COLOR);
  bulbGroup.add(crest);

  return {
    root,
    headPivot,
    bulbGroup,
    flash() {
      for (const m of allFlashable) {
        m.emissive.set('#ffffff');
        m.emissiveIntensity = 0.75;
      }
    },
    clearFlash() {
      leafDarkMat.emissive.set('#000000');
      leafDarkMat.emissiveIntensity = 0;
      leafBrightMat.emissive.set('#000000');
      leafBrightMat.emissiveIntensity = 0;
      stemMat.emissive.set('#000000');
      stemMat.emissiveIntensity = 0;
      barkMat.emissive.set('#000000');
      barkMat.emissiveIntensity = 0;
      sepalMat.emissive.set('#2d6a4f');
      sepalMat.emissiveIntensity = 0.22;
      petalMat.emissive.set('#22c55e');
      petalMat.emissiveIntensity = 0.25;
      toothMat.emissive.set('#000000');
      toothMat.emissiveIntensity = 0;
    },
    dispose() {
      if (root.parent) root.parent.remove(root);
      for (const d of disposables) {
        if (d && d.dispose) d.dispose();
      }
    },
  };
}
