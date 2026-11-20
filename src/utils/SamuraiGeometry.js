import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * SamuraiGeometry
 * ----------------------------------------------------------------------
 * Geometrías procedurales anime / cel-shaded para el 10.º personaje
 * jugable (El Samurái):
 *  - Katana curva con guarda tsuba dorada y vaina (saya)
 *  - Conjunto completo de Armadura del Shōgun 3D (kabuto, sode, dō, kote)
 *  - Arcos de corte energéticos (horizontal, diagonal, giro 360°)
 *  - Kunai metálico facetado y cadena dinámica articulada + espiral de captura
 *  - Onda cortante de media luna
 */

export const SAMURAI_PALETTE = {
  crimson: '#991b1b',
  brightCrimson: '#ef4444',
  charcoal: '#111827',
  steel: '#cbd5e1',
  brightSteel: '#f8fafc',
  gold: '#eab308',
  rivalIndigo: '#1e3a8a',
  rivalObsidian: '#09090b',
  rivalSilver: '#e2e8f0',
  rivalBronze: '#d97706',
};

/** Crea la Katana curva 3D para empuñar en la mano derecha */
export function createKatanaGroup(isRival = false) {
  const group = new THREE.Group();
  group.name = 'SamuraiKatana';

  const bladeMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalSilver : SAMURAI_PALETTE.brightSteel, {
    emissive: isRival ? '#93c5fd' : '#e2e8f0',
    emissiveIntensity: 0.18,
  });
  const spineMat = createToonMaterial(isRival ? '#475569' : '#334155');
  const goldMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold, {
    emissive: isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold,
    emissiveIntensity: 0.16,
  });
  const wrapMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalIndigo : SAMURAI_PALETTE.crimson);

  // Empuñadura (tsuka)
  const hiltGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.24, 12);
  const hilt = new THREE.Mesh(hiltGeo, wrapMat);
  hilt.position.set(0, -0.02, -0.06);
  hilt.rotation.x = Math.PI * 0.5;
  group.add(hilt);

  // Pomo (kashira)
  const pommelGeo = new THREE.SphereGeometry(0.022, 10, 8);
  const pommel = new THREE.Mesh(pommelGeo, goldMat);
  pommel.position.set(0, -0.02, -0.18);
  group.add(pommel);

  // Guarda (tsuba) ovalada
  const tsubaGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.014, 16);
  const tsuba = new THREE.Mesh(tsubaGeo, goldMat);
  tsuba.scale.set(0.86, 1, 1.12);
  tsuba.rotation.x = Math.PI * 0.5;
  tsuba.position.set(0, -0.02, 0.065);
  group.add(tsuba);

  // Hoja curva (extrude en plano YZ -> apuntando hacia +Z con leve curvatura hacia +Y)
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.014);
  bladeShape.quadraticCurveTo(0.42, -0.008, 0.84, 0.055);
  bladeShape.lineTo(0.92, 0.088); // punta kissaki
  bladeShape.quadraticCurveTo(0.45, 0.024, 0, 0.018);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 14,
  });
  // Rota de XY a ZY para que apunte hacia +Z
  bladeGeo.rotateY(-Math.PI * 0.5);
  bladeGeo.translate(0.004, -0.02, 0.07);
  bladeGeo.computeVertexNormals();

  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  group.add(blade);

  // Lomo metálico (mune) sutil
  const collarGeo = new THREE.BoxGeometry(0.016, 0.028, 0.04);
  const collar = new THREE.Mesh(collarGeo, spineMat);
  collar.position.set(0, -0.02, 0.085);
  group.add(collar);

  return {
    group,
    materials: [bladeMat, spineMat, goldMat, wrapMat],
    geometries: [hiltGeo, pommelGeo, tsubaGeo, bladeGeo, collarGeo],
  };
}

/** Crea la vaina (saya) curva para la cadera izquierda */
export function createSayaGroup(isRival = false) {
  const group = new THREE.Group();
  const sayaMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalObsidian : SAMURAI_PALETTE.charcoal);
  const goldMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold);
  const cordMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalIndigo : SAMURAI_PALETTE.crimson);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.04, 0.16),
    new THREE.Vector3(0, 0.0, -0.18),
    new THREE.Vector3(0, 0.03, -0.58),
  ]);
  const tubeGeo = new THREE.TubeGeometry(curve, 14, 0.022, 10, false);
  const tube = new THREE.Mesh(tubeGeo, sayaMat);
  group.add(tube);

  const tipGeo = new THREE.CylinderGeometry(0.024, 0.02, 0.05, 10);
  tipGeo.rotateX(Math.PI * 0.5);
  const tip = new THREE.Mesh(tipGeo, goldMat);
  tip.position.set(0, 0.032, -0.59);
  group.add(tip);

  const knotGeo = new THREE.TorusGeometry(0.027, 0.008, 8, 16);
  const knot = new THREE.Mesh(knotGeo, cordMat);
  knot.position.set(0, 0.02, 0.02);
  group.add(knot);

  return {
    group,
    materials: [sayaMat, goldMat, cordMat],
    geometries: [tubeGeo, tipGeo, knotGeo],
  };
}

/**
 * Construye las piezas 3D de Armadura del Shōgun para montar sobre el rig
 * (`helmet`, `cuirass`, `shoulderL`, `shoulderR`, `koteL`, `koteR`).
 */
export function createShogunArmorParts(isRival = false) {
  const plateColor = isRival ? SAMURAI_PALETTE.rivalIndigo : SAMURAI_PALETTE.crimson;
  const darkMetalColor = isRival ? SAMURAI_PALETTE.rivalObsidian : '#1e293b';
  const trimColor = isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold;

  const plateMat = createToonMaterial(plateColor, {
    emissive: plateColor,
    emissiveIntensity: 0.18,
  });
  const darkMat = createToonMaterial(darkMetalColor);
  const goldMat = createToonMaterial(trimColor, {
    emissive: trimColor,
    emissiveIntensity: 0.25,
  });

  const disposables = [plateMat, darkMat, goldMat];

  // 1. Casco Kabuto + Faldón Shikoro + Cresta Lunar Kuwagata
  const helmet = new THREE.Group();
  const domeGeo = new THREE.SphereGeometry(0.245, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const dome = new THREE.Mesh(domeGeo, darkMat);
  dome.position.set(0, 0.055, -0.005);
  helmet.add(dome);

  const visorGeo = new THREE.CylinderGeometry(0.245, 0.265, 0.055, 20, 1, true, Math.PI * 0.65, Math.PI * 0.7);
  const visor = new THREE.Mesh(visorGeo, plateMat);
  visor.position.set(0, 0.06, 0.02);
  helmet.add(visor);

  // Faldón trasero protector (shikoro) en 2 láminas curvas
  for (let tier = 0; tier < 2; tier++) {
    const shGeo = new THREE.CylinderGeometry(
      0.245 + tier * 0.028,
      0.278 + tier * 0.032,
      0.068,
      18,
      1,
      true,
      Math.PI * 0.34,
      Math.PI * 1.32
    );
    const sh = new THREE.Mesh(shGeo, tier === 0 ? plateMat : darkMat);
    sh.position.set(0, 0.015 - tier * 0.052, -0.015);
    sh.rotation.y = Math.PI;
    sh.rotation.x = 0.16;
    helmet.add(sh);
    disposables.push(shGeo);
  }

  // Cresta lunar dorada (kuwagata)
  const crestGeo = new THREE.TorusGeometry(0.13, 0.018, 8, 22, Math.PI * 1.15);
  const crest = new THREE.Mesh(crestGeo, goldMat);
  crest.position.set(0, 0.21, 0.205);
  crest.rotation.z = -Math.PI * 0.075;
  crest.rotation.x = -0.22;
  helmet.add(crest);

  const emblemGeo = new THREE.OctahedronGeometry(0.034, 0);
  const emblem = new THREE.Mesh(emblemGeo, goldMat);
  emblem.position.set(0, 0.145, 0.225);
  helmet.add(emblem);
  disposables.push(domeGeo, visorGeo, crestGeo, emblemGeo);

  // 2. Coraza pectoral (dō)
  const cuirass = new THREE.Group();
  const chestPlateGeo = new THREE.CylinderGeometry(0.215, 0.18, 0.34, 18, 1);
  chestPlateGeo.scale(1.18, 1, 0.88);
  const chestPlate = new THREE.Mesh(chestPlateGeo, darkMat);
  chestPlate.position.set(0, 0.18, 0);
  cuirass.add(chestPlate);

  for (let r = 0; r < 2; r++) {
    const ribGeo = new THREE.TorusGeometry(0.205 - r * 0.012, 0.013, 8, 22);
    ribGeo.rotateX(Math.PI * 0.5);
    ribGeo.scale(1.18, 1, 0.88);
    const rib = new THREE.Mesh(ribGeo, r === 0 ? goldMat : plateMat);
    rib.position.set(0, 0.26 - r * 0.1, 0);
    cuirass.add(rib);
    disposables.push(ribGeo);
  }
  disposables.push(chestPlateGeo);

  // 3. Hombreras laminadas (sode) izquierda y derecha
  const makeSode = (sideSign) => {
    const sode = new THREE.Group();
    for (let layer = 0; layer < 3; layer++) {
      const sGeo = new THREE.CylinderGeometry(
        0.105 + layer * 0.012,
        0.118 + layer * 0.014,
        0.068,
        12,
        1,
        true,
        -Math.PI * 0.42,
        Math.PI * 0.84
      );
      const sMesh = new THREE.Mesh(sGeo, layer === 1 ? darkMat : plateMat);
      sMesh.rotation.y = sideSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      sMesh.rotation.z = sideSign * 0.24;
      sMesh.position.set(sideSign * (0.042 + layer * 0.012), 0.03 - layer * 0.06, 0);
      sode.add(sMesh);
      disposables.push(sGeo);
    }
    const trimGeo = new THREE.BoxGeometry(0.022, 0.16, 0.13);
    const trim = new THREE.Mesh(trimGeo, goldMat);
    trim.position.set(sideSign * 0.135, -0.03, 0);
    trim.rotation.z = sideSign * 0.22;
    sode.add(trim);
    disposables.push(trimGeo);
    return sode;
  };
  const shoulderL = makeSode(1);
  const shoulderR = makeSode(-1);

  // 4. Brazales (kote)
  const makeKote = () => {
    const g = new THREE.Group();
    const guardGeo = new THREE.CylinderGeometry(0.062, 0.052, 0.18, 12);
    const guard = new THREE.Mesh(guardGeo, plateMat);
    guard.position.set(0, -0.13, 0);
    g.add(guard);
    const ringGeo = new THREE.TorusGeometry(0.058, 0.008, 8, 16);
    ringGeo.rotateX(Math.PI * 0.5);
    const ring = new THREE.Mesh(ringGeo, goldMat);
    ring.position.set(0, -0.055, 0);
    g.add(ring);
    disposables.push(guardGeo, ringGeo);
    return g;
  };
  const koteL = makeKote();
  const koteR = makeKote();

  return {
    helmet,
    cuirass,
    shoulderL,
    shoulderR,
    koteL,
    koteR,
    disposables,
  };
}

/**
 * Estela creciente afilada para tajos de katana (sin bordes negros).
 */
export function createSlashArcGroup(radius = 3.6, arcAngle = Math.PI * 0.72, isCrimson = true, isSpin360 = false) {
  const group = new THREE.Group();

  const innerR = radius * (isSpin360 ? 0.58 : 0.66);
  const outerR = radius;
  const segments = isSpin360 ? 44 : 26;
  const startAng = -arcAngle * 0.5;

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = startAng + t * arcAngle;
    const taper = isSpin360 ? 0.85 + 0.15 * Math.sin(t * Math.PI) : Math.sin(t * Math.PI);
    const curInner = THREE.MathUtils.lerp(outerR, innerR, taper);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);

    positions.push(sin * curInner, 0, cos * curInner);
    positions.push(sin * outerR, 0.03 * taper, cos * outerR);
    uvs.push(t, 0, t, 1);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: isCrimson ? SAMURAI_PALETTE.brightCrimson : SAMURAI_PALETTE.gold,
    opacity: 0.92,
    fresnelPower: 1.35,
    rimIntensity: 1.5,
    additive: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noOutline = true;
  group.add(mesh);

  return {
    group,
    mat,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Kunai metálico facetado con anilla dorada (usado como punta de Cadena Kunai).
 */
export function createChainedKunaiGroup(isRival = false) {
  const group = new THREE.Group();

  const metalMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalSilver : SAMURAI_PALETTE.brightSteel, {
    flatShading: true,
    emissive: '#ffffff',
    emissiveIntensity: 0.18,
  });
  const goldMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold, {
    emissive: SAMURAI_PALETTE.gold,
    emissiveIntensity: 0.25,
  });
  const glowMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: isRival ? '#60a5fa' : SAMURAI_PALETTE.brightCrimson,
    opacity: 0.72,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  // Punta de kunai en diamante afilado apuntando hacia +Z
  const bladeGeo = new THREE.ConeGeometry(0.11, 0.44, 4);
  bladeGeo.rotateX(Math.PI * 0.5);
  bladeGeo.scale(1.0, 0.55, 1.0);
  const blade = new THREE.Mesh(bladeGeo, metalMat);
  blade.position.z = 0.16;
  group.add(blade);

  const hiltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8);
  hiltGeo.rotateX(Math.PI * 0.5);
  const hilt = new THREE.Mesh(hiltGeo, metalMat);
  hilt.position.z = -0.14;
  group.add(hilt);

  const ringGeo = new THREE.TorusGeometry(0.055, 0.015, 8, 16);
  const ring = new THREE.Mesh(ringGeo, goldMat);
  ring.position.z = -0.28;
  group.add(ring);

  const auraGeo = new THREE.SphereGeometry(0.22, 12, 10);
  const aura = new THREE.Mesh(auraGeo, glowMat);
  aura.scale.set(0.9, 0.65, 1.8);
  aura.userData.noOutline = true;
  group.add(aura);

  return {
    group,
    dispose() {
      bladeGeo.dispose();
      hiltGeo.dispose();
      ringGeo.dispose();
      auraGeo.dispose();
      metalMat.dispose();
      goldMat.dispose();
      glowMat.dispose();
    },
  };
}

/**
 * Cadena metálica dinámica de eslabones + haz energético sutil entre dos puntos.
 */
export function createDynamicChainMesh(linkCount = 18) {
  const group = new THREE.Group();
  const linkGeo = new THREE.TorusGeometry(0.052, 0.017, 6, 12);
  const linkMat = createToonMaterial(SAMURAI_PALETTE.steel, {
    emissive: '#94a3b8',
    emissiveIntensity: 0.22,
  });
  const links = [];
  for (let i = 0; i < linkCount; i++) {
    const m = new THREE.Mesh(linkGeo, linkMat);
    m.userData.noOutline = true;
    group.add(m);
    links.push(m);
  }

  // Halo energético fino uniendo los extremos
  const beamGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8, 1, true);
  beamGeo.rotateX(Math.PI * 0.5);
  const beamMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: SAMURAI_PALETTE.brightCrimson,
    opacity: 0.45,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.userData.noOutline = true;
  group.add(beam);

  return {
    group,
    links,
    beam,
    dispose() {
      linkGeo.dispose();
      beamGeo.dispose();
      linkMat.dispose();
      beamMat.dispose();
    },
  };
}

const _chainDir = new THREE.Vector3();
const _chainMid = new THREE.Vector3();

/** Posiciona y orienta la cadena entre `startPos` y `endPos` */
export function updateChainMesh(chainData, startPos, endPos, time = 0, sag = 0.08) {
  if (!chainData || !chainData.links) return;
  _chainDir.subVectors(endPos, startPos);
  const dist = _chainDir.length();
  const n = chainData.links.length;
  if (dist < 0.05) {
    chainData.group.visible = false;
    return;
  }
  chainData.group.visible = true;

  _chainMid.copy(startPos).lerp(endPos, 0.5);
  chainData.beam.position.copy(_chainMid);
  chainData.beam.scale.set(1, 1, dist);
  chainData.beam.lookAt(endPos);

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const link = chainData.links[i];
    const arcY = -Math.sin(t * Math.PI) * sag * Math.min(1, dist * 0.12);
    const wave = Math.sin(time * 24 + t * 8) * (sag * 0.35);
    link.position.lerpVectors(startPos, endPos, t);
    link.position.y += arcY;
    link.position.x += wave * (1 - t);
    link.lookAt(endPos);
    if (i % 2 === 1) link.rotateZ(Math.PI * 0.5);
  }
}

/** Espiral de eslabones que envuelve brevemente al enemigo atrapado por Cadena Kunai */
export function createChainWrapGroup(scale = 1.0) {
  const group = new THREE.Group();
  const mat = createToonMaterial(SAMURAI_PALETTE.steel, {
    emissive: '#f8fafc',
    emissiveIntensity: 0.25,
  });
  const glowMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: SAMURAI_PALETTE.gold,
    opacity: 0.7,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });

  const ringGeo = new THREE.TorusGeometry(0.54 * scale, 0.032 * scale, 8, 22);
  const ring1 = new THREE.Mesh(ringGeo, mat);
  ring1.position.y = 0.92 * scale;
  ring1.rotation.set(Math.PI * 0.5 + 0.28, 0.22, 0);
  const ring2 = new THREE.Mesh(ringGeo, mat);
  ring2.position.y = 1.15 * scale;
  ring2.rotation.set(Math.PI * 0.5 - 0.32, -0.25, 0);
  const ring3 = new THREE.Mesh(ringGeo, glowMat);
  ring3.position.y = 1.04 * scale;
  ring3.rotation.x = Math.PI * 0.5;
  ring3.userData.noOutline = true;

  group.add(ring1, ring2, ring3);

  return {
    group,
    dispose() {
      ringGeo.dispose();
      mat.dispose();
      glowMat.dispose();
    },
  };
}

/** Onda cortante de media luna que viaja a distancia (Shōgun / Espíritu Bushidō) */
export function createBladeWaveGroup(width = 2.6, isCrimson = true) {
  const group = new THREE.Group();
  const arc = createSlashArcGroup(width * 0.55, Math.PI * 0.82, isCrimson, false);
  arc.group.position.z = -width * 0.22;
  group.add(arc.group);

  return {
    group,
    dispose() {
      arc.dispose();
    },
  };
}
