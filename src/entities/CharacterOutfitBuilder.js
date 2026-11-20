import * as THREE from 'three';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';
import { createLeafBladeGeometry, NATURE_PALETTE } from '../utils/NatureGeometry.js';
import { createRuneHaloGroup, PSYCHIC_PALETTE } from '../utils/PsychicGeometry.js';
import { STORM_PALETTE } from '../utils/StormGeometry.js';
import { LIGHT_PALETTE } from '../utils/LightGeometry.js';
import { SHADOW_PALETTE } from '../utils/ShadowGeometry.js';
import {
  SAMURAI_PALETTE,
  createKatanaGroup,
  createSayaGroup,
} from '../utils/SamuraiGeometry.js';

/**
 * CharacterOutfitBuilder
 * ----------------------------------------------------------------------
 * Constructor modular de anatomía suave estilo anime moderno
 * (Avatar / Zelda Wind Waker / Genshin Impact) con geometrías `LatheGeometry`
 * de 24–32 segmentos, hombreras y faldones curvos biselados, rostros expresivos
 * con brillo especular sin contornos sucios, peinados únicos esculpidos por
 * elemento y soporte de telas ondulantes secundarias.
 */

export const CHARACTER_OUTLINE_THICKNESS = 0.013;
export const DETAIL_OUTLINE_THICKNESS = 0.0075;
export const HEAD_OUTLINE_THICKNESS = 0.0062;
export const CHARACTER_OUTLINE_COLOR = 0x1b2028;

export function resolveElementFromTheme(themeName) {
  if (typeof themeName !== 'string') return { element: 'earth', isRival: false };
  const lower = themeName.toLowerCase();
  const isRival = lower.includes('rival');
  if (lower.startsWith('water')) return { element: 'water', isRival };
  if (lower.startsWith('fire')) return { element: 'fire', isRival };
  if (lower.startsWith('air')) return { element: 'air', isRival };
  if (lower.startsWith('nature')) return { element: 'nature', isRival };
  if (lower.startsWith('psychic')) return { element: 'psychic', isRival };
  if (lower.startsWith('storm')) return { element: 'storm', isRival };
  if (lower.startsWith('light')) return { element: 'light', isRival };
  if (lower.startsWith('shadow')) return { element: 'shadow', isRival };
  if (lower.startsWith('samurai')) return { element: 'samurai', isRival };
  return { element: 'earth', isRival };
}

/**
 * Genera una geometría tubular ahusada a lo largo de una curva 3D para
 * mechones de cabello, coletas, cintas, cejas y pestañas curvas.
 */
export function createCurvedStrandGeo(
  points,
  rStart,
  rEnd,
  tubularSegments = 16,
  radialSegments = 12,
  flattenZ = 1
) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const indices = [];
  const P = new THREE.Vector3();
  const v = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const taper = t < 0.14 ? 0.72 + (t / 0.14) * 0.28 : 1 - (t - 0.14) / 0.86;
    const r = Math.max(0.0012, rEnd + (rStart - rEnd) * Math.max(0, taper));

    for (let j = 0; j <= radialSegments; j++) {
      const ang = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang) * flattenZ;
      v.x = P.x + r * (cos * N.x + sin * B.x);
      v.y = P.y + r * (cos * N.y + sin * B.y);
      v.z = P.z + r * (cos * N.z + sin * B.z);
      positions.push(v.x, v.y, v.z);
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
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Agrega un Mesh hijo registrado en `tracker` */
function addTrackedMesh(parent, geo, mat, tracker, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = opts.castShadow !== false;
  m.receiveShadow = opts.receiveShadow !== false;
  if (opts.noOutline) m.userData.noOutline = true;
  if (opts.outlineThickness !== undefined) m.userData.outlineThickness = opts.outlineThickness;
  if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  parent.add(m);
  tracker.push(m);
  return m;
}

function registerClothWave(mesh, secondaryParts, length, phase = 0, amp = 1.0) {
  const pos = mesh?.geometry?.attributes?.position;
  if (!pos || !secondaryParts?.clothMeshes) return;
  secondaryParts.clothMeshes.push({
    mesh,
    basePos: new Float32Array(pos.array),
    length,
    phase,
    amp,
  });
}

// ============================================================================
//  Geometrías Anatómicas Suavizadas (`LatheGeometry` 24–32 segs) y Esculpidas
// ============================================================================

/**
 * Construye una extremidad o pieza cilíndrica orgánica mediante `LatheGeometry`
 * de alta resolución (`28` segmentos radiales) con tapas redondeadas y perfil
 * anatómico personalizable sin costuras ni bordes duros.
 */
function createLatheLimbGeometry(
  rTop,
  rBottom,
  length,
  {
    radialSegments = 28,
    heightSegments = 14,
    scaleX = 1,
    scaleZ = 1,
    bellyAmp = 0.14,
    bellyPeak = 0.36,
    capRound = 0.014,
  } = {}
) {
  const pts = [];
  const capSteps = 3;
  // Tapa superior redondeada en y = 0 -> -capRound
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI * 0.5);
    pts.push(new THREE.Vector2(Math.sin(a) * rTop * 0.96, -capRound * (1 - Math.cos(a))));
  }
  // Cuerpo muscular principal
  for (let i = 1; i < heightSegments; i++) {
    const u = i / heightSegments;
    const baseR = THREE.MathUtils.lerp(rTop, rBottom, u);
    const wave = Math.sin(Math.pow(u, bellyPeak < 0.4 ? 0.72 : 1.0) * Math.PI);
    const r = Math.max(0.004, baseR * (1 + wave * bellyAmp));
    const y = -capRound - u * (length - capRound * 2);
    pts.push(new THREE.Vector2(r, y));
  }
  // Tapa inferior redondeada hasta -length
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI * 0.5);
    pts.push(
      new THREE.Vector2(
        Math.max(0, Math.cos(a) * rBottom * 0.96),
        -(length - capRound) - Math.sin(a) * capRound
      )
    );
  }

  const geo = new THREE.LatheGeometry(pts.reverse(), radialSegments);
  if (scaleX !== 1 || scaleZ !== 1) {
    geo.scale(scaleX, 1, scaleZ);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createAthleticChestGeometry() {
  const height = 0.405;
  const geo = new THREE.SphereGeometry(1, 36, 28);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = (v.y + 1) * 0.5;
    const ny = (u - 0.5) * 2;
    const horizLen = Math.hypot(v.x, v.z);
    const dirX = horizLen > 1e-5 ? v.x / horizLen : 0;
    const dirZ = horizLen > 1e-5 ? v.z / horizLen : 0;

    let halfW;
    if (u < 0.70) {
      const t = u / 0.70;
      halfW = 0.140 + (0.242 - 0.140) * Math.pow(Math.sin(t * Math.PI * 0.5), 0.85);
    } else {
      const t = (u - 0.70) / 0.30;
      halfW = 0.242 - (0.242 - 0.058) * Math.pow(t, 1.32);
    }

    let halfD;
    if (u < 0.62) {
      const t = u / 0.62;
      halfD = 0.098 + (0.138 - 0.098) * Math.sin(t * Math.PI * 0.5);
    } else {
      const t = (u - 0.62) / 0.38;
      halfD = 0.138 - (0.138 - 0.056) * Math.pow(t, 1.35);
    }

    let x = dirX * halfW;
    let z = dirZ * halfD;
    let y = u * height;

    // Pectorales esculpidos y surco suave del esternón (+Z)
    if (dirZ > 0.14 && u > 0.22 && u < 0.76) {
      const pecV = Math.sin(((u - 0.22) / 0.54) * Math.PI);
      const sternonDip = 1 - Math.exp(-Math.pow(dirX * 4.2, 2)) * 0.36;
      z += 0.022 * pecV * dirZ * sternonDip;
    }

    // Relieve orgánico de clavículas
    if (dirZ > 0.24 && u > 0.72 && u < 0.86 && Math.abs(dirX) > 0.18) {
      z += 0.008 * Math.sin(((u - 0.72) / 0.14) * Math.PI);
    }

    // Dorsales en V y línea vertebral en la espalda (-Z)
    if (dirZ < -0.15 && u > 0.1 && u < 0.86) {
      const spineGroove = Math.exp(-Math.pow(dirX * 4.8, 2)) * 0.015;
      const latsBulge = Math.sin(((u - 0.14) / 0.72) * Math.PI) * Math.min(1, Math.abs(dirX) * 1.4) * 0.013;
      z += spineGroove - latsBulge;
    }

    if (u > 0.68) {
      y -= Math.pow(Math.abs(dirX), 1.4) * 0.028 * ((u - 0.68) / 0.32);
    }
    if (ny < -0.85) y = Math.max(-0.022, y);

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createAthleticAbdomenGeometry() {
  const height = 0.265;
  const pts = [];
  const segs = 14;
  pts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const waistCurve = Math.sin(u * Math.PI);
    const r = 0.138 + u * 0.012 - waistCurve * 0.011;
    pts.push(new THREE.Vector2(r, u * height));
  }
  pts.push(new THREE.Vector2(0, height));

  const geo = new THREE.LatheGeometry(pts, 30);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp(v.y / height, 0, 1);
    const r = Math.hypot(v.x, v.z);
    if (r < 1e-5) continue;
    const dx = v.x / r;
    const dz = v.z / r;
    let z = v.z * 0.72;
    if (dz > 0.2 && u > 0.12 && u < 0.88) {
      const absGroove = 1 - Math.exp(-Math.pow(dx * 5.0, 2)) * 0.2;
      z += 0.007 * dz * absGroove;
    } else if (dz < -0.25) {
      z += Math.sin(u * Math.PI) * 0.009;
    }
    pos.setXYZ(i, v.x, v.y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createPelvisGeometry() {
  const geo = new THREE.SphereGeometry(1, 30, 20);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    pos.setXYZ(i, v.x * 0.155, v.y * 0.108, v.z * 0.111);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createFittedSashGeometry(rx = 0.144, rz = 0.104, height = 0.088) {
  const pts = [
    new THREE.Vector2(0.88, -height * 0.5),
    new THREE.Vector2(0.99, -height * 0.44),
    new THREE.Vector2(1.035, 0),
    new THREE.Vector2(0.99, height * 0.44),
    new THREE.Vector2(0.88, height * 0.5),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  geo.scale(rx, 1, rz);
  geo.computeVertexNormals();
  return geo;
}

export function createDeltoidGeometry(sideSign = 1, radius = 0.082) {
  const geo = new THREE.SphereGeometry(radius, 26, 18);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.x * 1.0;
    const y = v.y * 1.2 - 0.022;
    let z = v.z * 1.04;
    if (v.y < 0) {
      const t = Math.min(1, -v.y / radius);
      x *= 1 - t * 0.2;
      z *= 1 - t * 0.14;
    }
    // Ensancha hacia adentro para sellar la unión axila/torso incluso al alzar el brazo
    if (v.x * sideSign < 0) x *= 1.26;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createTaperedLimbGeometry(rTop, rBottom, length, scaleX = 1, scaleZ = 1) {
  return createLatheLimbGeometry(rTop, rBottom, length, {
    radialSegments: 28,
    heightSegments: 14,
    scaleX,
    scaleZ,
    bellyAmp: 0.14,
    capRound: Math.min(0.015, length * 0.06),
  });
}

function createSculptedNeckGeometry() {
  const len = 0.125;
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.048, -0.006),
    new THREE.Vector2(0.047, -0.036),
    new THREE.Vector2(0.053, -0.072),
    new THREE.Vector2(0.068, -0.106),
    new THREE.Vector2(0.072, -len),
    new THREE.Vector2(0.0, -len),
  ];
  const geo = new THREE.LatheGeometry(pts.reverse(), 26);
  geo.scale(1.02, 1, 0.96);
  geo.translate(0, 0.098, 0.004);
  geo.computeVertexNormals();
  return geo;
}

export function createSculptedHeadGeometry() {
  const geo = new THREE.SphereGeometry(0.114, 34, 26);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.x * 0.91;
    let y = v.y * 1.1;
    let z = v.z * 0.97;

    // Mandíbula anime estilizada y mentón suavemente redondeado (cero vértices picudos)
    if (v.y < 0.012) {
      const t = THREE.MathUtils.clamp((0.012 - v.y) / 0.126, 0, 1);
      const jawTaper = Math.sin(t * Math.PI * 0.5);
      x *= 1 - jawTaper * 0.42;
      z *= 1 - Math.pow(t, 1.15) * 0.2;
      if (z > 0) z += t * 0.014;
      y += Math.pow(t, 2.2) * 0.008; // Redondeo amable de barbilla
    }
    // Pómulos suaves y ligero puente nasal esculpido
    if (z > 0.074 && Math.abs(x) < 0.015 && y < 0.024 && y > -0.026) {
      const noseH = Math.max(0, 1 - Math.abs(x) / 0.015);
      const noseV = Math.max(0, Math.sin(((y + 0.026) / 0.05) * Math.PI));
      z += 0.009 * noseH * noseV;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crea un paño / faldón / bufanda suavemente curvado y biselado con múltiples
 * divisiones (`segW x segH`) para recibir ondas textiles sin vértices cuadrados.
 */
function createCurvedClothPanelGeo({
  width,
  height,
  thickness = 0.018,
  curveZ = 0.022,
  taperTop = 0.86,
  taperBottom = 1.12,
  segW = 6,
  segH = 8,
}) {
  const geo = new THREE.BoxGeometry(width, height, thickness, segW, segH, 1);
  geo.translate(0, -height * 0.5, 0);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const halfW = width * 0.5;
  const halfT = thickness * 0.5;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp(-v.y / height, 0, 1); // 0 arriba, 1 abajo
    const nx = halfW > 1e-5 ? v.x / halfW : 0; // -1..1
    const nz = halfT > 1e-5 ? v.z / halfT : 0; // -1..1

    const widthScale = THREE.MathUtils.lerp(taperTop, taperBottom, Math.pow(u, 0.85));
    // Redondeo orgánico en bordes laterales y esquina inferior
    const bottomRound = u > 0.84 ? (1 - Math.pow((u - 0.84) / 0.16, 2) * 0.16 * nx * nx) : 1;
    const x = v.x * widthScale * bottomRound;

    // Bisel suave en bordes laterales y punta inferior
    const edgeBevel = 1 - Math.pow(Math.abs(nx), 2.4) * 0.35 - (u > 0.88 ? ((u - 0.88) / 0.12) * 0.35 : 0);
    const zThickness = v.z * Math.max(0.45, edgeBevel);
    const archZ = Math.sin(u * Math.PI * 0.85) * curveZ - (nx * nx) * curveZ * 0.32;

    // Dobladillo inferior suave hacia atrás
    const yLift = u > 0.85 ? ((u - 0.85) / 0.15) * (nx * nx) * 0.008 : 0;

    pos.setXYZ(i, x, v.y + yLift, zThickness + archZ + nz * 0.001);
  }
  geo.userData.isSculpted = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Chal o cuello acolchado moldeado que cae suavemente sobre clavículas y hombros
 * sin sobresalir lateralmente como un aro rígido.
 */
function createDrapedShawlGeo({
  rx = 0.152,
  rz = 0.118,
  tubeR = 0.036,
  drapeFront = 0.032,
  drapeBack = 0.028,
  fluffRipple = 0.0,
} = {}) {
  const geo = new THREE.TorusGeometry(1, tubeR / rx, 14, 34);
  geo.rotateX(Math.PI * 0.5);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.x, v.z); // 0 frente (+Z), +-PI atrás (-Z)
    const cosA = Math.cos(a);
    let x = v.x * rx;
    let z = v.z * rz;
    let y = v.y * rx * 0.68;

    // Caída anatómica siguiendo clavículas al frente y omóplatos atrás
    if (cosA > 0) y -= cosA * drapeFront;
    else y -= -cosA * drapeBack;

    // Suave textura esponjosa opcional para cuello de piel blanca (Maestro Agua)
    if (fluffRipple > 0) {
      const wave = 1 + Math.sin(a * 9) * fluffRipple + Math.cos(a * 5) * (fluffRipple * 0.5);
      x *= wave;
      z *= wave;
      y += Math.sin(a * 9) * 0.005;
    }

    pos.setXYZ(i, x, y, z);
  }
  geo.userData.isSculpted = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crea una hombrera anatómica curva biselada que abraza el hombro sin bloques planos.
 */
function createSculptedPauldronGeo(
  sideSign,
  { width = 0.155, depth = 0.165, archH = 0.048, flare = 0.025 } = {}
) {
  const geo = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    // Remapeo a perfil elíptico ergonómico sobre el deltoides
    let x = v.x * (width * 0.52);
    let z = v.z * (depth * 0.52);
    let y = v.y * archH;

    // Alarga suavemente hacia el exterior del hombro (+sideSign)
    if (v.x * sideSign > 0) {
      x += sideSign * flare * Math.pow(Math.abs(v.x), 1.2);
      y -= Math.pow(Math.abs(v.x), 1.4) * 0.012;
    }
    // Borde inferior ligeramente engrosado estilo lámina curva
    if (r > 0.78 && v.y < 0.28) {
      x *= 1.05;
      z *= 1.05;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Hebilla o broche suavemente redondeado (cero cubos rectos) */
function createRoundedBuckleGeo(w = 0.068, h = 0.052, d = 0.022) {
  const geo = new THREE.SphereGeometry(0.5, 18, 12);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const sx = Math.sign(v.x) * Math.pow(Math.abs(v.x * 2), 0.55) * 0.5;
    const sy = Math.sign(v.y) * Math.pow(Math.abs(v.y * 2), 0.55) * 0.5;
    const sz = Math.sign(v.z) * Math.pow(Math.abs(v.z * 2), 0.65) * 0.5;
    pos.setXYZ(i, sx * w, sy * h, sz * d);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tira curva ceñida al contorno frontal del pecho/torso para solapas y petos
 * cruzados (abraza el pecho con curvatura natural sin sobresalir como tabla).
 */
function createContouredChestStrapGeo(width = 0.036, height = 0.31, depth = 0.022, wrapCurvature = 0.056) {
  const geo = new THREE.BoxGeometry(width, height, depth, 4, 12, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const uNorm = v.y / (height * 0.5 || 1); // -1..1
    const u01 = THREE.MathUtils.clamp((uNorm + 1) * 0.5, 0, 1); // 0 (abajo) .. 1 (arriba)
    const nx = v.x / (width * 0.5 || 1);
    const edge = Math.max(0.55, 1 - nx * nx * 0.35);
    // Sigue exactamente la curva pectoral delantera de `createAthleticChestGeometry` (máximo en u≈0.6)
    const pecEnvelope = Math.sin(Math.pow(u01, 0.85) * Math.PI);
    const zCurve = pecEnvelope * wrapCurvature;
    pos.setXYZ(i, v.x, v.y, v.z * edge + zCurve);
  }
  geo.userData.isSculpted = true;
  geo.computeVertexNormals();
  return geo;
}

/** Mano marcial estilizada anime: palma orgánica redondeada, nudillos curvos y pulgar articulado */
function buildSculptedHand(wrist, M, sideSign, tracker, isGloved, gloveMat) {
  const baseMat = isGloved ? gloveMat : M.skin;
  const tipMat = M.skin;

  // Palma esculpida redondeada (ahusada en muñeca, curva suave en nudillos)
  const palmGeo = new THREE.SphereGeometry(0.033, 22, 16);
  const pos = palmGeo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.x * 0.92;
    const y = v.y * 1.12;
    let z = v.z * 0.62;
    // Estrechamiento gradual hacia muñeca y suave volumen dorsal
    if (v.y > 0) {
      const t = v.y / 0.033;
      x *= 1 - t * 0.24;
    } else {
      const t = -v.y / 0.033;
      z += t * 0.004;
    }
    pos.setXYZ(i, x, y, z);
  }
  palmGeo.computeVertexNormals();
  const palm = addTrackedMesh(wrist, palmGeo, baseMat, tracker, 0, -0.034, 0.004);
  palm.rotation.y = sideSign * 0.12;

  // 4 dedos curvados compactos en puño marcial
  for (let f = 0; f < 4; f++) {
    const fx = (f - 1.5) * 0.0128;
    const fingerLen = f === 1 || f === 2 ? 0.042 : 0.036;
    const seg1 = addTrackedMesh(
      palm,
      new THREE.CapsuleGeometry(0.0074, fingerLen * 0.42, 6, 8),
      isGloved ? tipMat : baseMat,
      tracker,
      fx,
      -0.031,
      0.007,
      { rot: [-0.82, 0, 0] }
    );
    addTrackedMesh(
      seg1,
      new THREE.CapsuleGeometry(0.0066, fingerLen * 0.38, 6, 8),
      tipMat,
      tracker,
      0,
      -0.017,
      0.009,
      { rot: [-0.92, 0, 0] }
    );
  }

  // Pulgar articulado abrazando los dedos
  const thumb = addTrackedMesh(
    palm,
    new THREE.CapsuleGeometry(0.009, 0.022, 6, 8),
    baseMat,
    tracker,
    -sideSign * 0.026,
    -0.008,
    0.017,
    { rot: [-0.48, 0, sideSign * 0.56] }
  );
  addTrackedMesh(
    thumb,
    new THREE.CapsuleGeometry(0.0076, 0.016, 6, 8),
    tipMat,
    tracker,
    sideSign * 0.005,
    -0.015,
    0.008,
    { rot: [-0.58, 0, sideSign * 0.32] }
  );
}

/**
 * Bota marcial estilizada esculpida con empeine arqueado, puntera almendrada,
 * talón definido y suela sutil integrada sin caja poligonal.
 */
export function createSculptedBootGeometry(footH = 0.08) {
  const geo = new THREE.SphereGeometry(1, 26, 18);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Rango Z desde -0.068 (talón) hasta +0.168 (puntera)
    const zNorm = (v.z + 1) * 0.5; // 0..1 (talón..punta)
    let z = -0.068 + zNorm * 0.232;

    // Perfil de anchura heroica: talón estable, mediopié firme y puntera almendrada equilibrada
    let halfW = 0.058;
    if (zNorm < 0.28) {
      halfW = 0.051 + (zNorm / 0.28) * 0.007;
    } else if (zNorm > 0.62) {
      const t = (zNorm - 0.62) / 0.38;
      halfW = 0.058 * (1 - Math.pow(t, 1.4) * 0.28);
    }

    let x = v.x * halfW;
    // Altura desde suela (-footH) hasta empeine/tobillo (0)
    let y = (v.y * 0.5 - 0.5) * footH;

    // Rebaje del empeine arqueado hacia los dedos
    if (v.y > 0.0 && zNorm > 0.28) {
      const arch = Math.pow((zNorm - 0.28) / 0.72, 0.92);
      y -= arch * footH * 0.42 * Math.min(1, v.y * 1.3);
    }

    // Suela plana firme en la base + ligera elevación delantera en puntera
    if (y < -footH * 0.72) {
      y = -footH + (zNorm > 0.76 ? ((zNorm - 0.76) / 0.24) * 0.009 : 0);
      // Reborde sutil de suela sobresaliendo ligeramente
      x *= 1.07;
      z += (zNorm - 0.5) * 0.008;
    }

    // Contraste del talón hacia atrás abajo
    if (zNorm < 0.2 && y < -footH * 0.4) {
      z -= 0.005;
    }

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pierna de pantalón orgánica esculpida (hakama / holgado / entallado) */
function createPantsThighGeo(length, sideSign, style) {
  const isWide = style === 'hakama' || style === 'loose';
  const rHip = style === 'hakama' ? 0.095 : style === 'loose' ? 0.092 : 0.088;
  const puffAmp = style === 'hakama' ? 0.028 : style === 'loose' ? 0.025 : 0.017;

  const geo = createLatheLimbGeometry(rHip, rHip * (isWide ? 0.94 : 0.82), length, {
    radialSegments: 26,
    heightSegments: 14,
    bellyAmp: puffAmp / rHip,
    capRound: 0.014,
  });
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp(-v.y / length, 0, 1);
    const a = Math.atan2(v.z, v.x);
    const puff = Math.sin(Math.pow(u, 0.72) * Math.PI);
    const fold = Math.sin(a * (isWide ? 5 : 3) + sideSign * 0.8) * (isWide ? 0.0045 : 0.0025) * puff;
    let x = v.x * (isWide ? 1.04 : 1.0) + Math.cos(a) * fold;
    const z = v.z * (isWide ? 1.10 : 1.04) - Math.sin(a) * fold;
    if (isWide) x += sideSign * puff * 0.008;
    pos.setXYZ(i, x, v.y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function createPantsCalfUpperGeo(length, style) {
  const isWide = style === 'hakama' || style === 'loose';
  const topR = style === 'hakama' ? 0.084 : style === 'loose' ? 0.080 : 0.072;
  const geo = createLatheLimbGeometry(topR, topR * (isWide ? 0.65 : 0.78), length, {
    radialSegments: 26,
    heightSegments: 10,
    bellyAmp: isWide ? 0.36 : 0.14,
    scaleX: 1.02,
    scaleZ: 1.06,
    capRound: 0.012,
  });
  geo.computeVertexNormals();
  return geo;
}

// ============================================================================
//  Rostro Anime Expresivo y Peinados Esculpidos Diferenciados
// ============================================================================

/**
 * Construye la flecha celeste curva moldeada directamente sobre la cabeza del
 * Maestro del Aire (sin prismas/conos flotando en la frente y sin contorno duro).
 */
function addAirNomadSkyArrow(head, arrowMat, tracker) {
  const arrowSurfMat = arrowMat;
  // Banda longitudinal arqueada pegada desde la nuca hasta la coronilla frontal
  const spinePts = [
    new THREE.Vector3(0, 0.095, -0.096),
    new THREE.Vector3(0, 0.188, -0.078),
    new THREE.Vector3(0, 0.236, -0.005),
    new THREE.Vector3(0, 0.214, 0.072),
    new THREE.Vector3(0, 0.172, 0.104),
  ];
  const shaftGeo = createCurvedStrandGeo(spinePts, 0.016, 0.015, 20, 12, 0.24);
  addTrackedMesh(head, shaftGeo, arrowSurfMat, tracker, 0, 0, 0, {
    noOutline: true,
    castShadow: false,
  });

  // Punta de flecha plana y limpia integrada a la curvatura de la frente
  const tipShape = new THREE.Shape();
  tipShape.moveTo(0, -0.036);
  tipShape.lineTo(0.031, 0.012);
  tipShape.lineTo(0.011, 0.009);
  tipShape.lineTo(0, 0.022);
  tipShape.lineTo(-0.011, 0.009);
  tipShape.lineTo(-0.031, 0.012);
  tipShape.closePath();

  const tipGeo = new THREE.ExtrudeGeometry(tipShape, {
    depth: 0.006,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2,
  });
  tipGeo.center();
  // Curva la punta sobre el eje X para amoldarla a la curva esférica frontal
  const tp = tipGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const px = tp.getX(i);
    const py = tp.getY(i);
    const pz = tp.getZ(i);
    tp.setZ(i, pz - (px * px) * 5.2 - (py * py) * 1.8);
  }
  tipGeo.computeVertexNormals();
  addTrackedMesh(head, tipGeo, arrowSurfMat, tracker, 0, 0.162, 0.111, {
    noOutline: true,
    castShadow: false,
    rot: [-0.34, 0, 0],
    scale: [1.14, 1.14, 1.0],
  });
}

function buildAnimeFaceAndHead(head, M, element, isRival, tracker, secondaryParts, extraMaterials) {
  // Cráneo base suavizado
  addTrackedMesh(head, createSculptedHeadGeometry(), M.skin, tracker, 0, 0.112, 0.006);

  // Orejas estilizadas redondeadas sin contorno grueso
  for (const s of [1, -1]) {
    const ear = addTrackedMesh(
      head,
      new THREE.CapsuleGeometry(0.012, 0.02, 6, 10),
      M.skin,
      tracker,
      s * 0.098,
      0.108,
      -0.002,
      { rot: [0.12, 0, -s * 0.22], scale: [0.58, 1, 0.9], noOutline: true }
    );
    ear.castShadow = false;
  }

  // Ojos anime expresivos orgullosamente sobre la superficie facial (z ≈ 0.111..0.1165)
  const scleraMat = createToonMaterial('#f8fcff');
  const pupilMat = createToonMaterial('#111622');
  const specMat = createToonMaterial('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.55 });
  const irisMat =
    element === 'shadow'
      ? createToonMaterial(isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon, {
          emissive: isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon,
          emissiveIntensity: 0.65,
        })
      : element === 'samurai'
        ? createToonMaterial(isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold, {
            emissive: isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.brightCrimson,
            emissiveIntensity: 0.42,
          })
        : M.eye;
  extraMaterials.push(scleraMat, pupilMat, specMat);
  if (irisMat !== M.eye) extraMaterials.push(irisMat);

  for (const s of [1, -1]) {
    const yawAng = s * 0.26;
    // Ceja arqueada orgánica (`createCurvedStrandGeo`)
    const browGeo = createCurvedStrandGeo(
      [
        new THREE.Vector3(-s * 0.019, -0.003, 0.002),
        new THREE.Vector3(0, 0.0045, 0.005),
        new THREE.Vector3(s * 0.020, -0.002, 0.0),
      ],
      0.0042,
      0.0016,
      10,
      8,
      0.55
    );
    addTrackedMesh(head, browGeo, M.hair, tracker, s * 0.036, 0.141, 0.1125, {
      noOutline: true,
      castShadow: false,
      rot: [0, yawAng, -s * 0.14],
    });

    // Esclerótica almendrada curvada
    addTrackedMesh(head, new THREE.SphereGeometry(0.0175, 16, 12), scleraMat, tracker, s * 0.035, 0.120, 0.1112, {
      noOutline: true,
      castShadow: false,
      rot: [0, yawAng, -s * 0.04],
      scale: [1.05, 0.58, 0.24],
    });

    // Iris ovalado con color elemental
    addTrackedMesh(head, new THREE.SphereGeometry(0.0098, 16, 12), irisMat, tracker, s * 0.035, 0.1195, 0.1134, {
      noOutline: true,
      castShadow: false,
      rot: [0, yawAng, 0],
      scale: [0.88, 1.04, 0.28],
    });

    // Pupila oscura nítida
    addTrackedMesh(head, new THREE.SphereGeometry(0.0054, 12, 10), pupilMat, tracker, s * 0.035, 0.1192, 0.1149, {
      noOutline: true,
      castShadow: false,
      rot: [0, yawAng, 0],
      scale: [0.88, 0.96, 0.3],
    });

    // Punto de brillo especular blanco vivo (estilo anime)
    addTrackedMesh(head, new THREE.SphereGeometry(0.0032, 10, 8), specMat, tracker, s * 0.0305, 0.1235, 0.1162, {
      noOutline: true,
      castShadow: false,
      scale: [0.95, 0.95, 0.45],
    });

    // Pestaña superior estilizada arqueada con rabillo externo
    const lashGeo = createCurvedStrandGeo(
      [
        new THREE.Vector3(-s * 0.017, -0.002, 0.001),
        new THREE.Vector3(0, 0.0046, 0.005),
        new THREE.Vector3(s * 0.019, 0.001, -0.002),
      ],
      0.0038,
      0.0014,
      10,
      8,
      0.55
    );
    addTrackedMesh(head, lashGeo, M.hair, tracker, s * 0.035, 0.126, 0.1135, {
      noOutline: true,
      castShadow: false,
      rot: [0, yawAng, -s * 0.05],
    });
  }

  // Sonrisa marcial limpia curva (orgullosa sobre el mentón frontal)
  const mouthGeo = createCurvedStrandGeo(
    [
      new THREE.Vector3(-0.0125, 0.002, -0.0015),
      new THREE.Vector3(0, -0.0014, 0.0022),
      new THREE.Vector3(0.0125, 0.0022, -0.0015),
    ],
    0.0026,
    0.0014,
    10,
    8,
    0.55
  );
  addTrackedMesh(head, mouthGeo, pupilMat, tracker, 0, 0.066, 0.1072, {
    noOutline: true,
    castShadow: false,
  });

  if (element === 'psychic') {
    const foreheadMat = createToonMaterial(PSYCHIC_PALETTE.magenta, {
      emissive: '#d946ef',
      emissiveIntensity: 0.9,
    });
    extraMaterials.push(foreheadMat);
    addTrackedMesh(head, new THREE.SphereGeometry(0.013, 14, 12), foreheadMat, tracker, 0, 0.158, 0.1145, {
      noOutline: true,
      castShadow: false,
      scale: [0.68, 1.38, 0.36],
    });
  }

  // --- Peinado / Cabeza Específico por Maestro ---
  if (element === 'air') {
    const arrowMat = createToonMaterial(isRival ? '#4ad4ff' : '#2fb6e8');
    extraMaterials.push(arrowMat);
    addAirNomadSkyArrow(head, arrowMat, tracker);
    return;
  }

  // Casquete craneal esculpido de alta resolución (`flatShading: false`)
  const skullHairGeo = new THREE.SphereGeometry(0.118, 32, 22);
  const hp = skullHairGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    let x = hp.getX(i) * 0.94;
    let y = hp.getY(i) * 1.12;
    let z = hp.getZ(i) * 1.01;
    if (z > 0.025 && y < 0.045) {
      y = 0.045;
      z *= 0.86;
    }
    if (z < -0.02 && y < 0) x *= 0.84;
    hp.setXYZ(i, x, y, z);
  }
  skullHairGeo.computeVertexNormals();
  addTrackedMesh(head, skullHairGeo, M.hair, tracker, 0, 0.114, 0.005);

  // Flequillos y mechones esculpidos con identidad por maestro
  if (element === 'psychic') {
    // Flequillo asimétrico elegante cruzando la frente + ondas laterales suaves
    for (let b = 0; b < 5; b++) {
      const t = b / 4; // 0..1 barrido izquierda->derecha
      const sx = THREE.MathUtils.lerp(-0.072, 0.056, t);
      const ex = THREE.MathUtils.lerp(-0.022, 0.088, t);
      const dropY = b === 1 || b === 2 ? 0.118 : 0.145;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(-0.028, 0.218, 0.036),
          new THREE.Vector3(sx, 0.184, 0.095),
          new THREE.Vector3(ex, dropY, 0.11 - t * 0.02),
        ],
        0.023,
        0.0035,
        16,
        10,
        0.55
      );
      addTrackedMesh(head, strandGeo, M.hair, tracker);
    }
  } else if (element === 'nature') {
    // Melena salvaje escalonada con picos orgánicos hacia sienes y coronilla
    for (let b = 0; b < 6; b++) {
      const t = (b / 5) * 2 - 1;
      const bx = t * 0.068;
      const flare = (b % 2 === 0 ? 1 : -1) * 0.015;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(bx * 0.45, 0.216, 0.03),
          new THREE.Vector3(bx * 0.96 + flare, 0.188, 0.094),
          new THREE.Vector3(bx * 1.15 + flare * 1.4, 0.136 - (b % 2) * 0.016, 0.106 - Math.abs(t) * 0.018),
        ],
        0.022,
        0.003,
        16,
        10,
        0.58
      );
      addTrackedMesh(head, strandGeo, M.hair, tracker);
    }
    // Picos superiores desenfadados hacia atrás/arriba
    for (const sx of [-0.05, 0.01, 0.055]) {
      const tuft = createCurvedStrandGeo(
        [
          new THREE.Vector3(sx * 0.6, 0.22, 0.0),
          new THREE.Vector3(sx * 1.4, 0.252, -0.052),
          new THREE.Vector3(sx * 1.8, 0.225, -0.118),
        ],
        0.024,
        0.004,
        14,
        10,
        0.65
      );
      addTrackedMesh(head, tuft, M.hair, tracker);
    }
  } else if (element === 'storm') {
    // Púas dinámicas peinadas atrás/arriba + 2 mechones destacados azul plata eléctrica
    const stormHighlightMat = createToonMaterial(STORM_PALETTE.mistSilver, {
      emissive: STORM_PALETTE.electricBlue,
      emissiveIntensity: 0.18,
    });
    extraMaterials.push(stormHighlightMat);

    for (let b = 0; b < 5; b++) {
      const t = (b / 4) * 2 - 1;
      const bx = t * 0.062;
      const isHighlight = b === 1 || b === 3;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(bx * 0.45, 0.216, 0.036),
          new THREE.Vector3(bx * 0.98, 0.184, 0.098),
          new THREE.Vector3(bx * 1.12, 0.132 - Math.abs(t) * 0.012, 0.112 - Math.abs(t) * 0.015),
        ],
        0.021,
        0.0032,
        16,
        10,
        0.56
      );
      addTrackedMesh(head, strandGeo, isHighlight ? stormHighlightMat : M.hair, tracker);
    }

    // Cresta dinámica eléctrica barrida hacia atrás
    for (let sp = -1; sp <= 1; sp++) {
      const spikeGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(sp * 0.032, 0.224, 0.025),
          new THREE.Vector3(sp * 0.056, 0.264, -0.042),
          new THREE.Vector3(sp * 0.072, 0.242, -0.118),
        ],
        0.026,
        0.004,
        14,
        10,
        0.62
      );
      addTrackedMesh(head, spikeGeo, sp === 0 ? M.hair : stormHighlightMat, tracker);
    }
  } else if (element === 'shadow') {
    // Cabello oscuro desfilado asimétrico con puntas afiladas enmarcando la frente
    const violetTipMat = createToonMaterial(isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet, {
      emissive: isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon,
      emissiveIntensity: 0.16,
    });
    extraMaterials.push(violetTipMat);

    for (let b = 0; b < 6; b++) {
      const t = (b / 5) * 2 - 1;
      const sx = THREE.MathUtils.lerp(-0.074, 0.062, b / 5);
      const dropY = b === 2 ? 0.104 : b === 1 || b === 3 ? 0.122 : 0.142 - Math.abs(t) * 0.012;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(sx * 0.48, 0.218, 0.032),
          new THREE.Vector3(sx * 0.96, 0.184, 0.098),
          new THREE.Vector3(sx * 1.12 + (b === 2 ? 0.014 : 0), dropY, 0.114 - Math.abs(t) * 0.018),
        ],
        0.02,
        0.0024,
        16,
        10,
        0.54
      );
      addTrackedMesh(head, strandGeo, b === 0 || b === 5 ? violetTipMat : M.hair, tracker);
    }
  } else if (element === 'samurai') {
    // Peinado rōnin afilado con mechones laterales enmarcando la cinta metálica
    for (let b = 0; b < 5; b++) {
      const t = (b / 4) * 2 - 1;
      const sx = t * 0.068;
      const dropY = b === 0 || b === 4 ? 0.118 : 0.148 - Math.abs(t) * 0.01;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(sx * 0.45, 0.218, 0.03),
          new THREE.Vector3(sx * 0.96, 0.185, 0.1),
          new THREE.Vector3(sx * 1.1 + (b === 2 ? 0.015 : 0), dropY, 0.112 - Math.abs(t) * 0.018),
        ],
        0.02,
        0.0028,
        16,
        10,
        0.52
      );
      addTrackedMesh(head, strandGeo, M.hair, tracker);
    }
  } else {
    // Fuego (real escalonado), Agua (suave partido), Tierra (abundante barrido)
    const bangCount = element === 'fire' ? 5 : 4;
    for (let b = 0; b < bangCount; b++) {
      const t = (b / (bangCount - 1)) * 2 - 1;
      const bx = t * 0.056;
      const dropY = element === 'water' ? 0.128 : 0.140 - Math.abs(t) * 0.012;
      const strandGeo = createCurvedStrandGeo(
        [
          new THREE.Vector3(bx * 0.45, 0.216, 0.04),
          new THREE.Vector3(bx * 0.92, 0.182, 0.096),
          new THREE.Vector3(bx * 1.06, dropY, 0.112 - Math.abs(t) * 0.012),
        ],
        0.022,
        0.0035,
        15,
        10,
        0.58
      );
      addTrackedMesh(head, strandGeo, M.hair, tracker);
    }
  }

  // Mechones laterales enmarcando mejillas (Agua con lazos/trenzas en ondas y aros turquesa)
  for (const s of [1, -1]) {
    const sideLock = createCurvedStrandGeo(
      [
        new THREE.Vector3(s * 0.072, 0.19, 0.04),
        new THREE.Vector3(s * 0.104, 0.118, 0.058),
        new THREE.Vector3(s * 0.088, element === 'water' ? 0.026 : 0.052, 0.068),
      ],
      0.02,
      0.004,
      16,
      10,
      0.65
    );
    addTrackedMesh(head, sideLock, M.hair, tracker);

    if (element === 'water') {
      addTrackedMesh(head, new THREE.TorusGeometry(0.016, 0.006, 8, 16), M.ochre, tracker, s * 0.092, 0.064, 0.062, {
        rot: [Math.PI * 0.48, 0, s * 0.15],
      });
    }
  }

  // Ornamentos craneales y diademas según maestro
  if (element === 'fire') {
    // Moño alto imperial esculpido + horquilla de llama dorada curva (cero cono piramidal)
    addTrackedMesh(head, new THREE.SphereGeometry(0.048, 22, 16), M.hair, tracker, 0, 0.238, -0.058, {
      scale: [0.96, 1.15, 0.94],
    });
    addTrackedMesh(head, new THREE.TorusGeometry(0.036, 0.009, 8, 20), M.ochre, tracker, 0, 0.222, -0.058, {
      rot: [Math.PI * 0.42, 0, 0],
    });
    const flameProngGeo = createCurvedStrandGeo(
      [
        new THREE.Vector3(0, 0.232, -0.064),
        new THREE.Vector3(0, 0.285, -0.082),
        new THREE.Vector3(0, 0.312, -0.066),
      ],
      0.014,
      0.003,
      12,
      10,
      0.6
    );
    addTrackedMesh(head, flameProngGeo, M.ochre, tracker);
  } else {
    // Cinta frontal contorneada exactamente a la curva craneal
    const bandGeo = new THREE.CylinderGeometry(0.104, 0.104, 0.024, 28, 1, true);
    const bp = bandGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const a = Math.atan2(bp.getX(i), bp.getZ(i));
      bp.setXYZ(i, Math.sin(a) * 0.106, bp.getY(i) - (1 - Math.cos(a)) * 0.006, Math.cos(a) * 0.113);
    }
    bandGeo.computeVertexNormals();
    addTrackedMesh(head, bandGeo, M.band, tracker, 0, 0.152, 0.006);

    if (element === 'storm') {
      // Emblema relámpago biselado suavemente en diadema
      addTrackedMesh(head, createRoundedBuckleGeo(0.028, 0.034, 0.012), M.ochre, tracker, 0, 0.155, 0.12, {
        noOutline: true,
        castShadow: false,
      });
    } else if (element === 'light') {
      // Tiara / Diadema solar dorada con alas laterales curvas y gema prismática cian en la frente
      const gemMat = createToonMaterial(isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan, {
        emissive: isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan,
        emissiveIntensity: 0.75,
      });
      extraMaterials.push(gemMat);

      for (const s of [1, -1]) {
        const wingGeo = createCurvedStrandGeo(
          [
            new THREE.Vector3(s * 0.018, 0.16, 0.114),
            new THREE.Vector3(s * 0.068, 0.184, 0.095),
            new THREE.Vector3(s * 0.106, 0.212, 0.038),
          ],
          0.01,
          0.003,
          12,
          8,
          0.55
        );
        addTrackedMesh(head, wingGeo, M.ochre, tracker, 0, 0, 0, { castShadow: false });
      }
      addTrackedMesh(head, createRoundedBuckleGeo(0.026, 0.036, 0.014), gemMat, tracker, 0, 0.162, 0.12, {
        noOutline: true,
        castShadow: false,
      });
    } else if (element === 'shadow') {
      // Antifaz / Diadema nocturna estilizada con alas laterales y emblema de eclipse carmesí
      const eclipseGlowMat = createToonMaterial(isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon, {
        emissive: isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon,
        emissiveIntensity: 0.8,
      });
      const eclipseCoreMat = createToonMaterial(SHADOW_PALETTE.obsidian);
      extraMaterials.push(eclipseGlowMat, eclipseCoreMat);

      for (const s of [1, -1]) {
        const maskWingGeo = createCurvedStrandGeo(
          [
            new THREE.Vector3(s * 0.015, 0.15, 0.116),
            new THREE.Vector3(s * 0.064, 0.145, 0.104),
            new THREE.Vector3(s * 0.106, 0.166, 0.044),
          ],
          0.014,
          0.004,
          12,
          8,
          0.48
        );
        addTrackedMesh(head, maskWingGeo, M.tunicDark, tracker, 0, 0, 0, { castShadow: false });
      }
      addTrackedMesh(head, new THREE.TorusGeometry(0.019, 0.0045, 8, 20), eclipseGlowMat, tracker, 0, 0.156, 0.118, {
        noOutline: true,
        castShadow: false,
      });
      addTrackedMesh(head, new THREE.SphereGeometry(0.014, 12, 10), eclipseCoreMat, tracker, 0, 0.156, 0.119, {
        noOutline: true,
        castShadow: false,
        scale: [1, 1, 0.35],
      });
    } else if (element === 'samurai') {
      // Cinta frontal metálica estilo hachigane rōnin
      const plateMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalSilver : SAMURAI_PALETTE.steel);
      const trimMat = createToonMaterial(isRival ? SAMURAI_PALETTE.rivalBronze : SAMURAI_PALETTE.gold);
      extraMaterials.push(plateMat, trimMat);
      addTrackedMesh(head, new THREE.BoxGeometry(0.112, 0.032, 0.014), plateMat, tracker, 0, 0.158, 0.115, {
        castShadow: false,
      });
      addTrackedMesh(head, new THREE.OctahedronGeometry(0.015, 0), trimMat, tracker, 0, 0.158, 0.124, {
        castShadow: false,
      });
    }
  }

  // --- Coleta trasera articulada (`secondaryParts.ponytail`: baja para `'shadow'`) ---
  const ptPivot = new THREE.Group();
  const isLowTail = element === 'shadow';
  ptPivot.position.set(0, isLowTail ? 0.088 : 0.215, isLowTail ? -0.106 : -0.088);
  head.add(ptPivot);
  tracker.push(ptPivot);

  addTrackedMesh(ptPivot, new THREE.TorusGeometry(0.025, 0.009, 8, 18), M.band, tracker, 0, 0.008, -0.004, {
    rot: [0.45 + Math.PI * 0.5, 0, 0],
  });

  const ptLen = element === 'water' || element === 'light' || element === 'shadow' ? 0.36 : element === 'fire' ? 0.30 : 0.26;
  const mainTailGeo = createCurvedStrandGeo(
    [
      new THREE.Vector3(0, 0.01, 0),
      new THREE.Vector3(0, 0.025, -0.068),
      new THREE.Vector3(0, -ptLen * 0.42, -0.108),
      new THREE.Vector3(0, -ptLen, -0.092),
    ],
    0.044,
    0.007,
    18,
    14,
    0.85
  );
  addTrackedMesh(ptPivot, mainTailGeo, M.hair, tracker);

  for (const s of [1, -1]) {
    const subGeo = createCurvedStrandGeo(
      [
        new THREE.Vector3(s * 0.015, 0.005, -0.01),
        new THREE.Vector3(s * 0.038, -ptLen * 0.38, -0.082),
        new THREE.Vector3(s * 0.026, -ptLen * 0.88, -0.075),
      ],
      0.022,
      0.004,
      14,
      10
    );
    addTrackedMesh(ptPivot, subGeo, M.hair, tracker);
  }

  // Cintas colgantes subdivididas y broches de hojas en coleta
  if (element === 'earth' || element === 'fire' || element === 'nature' || element === 'psychic' || element === 'storm' || element === 'light' || element === 'shadow' || element === 'samurai') {
    const ribbonGeo = createCurvedClothPanelGeo({
      width: 0.022,
      height: 0.16,
      depth: 0.007,
      curveZ: -0.016,
      taperTop: 0.9,
      taperBottom: 1.2,
      segW: 2,
      segH: 6,
    });
    const ribbon = addTrackedMesh(ptPivot, ribbonGeo, M.band, tracker, 0.016, -0.01, -0.02, {
      rot: [0.34, 0, 0.14],
    });
    ribbon.userData.isRibbon = true;
    registerClothWave(ribbon, secondaryParts, 0.16, 0.7, 0.8);

    if (element === 'nature') {
      const leafClipGeo = createLeafBladeGeometry(0.11, 0.052, 0.014);
      addTrackedMesh(ptPivot, leafClipGeo, M.ochre, tracker, -0.024, 0.015, 0.004, {
        rot: [0.25, 0.4, 0.45],
      });
    }
  }

  secondaryParts.ponytail = ptPivot;
}

// ============================================================================
//  Constructor Completo por Elemento (Anatomía + Traje + Accesorios)
// ============================================================================

export function buildCharacterAppearance({
  joints,
  M,
  element,
  isRival,
  tracker,
  secondaryParts,
  dims,
  extraMaterials = [],
}) {
  const { THIGH, CALF, FOOT_H, UPPER_ARM, FOREARM } = dims;
  const { hips, spine, chest, neck, head } = joints;

  secondaryParts.ponytail = null;
  secondaryParts.flaps = [];
  secondaryParts.scarves = [];
  secondaryParts.clothMeshes = [];
  secondaryParts.runeHalo = null;
  secondaryParts.prismWings = [];

  // 1. Cuello orgánico + Cabeza + Rostro Anime + Peinado esculpido
  addTrackedMesh(neck, createSculptedNeckGeometry(), M.skin, tracker);
  buildAnimeFaceAndHead(head, M, element, isRival, tracker, secondaryParts, extraMaterials);

  // Materiales de acento específicos
  const whiteTrimMat = createToonMaterial(isRival ? '#d2ebf7' : '#f4f9fc');
  const furMat = createToonMaterial(isRival ? '#cce2f0' : '#f2f7fa');
  const darkMetalMat = createToonMaterial('#2a2f3a');
  const barkMat = createToonMaterial(isRival ? NATURE_PALETTE.barkDark : NATURE_PALETTE.bark);
  const mossGoldMat = createToonMaterial(NATURE_PALETTE.mossGold);
  const silverMat = createToonMaterial(PSYCHIC_PALETTE.lavender, {
    emissive: PSYCHIC_PALETTE.magenta,
    emissiveIntensity: 0.2,
  });
  const violetMat = createToonMaterial(PSYCHIC_PALETTE.royalViolet);
  const stormBlueMat = createToonMaterial(STORM_PALETTE.electricBlue, {
    emissive: STORM_PALETTE.electricBlue,
    emissiveIntensity: 0.25,
  });
  const boltGoldMat = createToonMaterial(STORM_PALETTE.boltGold, {
    emissive: STORM_PALETTE.boltGold,
    emissiveIntensity: 0.35,
  });
  const mistSilverMat = createToonMaterial(STORM_PALETTE.mistSilver, {
    emissive: STORM_PALETTE.electricBlue,
    emissiveIntensity: 0.14,
  });
  const prismCyanMat = createToonMaterial(isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan, {
    transparent: true,
    opacity: 0.85,
    emissive: isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan,
    emissiveIntensity: 0.45,
    flatShading: true,
  });
  const solarGoldMat = createToonMaterial(isRival ? LIGHT_PALETTE.rivalRose : LIGHT_PALETTE.solarGold, {
    emissive: isRival ? LIGHT_PALETTE.rivalRose : LIGHT_PALETTE.solarGold,
    emissiveIntensity: 0.28,
  });
  const shadowVioletMat = createToonMaterial(isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet, {
    emissive: isRival ? SHADOW_PALETTE.rivalPurple : SHADOW_PALETTE.abyssViolet,
    emissiveIntensity: 0.24,
  });
  const shadowCrimsonMat = createToonMaterial(isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon, {
    emissive: isRival ? SHADOW_PALETTE.rivalMagenta : SHADOW_PALETTE.crimsonNeon,
    emissiveIntensity: 0.55,
  });
  extraMaterials.push(
    whiteTrimMat,
    furMat,
    darkMetalMat,
    barkMat,
    mossGoldMat,
    silverMat,
    violetMat,
    stormBlueMat,
    boltGoldMat,
    mistSilverMat,
    prismCyanMat,
    solarGoldMat,
    shadowVioletMat,
    shadowCrimsonMat
  );

  // Helper interno para registrar paneles curvos de falda con movimiento secundario y onda de vértices
  const addSkirtFlap = (parent, { x, y, z, ry, w, h, mat, trimMat, trimMat2, axis, sign, baseTilt, phase = 0 }) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    tracker.push(pivot);

    const panelGeo = createCurvedClothPanelGeo({
      width: w,
      height: h,
      depth: 0.02,
      curveZ: 0.024,
      taperTop: 0.88,
      taperBottom: 1.12,
      segW: 6,
      segH: 8,
    });
    const rotWrap = new THREE.Group();
    rotWrap.rotation.y = ry;
    pivot.add(rotWrap);
    tracker.push(rotWrap);

    const panel = addTrackedMesh(rotWrap, panelGeo, mat, tracker, 0, 0, 0);
    registerClothWave(panel, secondaryParts, h, phase, 0.7);

    if (trimMat) {
      const hemGeo = createCurvedClothPanelGeo({
        width: w * 1.12,
        height: 0.032,
        depth: 0.024,
        curveZ: 0.004,
        taperTop: 0.99,
        taperBottom: 1.01,
        segW: 5,
        segH: 2,
      });
      addTrackedMesh(rotWrap, hemGeo, trimMat, tracker, 0, -h * 0.86, 0.008);
    }
    if (trimMat2) {
      const subGeo = createCurvedClothPanelGeo({
        width: w * 0.82,
        height: 0.02,
        depth: 0.025,
        curveZ: 0.004,
        taperTop: 0.98,
        taperBottom: 1.0,
        segW: 4,
        segH: 2,
      });
      addTrackedMesh(rotWrap, subGeo, trimMat2, tracker, 0, -h * 0.74, 0.012);
    }

    secondaryParts.flaps.push({ pivot, axis, sign, baseTilt });
    return rotWrap;
  };

  // 2. Torso, pelvis y vestimenta diferenciada por elemento
  addTrackedMesh(hips, createPelvisGeometry(), M.pants, tracker, 0, -0.02, 0);

  if (element === 'water') {
    // --- MAESTRO AGUA ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunic, tracker, 0, 0, 0);

    // Solapa cruzada contorneada en diagonal (abrazando la curvatura pectoral completa sin hundirse)
    addTrackedMesh(chest, createContouredChestStrapGeo(0.028, 0.34, 0.022, 0.056), whiteTrimMat, tracker, 0.014, 0.21, 0.112, {
      rot: [0, 0, -0.42],
    });
    addTrackedMesh(spine, createContouredChestStrapGeo(0.025, 0.19, 0.02, 0.022), whiteTrimMat, tracker, -0.056, 0.145, 0.098, {
      rot: [0, 0, -0.26],
    });

    // Cuello de piel blanca suave esculpido en caída orgánica sobre clavículas
    const furCollar = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.156, rz: 0.116, tubeR: 0.036, drapeFront: 0.026, drapeBack: 0.022, fluffRipple: 0.085 }),
      furMat,
      tracker,
      0,
      0.345,
      0.004
    );
    furCollar.castShadow = true;

    // Cinturón con hebilla biselada suave de plata/hielo
    addTrackedMesh(hips, createFittedSashGeometry(0.148, 0.108, 0.078), M.tunicDark, tracker, 0, 0.045, 0);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.072, 0.054, 0.024), whiteTrimMat, tracker, 0, 0.046, 0.11);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.042, 0.032, 0.028), M.ochre, tracker, 0, 0.046, 0.114);

    // Faldón dividido curvo con ribete blanco y onda textil
    const flapSpecs = [
      { x: 0.15, y: 0.012, z: 0.0, ry: Math.PI / 2, w: 0.22, h: 0.27, axis: 'rz', sign: 1, phase: 0.2 },
      { x: -0.15, y: 0.012, z: 0.0, ry: -Math.PI / 2, w: 0.22, h: 0.27, axis: 'rz', sign: -1, phase: 1.5 },
      { x: 0.0, y: 0.012, z: -0.116, ry: Math.PI, w: 0.27, h: 0.29, axis: 'rx', sign: 1, phase: 2.7 },
    ];
    for (const fl of flapSpecs) {
      addSkirtFlap(hips, { ...fl, mat: M.tunicDark, trimMat: whiteTrimMat, baseTilt: 0.14 });
    }
  } else if (element === 'earth') {
    // --- MAESTRO TIERRA ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), isRival ? M.tunicDark : M.tunic, tracker, 0, 0, 0);

    // Cuello cruzado en V contorneado en ocre/crema + garganta de piel curva
    for (const s of [1, -1]) {
      addTrackedMesh(chest, createContouredChestStrapGeo(0.03, 0.23, 0.022, 0.044), M.ochre, tracker, s * 0.042, 0.27, 0.092, {
        rot: [0.18, 0, s * 0.34],
      });
    }
    if (!isRival) {
      addTrackedMesh(chest, new THREE.SphereGeometry(0.046, 16, 12), M.skin, tracker, 0, 0.315, 0.088, {
        scale: [0.95, 1.15, 0.45],
        noOutline: true,
      });
    }

    // Fajín amplio de tela ocre anudado en la cintura + puntas colgantes ondulantes
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.105), M.ochreDark, tracker, 0, 0.052, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.153, 0.113, 0.032), M.ochre, tracker, 0, 0.09, 0);
    addTrackedMesh(hips, new THREE.SphereGeometry(0.042, 16, 12), M.ochre, tracker, 0.095, 0.045, 0.088);

    for (const [idx, [ox, len]] of [[0.09, 0.26], [0.135, 0.21]].entries()) {
      const pivot = new THREE.Group();
      pivot.position.set(ox, 0.035, 0.092);
      hips.add(pivot);
      tracker.push(pivot);
      const tailMesh = addTrackedMesh(
        pivot,
        createCurvedClothPanelGeo({ width: 0.05, height: len, depth: 0.015, curveZ: 0.018, taperTop: 0.88, taperBottom: 1.14, segW: 4, segH: 7 }),
        M.ochreDark,
        tracker,
        0,
        0,
        0,
        { rot: [0, 0, -0.14] }
      );
      registerClothWave(tailMesh, secondaryParts, len, idx * 1.4, 0.9);
      secondaryParts.flaps.push({ pivot, axis: 'rx', sign: -1, baseTilt: 0.12 });
    }
  } else if (element === 'fire') {
    // --- MAESTRO FUEGO ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunicDark, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunic, tracker, 0, 0, 0);

    // Cuello alto rígido suavizado con ribete dorado imperial
    addTrackedMesh(chest, new THREE.CylinderGeometry(0.068, 0.084, 0.066, 26, 2, false), M.tunicDark, tracker, 0, 0.372, 0.004, {
      scale: [1.08, 1, 0.96],
    });
    addTrackedMesh(chest, new THREE.TorusGeometry(0.072, 0.0085, 8, 26), M.ochre, tracker, 0, 0.402, 0.004, {
      rot: [Math.PI / 2, 0, 0],
      scale: [1.08, 0.96, 1],
    });

    // Peto cruzado curvo frontal/trasero abrazando el pecho + broche biselado dorado
    for (const s of [1, -1]) {
      addTrackedMesh(chest, createContouredChestStrapGeo(0.036, 0.34, 0.022, 0.058), darkMetalMat, tracker, 0, 0.21, 0.112, {
        rot: [0, 0, s * 0.52],
      });
      addTrackedMesh(chest, createContouredChestStrapGeo(0.036, 0.34, 0.022, -0.052), darkMetalMat, tracker, 0, 0.21, -0.106, {
        rot: [0, 0, s * 0.52],
      });
    }
    addTrackedMesh(chest, createRoundedBuckleGeo(0.052, 0.068, 0.024), M.ochre, tracker, 0, 0.22, 0.168);

    // Cinturón segmentado + 4 faldones curvos biselados con borde dorado
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.085), darkMetalMat, tracker, 0, 0.046, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.153, 0.113, 0.022), M.ochre, tracker, 0, 0.078, 0);

    const fireFlaps = [
      { x: 0.152, y: 0.015, z: 0.02, ry: Math.PI / 2, w: 0.19, h: 0.24, axis: 'rz', sign: 1, phase: 0.1 },
      { x: -0.152, y: 0.015, z: 0.02, ry: -Math.PI / 2, w: 0.19, h: 0.24, axis: 'rz', sign: -1, phase: 1.4 },
      { x: 0.072, y: 0.015, z: -0.116, ry: Math.PI, w: 0.14, h: 0.26, axis: 'rx', sign: 1, phase: 2.3 },
      { x: -0.072, y: 0.015, z: -0.116, ry: Math.PI, w: 0.14, h: 0.26, axis: 'rx', sign: 1, phase: 3.1 },
    ];
    for (const ff of fireFlaps) {
      addSkirtFlap(hips, { ...ff, mat: M.tunicDark, trimMat: M.ochre, baseTilt: 0.16 });
    }
  } else if (element === 'nature') {
    // --- MAESTRO NATURALEZA / PLANTA ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), isRival ? M.tunicDark : M.tunic, tracker, 0, 0, 0);

    // Banda diagonal tejida contorneada frente y espalda en esmeralda/corteza con ribete musgo dorado
    for (const [zOff, curv] of [[0.108, 0.056], [-0.104, -0.050]]) {
      addTrackedMesh(chest, createContouredChestStrapGeo(0.056, 0.36, 0.022, curv), M.tunicDark, tracker, 0.015, 0.20, zOff, {
        rot: [0, 0, -0.44],
      });
      addTrackedMesh(chest, createContouredChestStrapGeo(0.02, 0.35, 0.024, curv), mossGoldMat, tracker, 0.036, 0.205, zOff * 1.04, {
        rot: [0, 0, -0.44],
      });
    }

    // Cuello orgánico de hojas superpuestas rodeando la base del cuello y trapecios
    const collarLeafGeo = createLeafBladeGeometry(0.16, 0.095, 0.018);
    const collarSpecs = [
      { x: 0.075, y: 0.345, z: 0.092, rx: 0.55, ry: 0.45, rz: -0.25, mat: M.ochre },
      { x: -0.075, y: 0.345, z: 0.092, rx: 0.55, ry: -0.45, rz: 0.25, mat: M.tunicDark },
      { x: 0.132, y: 0.335, z: 0.015, rx: 0.25, ry: 1.4, rz: -0.35, mat: M.tunic },
      { x: -0.132, y: 0.335, z: 0.015, rx: 0.25, ry: -1.4, rz: 0.35, mat: M.ochre },
      { x: 0.068, y: 0.348, z: -0.098, rx: -0.45, ry: 2.65, rz: 0.18, mat: M.tunicDark },
      { x: -0.068, y: 0.348, z: -0.098, rx: -0.45, ry: -2.65, rz: -0.18, mat: M.ochre },
    ];
    for (const c of collarSpecs) {
      addTrackedMesh(chest, collarLeafGeo, c.mat, tracker, c.x, c.y, c.z, { rot: [c.rx, c.ry, c.rz] });
    }

    // Fajín de corteza/musgo y 4 faldones en forma de hojas largas
    addTrackedMesh(hips, createFittedSashGeometry(0.151, 0.111, 0.098), barkMat, tracker, 0, 0.048, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.155, 0.115, 0.026), mossGoldMat, tracker, 0, 0.082, 0);
    addTrackedMesh(hips, new THREE.TorusGeometry(0.032, 0.011, 8, 16), M.ochre, tracker, 0.09, 0.052, 0.092);

    const skirtLeafGeo = createLeafBladeGeometry(0.28, 0.145, 0.022);
    const leafFlaps = [
      { x: 0.148, y: 0.015, z: 0.02, ry: Math.PI / 2, axis: 'rz', sign: 1, mat: M.tunicDark },
      { x: -0.148, y: 0.015, z: 0.02, ry: -Math.PI / 2, axis: 'rz', sign: -1, mat: M.ochre },
      { x: 0.075, y: 0.015, z: -0.112, ry: Math.PI, axis: 'rx', sign: 1, mat: M.tunicDark },
      { x: -0.075, y: 0.015, z: -0.112, ry: Math.PI, axis: 'rx', sign: 1, mat: M.tunic },
    ];
    for (const lf of leafFlaps) {
      const pivot = new THREE.Group();
      pivot.position.set(lf.x, lf.y, lf.z);
      hips.add(pivot);
      tracker.push(pivot);
      addTrackedMesh(pivot, skirtLeafGeo, lf.mat, tracker, 0, -0.13, 0, {
        rot: [Math.PI * 0.5, 0, lf.ry * 0.35],
      });
      secondaryParts.flaps.push({ pivot, axis: lf.axis, sign: lf.sign, baseTilt: 0.16 });
    }
  } else if (element === 'psychic') {
    // --- MAESTRO PSÍQUICO ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), isRival ? M.tunicDark : M.tunic, tracker, 0, 0, 0);

    // Cuello alto rígido índigo suave con aro plateado geométrico
    addTrackedMesh(chest, new THREE.CylinderGeometry(0.072, 0.088, 0.078, 24, 2, false), violetMat, tracker, 0, 0.376, 0.004, {
      scale: [1.08, 1, 0.96],
    });
    addTrackedMesh(chest, new THREE.TorusGeometry(0.076, 0.008, 8, 24), silverMat, tracker, 0, 0.412, 0.004, {
      rot: [Math.PI / 2, 0, 0],
      scale: [1.08, 0.96, 1],
    });

    // Ribetes plateados en V contorneados + gema magenta biselada en el pecho
    for (const s of [1, -1]) {
      addTrackedMesh(chest, createContouredChestStrapGeo(0.018, 0.29, 0.022, 0.054), silverMat, tracker, s * 0.032, 0.21, 0.112, {
        rot: [0, 0, s * 0.38],
      });
    }
    addTrackedMesh(chest, createRoundedBuckleGeo(0.044, 0.068, 0.022), M.ochre, tracker, 0, 0.23, 0.158, {
      noOutline: true,
    });

    // Estola astral flotante curva sobre hombros + 2 bufandas divididas con onda de vértices
    const stoleRing = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.168, rz: 0.122, tubeR: 0.035, drapeFront: 0.036, drapeBack: 0.03 }),
      M.ochre,
      tracker,
      0,
      0.332,
      0.002
    );
    stoleRing.castShadow = true;

    for (let idx = 0; idx < 2; idx++) {
      const sideX = idx === 0 ? -0.084 : 0.084;
      const scarfPivot = new THREE.Group();
      scarfPivot.position.set(sideX, 0.31, -0.125);
      chest.add(scarfPivot);
      tracker.push(scarfPivot);
      const sashGeo = createCurvedClothPanelGeo({
        width: 0.08,
        height: 0.44,
        depth: 0.018,
        curveZ: -0.034,
        taperTop: 0.82,
        taperBottom: 1.24,
        segW: 5,
        segH: 10,
      });
      const sashMesh = addTrackedMesh(scarfPivot, sashGeo, M.ochre, tracker, 0, 0, -0.01, {
        rot: [0.18, 0, sideX * 0.65],
      });
      registerClothWave(sashMesh, secondaryParts, 0.44, idx * 1.4, 1.25);

      const trimGeo = createCurvedClothPanelGeo({
        width: 0.088,
        height: 0.032,
        depth: 0.022,
        curveZ: -0.004,
        taperTop: 0.98,
        taperBottom: 1.02,
        segW: 4,
        segH: 2,
      });
      addTrackedMesh(sashMesh, trimGeo, silverMat, tracker, 0, -0.37, -0.014, { noOutline: true });
      secondaryParts.scarves.push({ pivot: scarfPivot, phase: idx * 1.4 });
    }

    // Aro de runas levitando detrás de los hombros
    const runeHalo = createRuneHaloGroup(0.32, 6, 0.92);
    runeHalo.group.position.set(0, 0.30, -0.22);
    chest.add(runeHalo.group);
    tracker.push(runeHalo.group);
    secondaryParts.runeHalo = { group: runeHalo.group, baseY: 0.30 };

    // Fajín violeta con faldones curvos divididos y emblema plateado
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.085), violetMat, tracker, 0, 0.048, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.154, 0.114, 0.022), silverMat, tracker, 0, 0.082, 0);

    const psyFlaps = [
      { x: 0.148, y: 0.015, z: 0.02, ry: Math.PI / 2, w: 0.17, h: 0.30, axis: 'rz', sign: 1, phase: 0.3 },
      { x: -0.148, y: 0.015, z: 0.02, ry: -Math.PI / 2, w: 0.17, h: 0.30, axis: 'rz', sign: -1, phase: 1.6 },
      { x: 0.076, y: 0.015, z: -0.114, ry: Math.PI, w: 0.13, h: 0.32, axis: 'rx', sign: 1, phase: 2.5 },
      { x: -0.076, y: 0.015, z: -0.114, ry: Math.PI, w: 0.13, h: 0.32, axis: 'rx', sign: 1, phase: 3.4 },
    ];
    for (const pf of psyFlaps) {
      const wrap = addSkirtFlap(hips, { ...pf, mat: M.tunicDark, trimMat: M.ochre, baseTilt: 0.16 });
      addTrackedMesh(wrap, createRoundedBuckleGeo(0.036, 0.052, 0.014), silverMat, tracker, 0, -pf.h * 0.32, 0.022, {
        noOutline: true,
      });
    }
  } else if (element === 'storm') {
    // --- MAESTRO TORMENTA ---
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunic, tracker, 0, 0, 0);

    // Solapa asimétrica curvada en gris pizarra con ribetes eléctrico/dorado abrazando el pecho
    addTrackedMesh(chest, createContouredChestStrapGeo(0.125, 0.33, 0.022, 0.052), M.tunicDark, tracker, -0.036, 0.20, 0.108, {
      rot: [0.06, 0, 0.24],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.02, 0.34, 0.024, 0.056), stormBlueMat, tracker, 0.024, 0.205, 0.114, {
      rot: [0.06, 0, 0.24],
      noOutline: true,
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.015, 0.29, 0.024, 0.052), boltGoldMat, tracker, -0.07, 0.21, 0.106, {
      rot: [0.05, 0, 0.18],
      noOutline: true,
    });
    addTrackedMesh(chest, createRoundedBuckleGeo(0.036, 0.062, 0.016), boltGoldMat, tracker, 0.062, 0.245, 0.154, {
      rot: [0, 0, -0.35],
      noOutline: true,
    });

    // Cuello alto tormenta suave con ribete azul eléctrico
    const stormCollar = addTrackedMesh(
      chest,
      new THREE.CylinderGeometry(0.106, 0.116, 0.092, 24, 2, true, Math.PI * 0.22, Math.PI * 1.56),
      M.tunicDark,
      tracker,
      0,
      0.382,
      -0.01
    );
    stormCollar.castShadow = true;
    addTrackedMesh(
      chest,
      new THREE.TorusGeometry(0.106, 0.012, 8, 22, Math.PI * 1.54),
      stormBlueMat,
      tracker,
      0,
      0.425,
      -0.01,
      { rot: [Math.PI / 2, 0, -Math.PI * 0.27], noOutline: true }
    );

    // Capa/bufanda de niebla vaporosa moldeada sobre los hombros + 2 caídas subdivididas con onda fluida
    const mistShawl = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.166, rz: 0.124, tubeR: 0.036, drapeFront: 0.036, drapeBack: 0.028 }),
      mistSilverMat,
      tracker,
      0,
      0.332,
      -0.004
    );
    mistShawl.castShadow = true;

    for (let idx = 0; idx < 2; idx++) {
      const sideX = idx === 0 ? -0.095 : 0.095;
      const scarfPivot = new THREE.Group();
      scarfPivot.position.set(sideX, 0.315, -0.128);
      chest.add(scarfPivot);
      tracker.push(scarfPivot);
      const mistTailGeo = createCurvedClothPanelGeo({
        width: 0.11,
        height: 0.46,
        depth: 0.02,
        curveZ: -0.036,
        taperTop: 0.84,
        taperBottom: 1.24,
        segW: 5,
        segH: 10,
      });
      const mistTail = addTrackedMesh(scarfPivot, mistTailGeo, mistSilverMat, tracker, 0, 0, -0.012, {
        rot: [0.22, 0, sideX * 0.72],
      });
      registerClothWave(mistTail, secondaryParts, 0.46, idx * 1.55, 1.3);

      addTrackedMesh(
        mistTail,
        createCurvedClothPanelGeo({ width: 0.124, height: 0.032, depth: 0.024, curveZ: -0.005, taperTop: 0.98, taperBottom: 1.02, segW: 4, segH: 2 }),
        stormBlueMat,
        tracker,
        0,
        -0.39,
        -0.016,
        { noOutline: true }
      );
      addTrackedMesh(
        mistTail,
        createCurvedClothPanelGeo({ width: 0.095, height: 0.02, depth: 0.025, curveZ: -0.004, taperTop: 0.98, taperBottom: 1.0, segW: 4, segH: 2 }),
        boltGoldMat,
        tracker,
        0,
        -0.34,
        -0.02,
        { noOutline: true }
      );
      secondaryParts.scarves.push({ pivot: scarfPivot, phase: idx * 1.55 });
    }

    // Fajín pizarra con borde eléctrico y faldones curvos asimétricos
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.09), M.tunicDark, tracker, 0, 0.048, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.154, 0.114, 0.024), stormBlueMat, tracker, 0, 0.082, 0);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.052, 0.062, 0.024), boltGoldMat, tracker, 0, 0.06, 0.116, {
      noOutline: true,
    });

    const stormFlaps = [
      { x: 0.15, y: 0.012, z: 0.01, ry: Math.PI / 2, w: 0.19, h: 0.30, axis: 'rz', sign: 1, phase: 0.2 },
      { x: -0.15, y: 0.012, z: 0.01, ry: -Math.PI / 2, w: 0.19, h: 0.30, axis: 'rz', sign: -1, phase: 1.7 },
      { x: 0.0, y: 0.012, z: -0.118, ry: Math.PI, w: 0.26, h: 0.34, axis: 'rx', sign: 1, phase: 2.8 },
    ];
    for (const sf of stormFlaps) {
      addSkirtFlap(hips, { ...sf, mat: M.tunicDark, trimMat: stormBlueMat, trimMat2: boltGoldMat, baseTilt: 0.16 });
    }
  } else if (element === 'light') {
    // --- MAESTRO LUZ / PRISMA ---
    // Túnica marcial asimétrica blanco perlado con solapa marfil, ribetes dorado solar y gema prismática
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunic, tracker, 0, 0, 0);

    // Solapa asimétrica curva y ribetes dorado solar en pecho
    addTrackedMesh(chest, createContouredChestStrapGeo(0.088, 0.34, 0.02, 0.054), M.tunicDark, tracker, -0.024, 0.205, 0.105, {
      rot: [0.05, 0, 0.28],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.022, 0.35, 0.024, 0.06), solarGoldMat, tracker, 0.022, 0.21, 0.116, {
      rot: [0.05, 0, 0.28],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.018, 0.31, 0.024, 0.058), prismCyanMat, tracker, -0.056, 0.205, 0.11, {
      rot: [0.04, 0, 0.22],
      noOutline: true,
    });
    addTrackedMesh(chest, createRoundedBuckleGeo(0.044, 0.064, 0.022), prismCyanMat, tracker, 0.048, 0.245, 0.156, {
      noOutline: true,
    });

    // Cuello solar elevado suave con aro dorado
    addTrackedMesh(chest, new THREE.CylinderGeometry(0.072, 0.088, 0.072, 24, 2, false), M.tunicDark, tracker, 0, 0.376, 0.004, {
      scale: [1.08, 1, 0.96],
    });
    addTrackedMesh(chest, new THREE.TorusGeometry(0.076, 0.0085, 8, 24), solarGoldMat, tracker, 0, 0.41, 0.004, {
      rot: [Math.PI / 2, 0, 0],
      scale: [1.08, 0.96, 1],
    });

    // Estola / capa luminosa moldeada sobre clavículas + 2 cintas largas traseras ondulantes
    const lightShawl = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.164, rz: 0.12, tubeR: 0.032, drapeFront: 0.032, drapeBack: 0.028 }),
      solarGoldMat,
      tracker,
      0,
      0.332,
      0.002
    );
    lightShawl.castShadow = true;

    for (let idx = 0; idx < 2; idx++) {
      const sideX = idx === 0 ? -0.088 : 0.088;
      const scarfPivot = new THREE.Group();
      scarfPivot.position.set(sideX, 0.312, -0.124);
      chest.add(scarfPivot);
      tracker.push(scarfPivot);
      const capeTailGeo = createCurvedClothPanelGeo({
        width: 0.092,
        height: 0.45,
        depth: 0.018,
        curveZ: -0.034,
        taperTop: 0.84,
        taperBottom: 1.24,
        segW: 5,
        segH: 10,
      });
      const capeTail = addTrackedMesh(scarfPivot, capeTailGeo, M.tunicDark, tracker, 0, 0, -0.012, {
        rot: [0.2, 0, sideX * 0.68],
      });
      registerClothWave(capeTail, secondaryParts, 0.45, idx * 1.45, 1.3);

      addTrackedMesh(
        capeTail,
        createCurvedClothPanelGeo({ width: 0.1, height: 0.03, depth: 0.022, curveZ: -0.004, taperTop: 0.98, taperBottom: 1.02, segW: 4, segH: 2 }),
        solarGoldMat,
        tracker,
        0,
        -0.38,
        -0.016
      );
      addTrackedMesh(
        capeTail,
        createCurvedClothPanelGeo({ width: 0.078, height: 0.018, depth: 0.024, curveZ: -0.004, taperTop: 0.98, taperBottom: 1.0, segW: 4, segH: 2 }),
        prismCyanMat,
        tracker,
        0,
        -0.33,
        -0.018,
        { noOutline: true }
      );
      secondaryParts.scarves.push({ pivot: scarfPivot, phase: idx * 1.45 });
    }

    // Dos pequeños prismas cristalinos flotando detrás de los hombros
    const wingCrystalGeo = new THREE.OctahedronGeometry(0.068, 0);
    wingCrystalGeo.scale(0.62, 1.65, 0.62);
    const wingRingGeo = new THREE.TorusGeometry(0.082, 0.009, 8, 20);
    for (const [idx, sx] of [-0.21, 0.21].entries()) {
      const pGroup = new THREE.Group();
      pGroup.position.set(sx, 0.36, -0.2);
      pGroup.rotation.z = sx > 0 ? -0.24 : 0.24;
      chest.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, wingCrystalGeo, prismCyanMat, tracker, 0, 0, 0, { castShadow: false });
      addTrackedMesh(pGroup, wingRingGeo, solarGoldMat, tracker, 0, 0, 0, {
        rot: [Math.PI * 0.36, 0, 0],
        noOutline: true,
        castShadow: false,
      });
      secondaryParts.prismWings.push({ group: pGroup, baseY: 0.36, phase: idx * 1.7 });
    }

    // Fajín dorado solar con broche cian y faldones perlados curvos
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.088), solarGoldMat, tracker, 0, 0.048, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.154, 0.114, 0.022), M.ochreDark, tracker, 0, 0.082, 0);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.056, 0.058, 0.024), prismCyanMat, tracker, 0, 0.054, 0.116, {
      noOutline: true,
    });

    const lightFlaps = [
      { x: 0.148, y: 0.012, z: 0.015, ry: Math.PI / 2, w: 0.18, h: 0.3, axis: 'rz', sign: 1, phase: 0.25 },
      { x: -0.148, y: 0.012, z: 0.015, ry: -Math.PI / 2, w: 0.18, h: 0.3, axis: 'rz', sign: -1, phase: 1.55 },
      { x: 0.0, y: 0.012, z: -0.116, ry: Math.PI, w: 0.25, h: 0.33, axis: 'rx', sign: 1, phase: 2.7 },
    ];
    for (const lf of lightFlaps) {
      addSkirtFlap(hips, { ...lf, mat: M.tunic, trimMat: solarGoldMat, trimMat2: prismCyanMat, baseTilt: 0.15 });
    }
  } else if (element === 'shadow') {
    // --- MAESTRO SOMBRA ---
    // Túnica marcial ajustada negro obsidiana / índigo nocturno con cuello alto asimétrico y ribetes carmesí/violeta
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunic, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunic, tracker, 0, 0, 0);

    // Solapa asimétrica índigo + ribetes curvos carmesí/violeta en torso
    addTrackedMesh(chest, createContouredChestStrapGeo(0.086, 0.34, 0.02, 0.054), M.tunicDark, tracker, 0.022, 0.205, 0.105, {
      rot: [0.05, 0, -0.28],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.02, 0.35, 0.024, 0.06), shadowCrimsonMat, tracker, -0.022, 0.21, 0.116, {
      rot: [0.05, 0, -0.28],
      noOutline: true,
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.018, 0.31, 0.024, 0.058), shadowVioletMat, tracker, 0.054, 0.205, 0.11, {
      rot: [0.04, 0, -0.22],
      noOutline: true,
    });
    addTrackedMesh(chest, createRoundedBuckleGeo(0.042, 0.058, 0.02), shadowCrimsonMat, tracker, -0.048, 0.242, 0.155, {
      noOutline: true,
    });

    // Cuello alto asimétrico shinobi con aro violeta-carmesí
    addTrackedMesh(chest, new THREE.CylinderGeometry(0.076, 0.09, 0.088, 24, 2, false), M.tunicDark, tracker, 0, 0.382, 0.004, {
      scale: [1.08, 1, 0.96],
    });
    addTrackedMesh(chest, new THREE.TorusGeometry(0.079, 0.008, 8, 24), shadowCrimsonMat, tracker, 0, 0.422, 0.004, {
      rot: [Math.PI / 2, 0.08, 0],
      scale: [1.08, 0.96, 1],
      noOutline: true,
    });

    // Bufanda nocturna envolvente y 3 jirones de capa desgarrada de humo sombrío con onda sinusoidal
    const shadowShawl = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.166, rz: 0.122, tubeR: 0.034, drapeFront: 0.036, drapeBack: 0.03 }),
      M.tunicDark,
      tracker,
      0,
      0.334,
      0.002
    );
    shadowShawl.castShadow = true;

    const capeTatters = [
      { x: 0.0, y: 0.316, z: -0.126, w: 0.12, h: 0.56, tiltZ: 0.0, phase: 0.2, mat: M.tunic },
      { x: -0.092, y: 0.308, z: -0.116, w: 0.084, h: 0.46, tiltZ: -0.12, phase: 1.5, mat: M.tunicDark },
      { x: 0.092, y: 0.308, z: -0.116, w: 0.084, h: 0.46, tiltZ: 0.12, phase: 2.8, mat: M.tunicDark },
    ];
    for (const ct of capeTatters) {
      const scarfPivot = new THREE.Group();
      scarfPivot.position.set(ct.x, ct.y, ct.z);
      chest.add(scarfPivot);
      tracker.push(scarfPivot);

      const tatterGeo = createCurvedClothPanelGeo({
        width: ct.w,
        height: ct.h,
        depth: 0.016,
        curveZ: -0.038,
        taperTop: 0.9,
        taperBottom: 0.42, // Jirones desgarrados afilados en la punta
        segW: 5,
        segH: 12,
      });
      const tatterMesh = addTrackedMesh(scarfPivot, tatterGeo, ct.mat, tracker, 0, 0, -0.01, {
        rot: [0.22, 0, ct.tiltZ],
      });
      registerClothWave(tatterMesh, secondaryParts, ct.h, ct.phase, 1.45);

      addTrackedMesh(
        tatterMesh,
        createCurvedClothPanelGeo({
          width: ct.w * 0.72,
          height: 0.04,
          depth: 0.018,
          curveZ: -0.005,
          taperTop: 0.9,
          taperBottom: 0.45,
          segW: 4,
          segH: 2,
        }),
        shadowCrimsonMat,
        tracker,
        0,
        -ct.h * 0.84,
        -0.018,
        { noOutline: true }
      );
      secondaryParts.scarves.push({ pivot: scarfPivot, phase: ct.phase });
    }

    // Fajín oscuro con núcleo eclipse y faldones divididos curvos
    addTrackedMesh(hips, createFittedSashGeometry(0.15, 0.11, 0.088), M.tunicDark, tracker, 0, 0.048, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.154, 0.114, 0.022), shadowVioletMat, tracker, 0, 0.082, 0);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.052, 0.052, 0.022), shadowCrimsonMat, tracker, 0, 0.054, 0.116, {
      noOutline: true,
    });

    const shadowFlaps = [
      { x: 0.148, y: 0.012, z: 0.015, ry: Math.PI / 2, w: 0.18, h: 0.31, axis: 'rz', sign: 1, phase: 0.35 },
      { x: -0.148, y: 0.012, z: 0.015, ry: -Math.PI / 2, w: 0.18, h: 0.31, axis: 'rz', sign: -1, phase: 1.75 },
      { x: -0.065, y: 0.012, z: -0.116, ry: Math.PI, w: 0.12, h: 0.34, axis: 'rx', sign: 1, phase: 2.6 },
      { x: 0.065, y: 0.012, z: -0.116, ry: Math.PI, w: 0.12, h: 0.34, axis: 'rx', sign: 1, phase: 3.1 },
    ];
    for (const sf of shadowFlaps) {
      addSkirtFlap(hips, { ...sf, mat: M.tunicDark, trimMat: shadowVioletMat, trimMat2: shadowCrimsonMat, baseTilt: 0.16 });
    }
  } else if (element === 'samurai') {
    // --- SAMURÁI (RŌNIN) ---
    // Túnica marcial cruzada negro-carmesí, hakama con pliegues amplios, fajín dorado y vaina (saya) en cintura izquierda
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), M.tunicDark, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), M.tunicDark, tracker, 0, 0, 0);

    // Solapas cruzadas estilo keikogi negro/carmesí
    addTrackedMesh(chest, createContouredChestStrapGeo(0.095, 0.36, 0.02, 0.056), M.tunic, tracker, -0.02, 0.21, 0.102, {
      rot: [0.05, 0, 0.28],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.088, 0.36, 0.022, 0.058), M.tunicDark, tracker, 0.026, 0.21, 0.106, {
      rot: [0.05, 0, -0.28],
    });
    addTrackedMesh(chest, createContouredChestStrapGeo(0.022, 0.35, 0.024, 0.06), M.ochre, tracker, 0.015, 0.212, 0.114, {
      rot: [0.05, 0, -0.26],
      noOutline: true,
    });

    // Cuello de kimono rígido + bufanda ligera carmesí en hombros
    const samCollar = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.165, rz: 0.12, tubeR: 0.03, drapeFront: 0.032, drapeBack: 0.025 }),
      M.tunic,
      tracker,
      0,
      0.34,
      0.004
    );
    samCollar.castShadow = true;

    // Fajín dorado (obi) + nudo delantero + saya (funda de katana en la cadera izquierda)
    addTrackedMesh(hips, createFittedSashGeometry(0.156, 0.116, 0.096), M.ochre, tracker, 0, 0.052, 0);
    addTrackedMesh(hips, createFittedSashGeometry(0.16, 0.12, 0.028), M.tunic, tracker, 0, 0.05, 0);
    addTrackedMesh(hips, createRoundedBuckleGeo(0.052, 0.044, 0.022), M.ochreDark, tracker, 0, 0.054, 0.118);

    // Vaina (saya) curva en el costado izquierdo (x > 0 es lado izquierdo del personaje)
    const saya = createSayaGroup(isRival);
    saya.group.position.set(0.175, 0.03, 0.02);
    saya.group.rotation.set(-0.34, -0.14, 0.06);
    hips.add(saya.group);
    tracker.push(saya.group);
    saya.group.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        tracker.push(c);
      }
    });
    extraMaterials.push(...saya.materials);

    // Pliegues amplios de hakama alrededor de la cadera
    const hakamaFlaps = [
      { x: 0, y: 0.012, z: 0.115, ry: 0, w: 0.22, h: 0.34, axis: 'rx', sign: -1, phase: 0.2 },
      { x: 0.155, y: 0.012, z: 0.01, ry: Math.PI / 2, w: 0.2, h: 0.35, axis: 'rz', sign: 1, phase: 1.0 },
      { x: -0.155, y: 0.012, z: 0.01, ry: -Math.PI / 2, w: 0.2, h: 0.35, axis: 'rz', sign: -1, phase: 1.8 },
      { x: 0, y: 0.012, z: -0.118, ry: Math.PI, w: 0.23, h: 0.36, axis: 'rx', sign: 1, phase: 2.6 },
    ];
    for (const hf of hakamaFlaps) {
      addSkirtFlap(hips, { ...hf, mat: M.pants, trimMat: M.ochre, trimMat2: M.tunic, baseTilt: 0.18 });
    }
  } else {
    // --- MAESTRO AIRE ---
    const airBodyMat = isRival ? M.tunic : M.ochre;
    const airShawlMat = isRival ? M.ochre : M.tunic;
    addTrackedMesh(spine, createAthleticAbdomenGeometry(), airBodyMat, tracker, 0, 0, 0);
    addTrackedMesh(chest, createAthleticChestGeometry(), airBodyMat, tracker, 0, 0, 0);

    const shawlRing = addTrackedMesh(
      chest,
      createDrapedShawlGeo({ rx: 0.164, rz: 0.118, tubeR: 0.034, drapeFront: 0.032, drapeBack: 0.026 }),
      airShawlMat,
      tracker,
      0,
      0.326,
      0.002
    );
    shawlRing.castShadow = true;

    for (const [idx, sx] of [-0.075, 0.075].entries()) {
      const backTailPivot = new THREE.Group();
      backTailPivot.position.set(sx, 0.31, -0.11);
      chest.add(backTailPivot);
      tracker.push(backTailPivot);
      const backTailGeo = createCurvedClothPanelGeo({
        width: 0.098,
        height: 0.34,
        depth: 0.02,
        curveZ: -0.028,
        taperTop: 0.85,
        taperBottom: 1.18,
        segW: 5,
        segH: 8,
      });
      const btMesh = addTrackedMesh(backTailPivot, backTailGeo, airShawlMat, tracker, 0, 0, -0.008, {
        rot: [0.06, 0, sx * 0.45],
      });
      registerClothWave(btMesh, secondaryParts, 0.34, idx * 1.4, 1.0);
      secondaryParts.flaps.push({ pivot: backTailPivot, axis: 'rx', sign: 1, baseTilt: 0.14 });
    }

    addTrackedMesh(hips, createFittedSashGeometry(0.148, 0.108, 0.098), airShawlMat, tracker, 0, 0.05, 0);
    for (const side of [-1, 1]) {
      const sashPivot = new THREE.Group();
      sashPivot.position.set(side * 0.142, 0.03, 0.035);
      hips.add(sashPivot);
      tracker.push(sashPivot);
      const sashTailGeo = createCurvedClothPanelGeo({
        width: 0.058,
        height: 0.25,
        depth: 0.015,
        curveZ: 0.018,
        taperTop: 0.88,
        taperBottom: 1.14,
        segW: 4,
        segH: 7,
      });
      const stMesh = addTrackedMesh(sashPivot, sashTailGeo, airShawlMat, tracker, 0, 0, 0, {
        rot: [0, 0, side * 0.12],
      });
      registerClothWave(stMesh, secondaryParts, 0.25, side > 0 ? 0.5 : 2.1, 0.85);
      secondaryParts.flaps.push({ pivot: sashPivot, axis: 'rz', sign: side, baseTilt: 0.12 });
    }
  }

  // 3. Hombros integrados, hombreras curvas esculpidas, mangas, antebrazos y puños anime
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const shoulder = joints[`shoulder${side}`];
    const elbow = joints[`elbow${side}`];
    const wrist = joints[`wrist${side}`];

    const sleeveMat =
      element === 'water' || element === 'nature' || element === 'psychic' || element === 'light' || element === 'shadow'
        ? M.tunic
        : element === 'samurai'
          ? M.tunicDark
          : element === 'earth' || element === 'storm'
            ? M.tunic
            : element === 'air'
              ? (isRival ? M.tunic : M.ochre)
              : M.tunicDark;

    addTrackedMesh(
      shoulder,
      createDeltoidGeometry(s, element === 'water' || element === 'fire' || element === 'light' || element === 'shadow' ? 0.08 : 0.084),
      sleeveMat,
      tracker,
      0,
      0,
      0,
      { noOutline: element === 'earth' || element === 'air' || element === 'psychic' }
    );
    addTrackedMesh(
      shoulder,
      createTaperedLimbGeometry(0.062, 0.048, UPPER_ARM, 1.0, 1.08),
      element === 'fire' || element === 'nature' || element === 'storm' || element === 'light' || element === 'shadow' || element === 'samurai' ? M.skin : sleeveMat,
      tracker,
      0,
      0,
      0,
      { noOutline: element === 'earth' || element === 'air' || element === 'psychic' }
    );

    if (element === 'earth' || element === 'air' || element === 'psychic') {
      addTrackedMesh(
        shoulder,
        createTaperedLimbGeometry(0.080, 0.088, UPPER_ARM * 0.86, 1.05, 1.06),
        sleeveMat,
        tracker,
        0,
        -0.01,
        0
      );
      if (element === 'psychic') {
        addTrackedMesh(shoulder, new THREE.TorusGeometry(0.084, 0.01, 8, 22), silverMat, tracker, 0, -UPPER_ARM * 0.82, 0, {
          rot: [Math.PI / 2, 0, 0],
        });
      }
    } else if (element === 'nature') {
      // Hombreras ligeras curvas esculpidas de madera/corteza + ribete dorado + hoja lateral
      const pGroup = new THREE.Group();
      pGroup.position.set(s * 0.016, 0.032, 0);
      pGroup.rotation.z = -s * 0.34;
      shoulder.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.165, depth: 0.17, archH: 0.048, flare: 0.022 }), barkMat, tracker, s * 0.024, -0.008, 0);
      addTrackedMesh(pGroup, new THREE.TorusGeometry(0.084, 0.0105, 8, 22), mossGoldMat, tracker, s * 0.026, -0.006, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
      const shoulderLeaf = createLeafBladeGeometry(0.14, 0.068, 0.014);
      addTrackedMesh(pGroup, shoulderLeaf, M.ochre, tracker, s * 0.095, 0.012, 0, {
        rot: [0, s * Math.PI * 0.5, -s * 0.25],
      });
    } else if (element === 'storm') {
      // Hombreras aerodinámicas curvas gris pizarra con borde eléctrico y remate rayo
      const pGroup = new THREE.Group();
      pGroup.position.set(s * 0.016, 0.032, 0);
      pGroup.rotation.z = -s * 0.34;
      shoulder.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.172, depth: 0.174, archH: 0.048, flare: 0.032 }), M.tunicDark, tracker, s * 0.025, -0.008, 0);
      addTrackedMesh(pGroup, new THREE.TorusGeometry(0.086, 0.01, 8, 22), stormBlueMat, tracker, s * 0.027, -0.006, 0, {
        rot: [Math.PI / 2, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(pGroup, createRoundedBuckleGeo(0.042, 0.02, 0.02), boltGoldMat, tracker, s * 0.092, 0.01, 0, {
        noOutline: true,
      });
    } else if (element === 'fire') {
      addTrackedMesh(shoulder, new THREE.TorusGeometry(0.068, 0.01, 8, 22), M.ochre, tracker, 0, -0.072, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
      // Hombreras laminares curvas estilizadas con borde dorado y aleta afilada suave
      const pGroup = new THREE.Group();
      pGroup.position.set(s * 0.016, 0.034, 0);
      pGroup.rotation.z = -s * 0.34;
      shoulder.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.168, depth: 0.178, archH: 0.052, flare: 0.034 }), M.tunicDark, tracker, s * 0.028, -0.008, 0);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.176, depth: 0.184, archH: 0.024, flare: 0.036 }), M.ochre, tracker, s * 0.032, -0.014, 0);
      const bladeFin = createCurvedStrandGeo(
        [
          new THREE.Vector3(s * 0.06, 0.01, 0),
          new THREE.Vector3(s * 0.105, 0.014, 0),
          new THREE.Vector3(s * 0.145, -0.004, 0),
        ],
        0.028,
        0.004,
        10,
        10,
        0.55
      );
      addTrackedMesh(pGroup, bladeFin, M.tunic, tracker);
    } else if (element === 'light') {
      // Hombreras anatómicas curvas dorado solar con incrustación cian prismática
      const pGroup = new THREE.Group();
      pGroup.position.set(s * 0.016, 0.032, 0);
      pGroup.rotation.z = -s * 0.34;
      shoulder.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.168, depth: 0.172, archH: 0.048, flare: 0.028 }), solarGoldMat, tracker, s * 0.026, -0.008, 0);
      addTrackedMesh(pGroup, new THREE.TorusGeometry(0.084, 0.0095, 8, 22), M.tunic, tracker, s * 0.026, -0.006, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
      addTrackedMesh(pGroup, createRoundedBuckleGeo(0.036, 0.022, 0.024), prismCyanMat, tracker, s * 0.084, 0.014, 0, {
        noOutline: true,
      });
    } else if (element === 'shadow') {
      // Hombreras ligeras curvas estilo shinobi/monje nocturno con filo carmesí
      const pGroup = new THREE.Group();
      pGroup.position.set(s * 0.016, 0.032, 0);
      pGroup.rotation.z = -s * 0.36;
      shoulder.add(pGroup);
      tracker.push(pGroup);
      addTrackedMesh(pGroup, createSculptedPauldronGeo(s, { width: 0.16, depth: 0.165, archH: 0.044, flare: 0.03 }), M.tunicDark, tracker, s * 0.024, -0.008, 0);
      addTrackedMesh(pGroup, new THREE.TorusGeometry(0.08, 0.009, 8, 22), shadowVioletMat, tracker, s * 0.024, -0.006, 0, {
        rot: [Math.PI / 2, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(pGroup, createRoundedBuckleGeo(0.034, 0.018, 0.02), shadowCrimsonMat, tracker, s * 0.082, 0.012, 0, {
        noOutline: true,
      });
    }

    // Articulación del codo continua
    const elbowMat = element === 'water' ? M.tunic : M.skin;
    addTrackedMesh(elbow, new THREE.SphereGeometry(0.049, 22, 16), elbowMat, tracker);

    // Antebrazo esculpido con `LatheGeometry` (28 segs)
    const forearmMat = element === 'water' ? M.tunic : M.skin;
    addTrackedMesh(elbow, createTaperedLimbGeometry(0.052, 0.038, FOREARM, 1.02, 1.06), forearmMat, tracker);

    if (element === 'water') {
      // Puño de piel blanca suave + brazalete marino
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        addTrackedMesh(
          elbow,
          new THREE.SphereGeometry(0.022, 12, 10),
          furMat,
          tracker,
          Math.cos(a) * 0.041,
          -FOREARM + 0.075,
          Math.sin(a) * 0.041,
          { noOutline: i % 2 === 1 }
        );
      }
      addTrackedMesh(elbow, createLatheLimbGeometry(0.047, 0.042, 0.062, { radialSegments: 22, heightSegments: 6, bellyAmp: 0.04, capRound: 0.008 }), M.tunicDark, tracker, 0, -FOREARM + 0.066, 0);
    } else if (element === 'fire') {
      addTrackedMesh(elbow, createLatheLimbGeometry(0.053, 0.044, 0.155, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.04, capRound: 0.01 }), darkMetalMat, tracker, 0, -FOREARM + 0.165, 0);
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.051, 0.0085, 8, 22), M.ochre, tracker, 0, -FOREARM + 0.155, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
    } else if (element === 'nature') {
      addTrackedMesh(elbow, createLatheLimbGeometry(0.05, 0.042, 0.145, { radialSegments: 22, heightSegments: 8, bellyAmp: 0.03, capRound: 0.008 }), barkMat, tracker, 0, -FOREARM + 0.155, 0);
      for (let v = 0; v < 3; v++) {
        addTrackedMesh(elbow, new THREE.TorusGeometry(0.049 - v * 0.003, 0.0085, 8, 18), M.ochre, tracker, 0, -FOREARM + 0.045 + v * 0.044, 0, {
          rot: [Math.PI * 0.44, 0, s * 0.22],
        });
      }
    } else if (element === 'psychic') {
      addTrackedMesh(elbow, createLatheLimbGeometry(0.052, 0.043, 0.155, { radialSegments: 22, heightSegments: 8, bellyAmp: 0.04, capRound: 0.01 }), violetMat, tracker, 0, -FOREARM + 0.165, 0);
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.055, 0.0085, 8, 20), silverMat, tracker, 0, -FOREARM + 0.15, 0, {
        rot: [Math.PI * 0.5, 0, 0],
      });
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.049, 0.0085, 8, 20), M.ochre, tracker, 0, -FOREARM + 0.05, 0, {
        rot: [Math.PI * 0.5, 0, 0],
      });
    } else if (element === 'storm') {
      addTrackedMesh(elbow, createLatheLimbGeometry(0.052, 0.043, 0.155, { radialSegments: 22, heightSegments: 8, bellyAmp: 0.04, capRound: 0.01 }), darkMetalMat, tracker, 0, -FOREARM + 0.165, 0);
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.056, 0.0085, 8, 20), stormBlueMat, tracker, 0, -FOREARM + 0.145, 0, {
        rot: [Math.PI * 0.5, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.049, 0.008, 8, 20), boltGoldMat, tracker, 0, -FOREARM + 0.052, 0, {
        rot: [Math.PI * 0.5, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(elbow, createRoundedBuckleGeo(0.02, 0.036, 0.016), boltGoldMat, tracker, s * 0.052, -FOREARM + 0.10, 0.012, {
        noOutline: true,
      });
    } else if (element === 'light') {
      // Brazales blancos perlados con anillos dorado solar y gema cian
      addTrackedMesh(elbow, createLatheLimbGeometry(0.052, 0.043, 0.155, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.04, capRound: 0.01 }), M.tunic, tracker, 0, -FOREARM + 0.165, 0);
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.054, 0.0085, 8, 20), solarGoldMat, tracker, 0, -FOREARM + 0.152, 0, {
        rot: [Math.PI * 0.5, 0, 0],
      });
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.048, 0.008, 8, 20), prismCyanMat, tracker, 0, -FOREARM + 0.054, 0, {
        rot: [Math.PI * 0.5, 0, 0],
        noOutline: true,
      });
    } else if (element === 'shadow') {
      // Brazales oscuros con anillos violeta abisal y runas carmesí brillantes
      addTrackedMesh(elbow, createLatheLimbGeometry(0.052, 0.043, 0.155, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.04, capRound: 0.01 }), M.tunicDark, tracker, 0, -FOREARM + 0.165, 0);
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.054, 0.0085, 8, 20), shadowVioletMat, tracker, 0, -FOREARM + 0.152, 0, {
        rot: [Math.PI * 0.5, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(elbow, new THREE.TorusGeometry(0.048, 0.008, 8, 20), shadowCrimsonMat, tracker, 0, -FOREARM + 0.054, 0, {
        rot: [Math.PI * 0.5, 0, 0],
        noOutline: true,
      });
      addTrackedMesh(elbow, createRoundedBuckleGeo(0.018, 0.042, 0.015), shadowCrimsonMat, tracker, s * 0.051, -FOREARM + 0.105, 0.01, {
        noOutline: true,
      });
    } else {
      addTrackedMesh(elbow, createLatheLimbGeometry(0.048, 0.041, 0.135, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.04, capRound: 0.008 }), M.wraps, tracker, 0, -FOREARM + 0.145, 0);
    }

    // Manos anatómicas esculpidas
    buildSculptedHand(wrist, M, s, tracker, element === 'water', M.tunicDark);

    // Katana curva empuñada en la mano derecha del Samurái (side === 'R')
    if (element === 'samurai' && side === 'R') {
      const katana = createKatanaGroup(isRival);
      katana.group.position.set(0, -0.04, 0.03);
      katana.group.rotation.set(0.08, 0, -0.06);
      wrist.add(katana.group);
      tracker.push(katana.group);
      katana.group.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          tracker.push(c);
        }
      });
      extraMaterials.push(...katana.materials);
    }
  }

  // 4. Piernas orgánicas, polainas suaves y botas marciales curvas
  const legStyle =
    element === 'earth' || element === 'samurai'
      ? 'hakama'
      : element === 'air' || element === 'nature' || element === 'psychic' || element === 'storm' || element === 'light'
        ? 'loose'
        : 'fitted';

  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const hip = joints[`hip${side}`];
    const knee = joints[`knee${side}`];
    const ankle = joints[`ankle${side}`];

    addTrackedMesh(hip, createPantsThighGeo(THIGH, s, legStyle), M.pants, tracker);

    const kneeR = legStyle === 'hakama' ? 0.094 : legStyle === 'loose' ? 0.088 : 0.074;
    addTrackedMesh(knee, new THREE.SphereGeometry(kneeR, 22, 16), M.pants, tracker, 0, -0.01, 0.006, {
      scale: [1.02, 0.94, 1.06],
    });

    addTrackedMesh(knee, createPantsCalfUpperGeo(CALF * 0.48, legStyle), M.pants, tracker);

    if (element === 'water') {
      addTrackedMesh(knee, createLatheLimbGeometry(0.059, 0.046, CALF * 0.56, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), M.boots, tracker, 0, -CALF * 0.44, 0);
      addTrackedMesh(knee, new THREE.TorusGeometry(0.062, 0.019, 10, 22), furMat, tracker, 0, -CALF * 0.46, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
    } else if (element === 'storm') {
      addTrackedMesh(knee, createLatheLimbGeometry(0.059, 0.044, CALF * 0.58, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), M.wraps, tracker, 0, -CALF * 0.42, 0);
      addTrackedMesh(knee, new THREE.TorusGeometry(0.060, 0.009, 8, 22), stormBlueMat, tracker, 0, -CALF * 0.46, 0, {
        rot: [Math.PI / 2, 0, 0],
        noOutline: true,
      });
    } else if (element === 'fire') {
      addTrackedMesh(knee, createLatheLimbGeometry(0.060, 0.046, CALF * 0.56, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), darkMetalMat, tracker, 0, -CALF * 0.44, 0);
      addTrackedMesh(knee, new THREE.TorusGeometry(0.062, 0.01, 8, 22), M.ochre, tracker, 0, -CALF * 0.47, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
    } else if (element === 'light') {
      addTrackedMesh(knee, createLatheLimbGeometry(0.059, 0.044, CALF * 0.58, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), M.tunic, tracker, 0, -CALF * 0.42, 0);
      addTrackedMesh(knee, new THREE.TorusGeometry(0.061, 0.0095, 8, 22), solarGoldMat, tracker, 0, -CALF * 0.46, 0, {
        rot: [Math.PI / 2, 0, 0],
      });
    } else if (element === 'shadow') {
      addTrackedMesh(knee, createLatheLimbGeometry(0.059, 0.044, CALF * 0.58, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), M.wraps, tracker, 0, -CALF * 0.42, 0);
      addTrackedMesh(knee, new THREE.TorusGeometry(0.061, 0.009, 8, 22), shadowCrimsonMat, tracker, 0, -CALF * 0.46, 0, {
        rot: [Math.PI / 2, 0, 0],
        noOutline: true,
      });
    } else {
      addTrackedMesh(knee, createLatheLimbGeometry(0.059, 0.044, CALF * 0.58, { radialSegments: 24, heightSegments: 8, bellyAmp: 0.06, capRound: 0.01 }), M.wraps, tracker, 0, -CALF * 0.42, 0);
    }

    // Calzado marcial esculpido suavizado
    addTrackedMesh(ankle, createSculptedBootGeometry(FOOT_H), M.boots, tracker);
  }
}

export function outlineCharacterGroup(root) {
  addOutline(root, CHARACTER_OUTLINE_THICKNESS, CHARACTER_OUTLINE_COLOR);
}
