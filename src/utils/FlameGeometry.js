import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * FlameGeometry
 * ------------------------------------------------------------
 * Constructores procedurales de geometrías de fuego orgánicas y volumétricas
 * estilo Anime / Cel-Shaded moderno (sin contornos negros duros):
 *  - `createFlameTongueGeometry`: lengua de fuego ahusada y curvada en S con
 *    ondulaciones longitudinales naturales.
 *  - `createLayeredFlame`: ensamblaje de 3 capas concéntricas sin contorno:
 *    núcleo blanco-amarillo incandescente (`AdditiveBlending`), cuerpo naranja
 *    vibrante con animación sinusoidal en vivo y halo exterior carmesí translúcido.
 *  - `createCrescentBladeGeometry`: medialuna afilada y curvada de fuego
 *    extruida para remates en arco.
 *  - `createMeteorHeadGeometry`: cabeza aerodinámica de meteoro esculpida en
 *    llamas con crestas fluidas hacia atrás.
 */

export const FIRE_PALETTE = {
  core: '#fff5b0',
  coreEmissive: '#ffaa00',
  mid: '#ff6a00',
  midEmissive: '#ff4400',
  outer: '#d9261c',
  outerEmissive: '#8f120b',
  outline: 0x2b0909,
};

let sharedMaterials = null;

/** Devuelve materiales energéticos volumétricos compartidos para llamas de 3 capas (sin borde negro) */
export function getFlameMaterials() {
  if (sharedMaterials) return sharedMaterials;

  const coreMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: '#fff088',
    opacity: 0.96,
    additive: true,
    fresnelPower: 1.5,
    rimIntensity: 0.9,
    depthWrite: false,
  });

  const midMat = createEnergyVFXMaterial({
    coreColor: '#ffc43d',
    rimColor: '#ff5a00',
    opacity: 0.88,
    additive: false,
    fresnelPower: 1.85,
    rimIntensity: 1.15,
    depthWrite: false,
  });

  const outerMat = createEnergyVFXMaterial({
    coreColor: '#ff3b1f',
    rimColor: '#9e1111',
    opacity: 0.56,
    additive: false,
    softEdge: true,
    fresnelPower: 1.8,
    rimIntensity: 1.25,
    depthWrite: false,
  });

  const emberMat = createToonMaterial('#3b120b', {
    emissive: '#ff5500',
    emissiveIntensity: 0.95,
  });

  sharedMaterials = { coreMat, midMat, outerMat, emberMat };
  return sharedMaterials;
}

/**
 * Esculpe una lengua de fuego orgánica ahusada y curvada con origen en la base (`y = 0`).
 * @param {number} [radius=0.28]
 * @param {number} [height=1.0]
 * @param {number} [seed=1]
 * @param {number} [bend=0.18]
 */
export function createFlameTongueGeometry(radius = 0.28, height = 1.0, seed = 1, bend = 0.18) {
  const radialSegs = 16;
  const heightSegs = 12;
  const geo = new THREE.ConeGeometry(radius, height, radialSegs, heightSegs);
  geo.translate(0, height * 0.5, 0);

  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp(v.y / height, 0, 1); // 0 base -> 1 punta
    const r = Math.hypot(v.x, v.z);
    const angle = Math.atan2(v.z, v.x);

    // Perfil redondeado en lágrima: más ancho hacia u ~ 0.22 y afilado suave hacia u = 1
    const baseBulge = 1.0 + Math.sin(Math.pow(u, 0.55) * Math.PI) * 0.45;
    // Lengüetas longitudinales onduladas
    const flute = 1.0 + Math.sin(angle * 3.0 + u * 4.4 + seed * 1.7) * 0.2 * (1 - u * 0.3);
    const radialScale = baseBulge * flute;

    if (r > 1e-5) {
      v.x *= radialScale;
      v.z *= radialScale;
    }

    // Curvatura en S hacia la punta (efecto llama viva lamiendo el aire)
    const swayX = Math.sin(u * Math.PI * 1.35 + seed) * bend * height * u;
    const swayZ = Math.cos(u * Math.PI * 1.1 + seed * 2.1) * bend * 0.65 * height * u;
    v.x += swayX;
    v.z += swayZ;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  geo.userData.basePositions = new Float32Array(pos.array);
  geo.userData.height = height;
  return geo;
}

/** Aplica ondulación sinusoidal orgánica sobre los vértices base de una lengua de fuego */
export function animateFlameGeometry(geo, age, seed = 0, amp = 0.14) {
  const base = geo.userData?.basePositions;
  if (!base) return;
  const h = geo.userData.height || 1.0;
  const pos = geo.attributes.position;
  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const i3 = i * 3;
    const bx = base[i3];
    const by = base[i3 + 1];
    const bz = base[i3 + 2];
    const u = THREE.MathUtils.clamp(by / h, 0, 1);
    const w = u * u * amp * h;
    arr[i3] = bx + Math.sin(age * 16.0 - u * 5.2 + seed) * w;
    arr[i3 + 1] = by;
    arr[i3 + 2] = bz + Math.cos(age * 13.5 - u * 4.6 + seed * 1.7) * w * 0.72;
  }
  pos.needsUpdate = true;
}

/**
 * Construye una lengua de fuego volumétrica animable de 3 capas concéntricas sin contorno negro:
 * núcleo blanco-amarillo aditivo, capa media naranja y halo exterior carmesí translúcido.
 * @returns {{group: THREE.Group, update: (age: number, phase?: number) => void, dispose: () => void}}
 */
export function createLayeredFlame(radius = 0.28, height = 1.0, seed = 1, bend = 0.18) {
  const { coreMat, midMat, outerMat } = getFlameMaterials();
  const group = new THREE.Group();

  const coreGeo = createFlameTongueGeometry(radius * 0.48, height * 0.65, seed + 0.3, bend * 0.7);
  const midGeo = createFlameTongueGeometry(radius * 0.78, height * 0.86, seed + 0.15, bend * 0.9);
  const outerGeo = createFlameTongueGeometry(radius, height, seed, bend);

  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.userData.noOutline = true;
  coreMesh.renderOrder = 3;

  const midMesh = new THREE.Mesh(midGeo, midMat);
  midMesh.userData.noOutline = true;
  midMesh.renderOrder = 2;

  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.userData.noOutline = true;
  outerMesh.renderOrder = 1;

  group.add(outerMesh, midMesh, coreMesh);

  return {
    group,
    coreMesh,
    midMesh,
    outerMesh,
    update(age, phase = seed) {
      animateFlameGeometry(coreGeo, age, phase + 0.4, 0.08);
      animateFlameGeometry(midGeo, age, phase + 1.1, 0.13);
      animateFlameGeometry(outerGeo, age, phase, 0.16);
    },
    dispose: () => {
      coreGeo.dispose();
      midGeo.dispose();
      outerGeo.dispose();
    },
  };
}

/**
 * Medialuna curva y afilada de fuego generada con `ExtrudeGeometry` en plano XZ.
 * @param {number} [width=2.8]
 * @param {number} [depth=1.15]
 * @param {number} [thickness=0.16]
 */
export function createCrescentBladeGeometry(width = 2.8, depth = 1.25, thickness = 0.16) {
  const hw = width * 0.5;
  const shape = new THREE.Shape();

  // Arco frontal afilado (+Y en shape -> se rotará a +Z)
  shape.moveTo(-hw, -depth * 0.52);
  shape.quadraticCurveTo(0, depth * 1.02, hw, -depth * 0.52);
  // Arco interior cóncavo más profundo para marcar los cuernos de la medialuna
  shape.quadraticCurveTo(0, depth * 0.34, -hw, -depth * 0.52);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.38,
    bevelSize: 0.055,
    bevelSegments: 2,
    curveSegments: 26,
  });

  geo.translate(0, 0, -thickness * 0.5);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Cabeza aerodinámica de meteoro esculpida en llamas (perfil ojival con
 * estrías longitudinales que barren hacia -Z).
 */
export function createMeteorHeadGeometry(radius = 0.85, length = 2.4, seed = 1) {
  const geo = new THREE.ConeGeometry(radius, length, 20, 14, true);
  geo.rotateX(Math.PI / 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = THREE.MathUtils.clamp((length * 0.5 - v.z) / length, 0, 1);
    const r = Math.hypot(v.x, v.y);
    const angle = Math.atan2(v.y, v.x);

    const profile = Math.pow(u, 0.58) / Math.max(0.08, u);
    const ribs = 1.0 + Math.sin(angle * 6.0 - u * 5.0 + seed) * 0.2 * u;
    const scale = r > 1e-4 ? Math.min(1.85, profile) * ribs : 1;

    v.x *= scale;
    v.y *= scale;
    if (u > 0.72) {
      v.z += Math.sin(angle * 5.0 + seed) * 0.32 * ((u - 0.72) / 0.28);
    }

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  return geo;
}
