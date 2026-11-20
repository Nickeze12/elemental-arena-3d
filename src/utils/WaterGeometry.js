import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial, addOutline } from './ToonMaterial.js';
import { createStylizedWaterTexture } from './ProceduralTextures.js';

/**
 * WaterGeometry
 * ------------------------------------------------------------
 * Generador de geometrías fluidas volumétricas y cristales de hielo Cel-Shaded / Anime:
 *  - Agua líquida (Látigo, Gotas orbitales, Maremoto y Espuma): materiales energéticos
 *    translúcidos con reflejo Fresnel húmedo y cáusticas animadas, SIN bordes negros.
 *  - Hielo sólido (Lanzas y Púas de congelación): cristales facetados translúcidos
 *    con brillo especular interno y contorno fino nítido (`WATER_PALETTE.outline`).
 */

export const WATER_PALETTE = {
  deep: '#0d47a1',
  turquoise: '#00b4d8',
  turquoiseLight: '#48cae4',
  foam: '#f0fbff',
  iceCore: '#80edff',
  outline: 0x0a2540,
};

let sharedWaterMats = null;
export function getWaterMaterials() {
  if (sharedWaterMats) return sharedWaterMats;

  const waterCaustics = createStylizedWaterTexture({ repeatX: 2, repeatY: 2 });

  sharedWaterMats = {
    waterCaustics,
    deepMat: createEnergyVFXMaterial({
      coreColor: '#0c4ca3',
      rimColor: '#00a8d8',
      opacity: 0.9,
      fresnelPower: 1.9,
      rimIntensity: 1.15,
      map: waterCaustics,
      mapStrength: 0.42,
      depthWrite: false,
    }),
    turquoiseMat: createEnergyVFXMaterial({
      coreColor: '#0096c7',
      rimColor: '#90e0ef',
      opacity: 0.86,
      fresnelPower: 1.75,
      rimIntensity: 1.25,
      map: waterCaustics,
      mapStrength: 0.56,
      depthWrite: false,
    }),
    turquoiseLightMat: createEnergyVFXMaterial({
      coreColor: '#48cae4',
      rimColor: '#e0faff',
      opacity: 0.84,
      fresnelPower: 1.6,
      rimIntensity: 1.2,
      fadeEnds: true,
      depthWrite: false,
    }),
    streamMat: createEnergyVFXMaterial({
      coreColor: '#00b4d8',
      rimColor: '#caf0f8',
      opacity: 0.9,
      fresnelPower: 1.65,
      rimIntensity: 1.25,
      fadeEnds: true,
      depthWrite: false,
    }),
    foamMat: (() => {
      const m = createToonMaterial('#f2fbff', {
        emissive: '#a6edff',
        emissiveIntensity: 0.26,
        side: THREE.DoubleSide,
      });
      m.userData.noOutline = true;
      return m;
    })(),
    iceCoreMat: createToonMaterial(WATER_PALETTE.iceCore, {
      flatShading: true,
      transparent: true,
      opacity: 0.88,
      emissive: '#38d6ff',
      emissiveIntensity: 0.42,
    }),
    iceFinMat: createToonMaterial(WATER_PALETTE.foam, {
      flatShading: true,
      transparent: true,
      opacity: 0.94,
      emissive: '#7be8ff',
      emissiveIntensity: 0.25,
    }),
  };
  return sharedWaterMats;
}

/** Construye una malla de cinta dinámica suave con UVs para fadeEnds */
function createRibbonBufferGeometry(segments) {
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    uvs[i * 4] = u;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = u;
    uvs[i * 4 + 3] = 1;
    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Construye un tubo cilíndrico dinámico suavizado actualizable por curva */
function createDynamicTubeBufferGeometry(segments, radial = 7) {
  const row = radial + 1;
  const vertCount = (segments + 1) * row;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    for (let j = 0; j <= radial; j++) {
      const idx = i * row + j;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = j / radial;
    }
    if (i < segments) {
      for (let j = 0; j < radial; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        const c = (i + 1) * row + (j + 1);
        const d = i * row + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Crea una cinta tubular curva con extremos afilados para corrientes orbitales */
function createTaperedOrbitTube(radius = 0.42, maxThick = 0.042, arcAngle = Math.PI * 1.45, segments = 24, radial = 6) {
  const curvePts = [];
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    const a = (s - 0.5) * arcAngle;
    curvePts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(s * Math.PI * 2) * 0.04, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(curvePts);
  const geo = new THREE.TubeGeometry(curve, segments, maxThick, radial, false);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    curve.getPointAt(u, center);
    v.fromBufferAttribute(pos, i).sub(center);
    const taper = Math.sin(u * Math.PI);
    const scale = 0.1 + 0.9 * Math.pow(taper, 0.7);
    v.multiplyScalar(scale).add(center);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 1. Látigo de Agua fluido (`createHydroWhipMesh`):
 *   - Tubo fluido suave ahusado hacia la punta sin bordes negros (`fadeEnds`).
 *   - Dos filamentos helicoidales turquesa luminosos alrededor del chorro.
 *   - Cresta fluida de espuma blanca sin contornos duros.
 * @returns {{group: THREE.Group, updateCurve: (sampleFn: (s: number, out: THREE.Vector3) => void, time: number) => void, dispose: () => void}}
 */
export function createHydroWhipMesh(segments = 24, sweepSign = 1) {
  const { deepMat, streamMat, turquoiseLightMat, foamMat } = getWaterMaterials();
  const group = new THREE.Group();

  const radial = 7;
  const mainTubeGeo = createDynamicTubeBufferGeometry(segments, radial);
  const helixAGeo = createRibbonBufferGeometry(segments);
  const helixBGeo = createRibbonBufferGeometry(segments);
  const foamGeo = createRibbonBufferGeometry(segments);

  const mainMesh = new THREE.Mesh(mainTubeGeo, streamMat);
  const helixAMesh = new THREE.Mesh(helixAGeo, turquoiseLightMat);
  const helixBMesh = new THREE.Mesh(helixBGeo, deepMat);
  const foamMesh = new THREE.Mesh(foamGeo, foamMat);

  mainMesh.userData.noOutline = true;
  helixAMesh.userData.noOutline = true;
  helixBMesh.userData.noOutline = true;
  foamMesh.userData.noOutline = true;

  group.add(mainMesh, helixAMesh, helixBMesh, foamMesh);

  const pts = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const binorm = new THREE.Vector3();

  const mainPos = mainTubeGeo.attributes.position;
  const hAPos = helixAGeo.attributes.position;
  const hBPos = helixBGeo.attributes.position;
  const foamPos = foamGeo.attributes.position;
  const row = radial + 1;

  const updateCurve = (sampleFn, time = 0) => {
    for (let i = 0; i <= segments; i++) {
      sampleFn(i / segments, pts[i]);
    }

    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(segments, i + 1)];
      tangent.subVectors(next, prev);
      if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
      tangent.normalize();

      side.crossVectors(up, tangent);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      binorm.crossVectors(tangent, side).normalize();

      const taper = Math.sin(Math.min(1, s * 5.2) * (Math.PI * 0.5)) * (1 - s * 0.78);
      const tubeR = 0.145 * taper + 0.015;
      const ripple = Math.sin(s * 12 - time * 24) * 0.038 * (1 - s * 0.3);

      // Anillo circular suave alrededor del eje
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const idx = i * row + j;
        mainPos.setXYZ(
          idx,
          p.x + (side.x * c + binorm.x * sn) * tubeR + binorm.x * ripple,
          p.y + (side.y * c + binorm.y * sn) * tubeR + binorm.y * ripple,
          p.z + (side.z * c + binorm.z * sn) * tubeR + binorm.z * ripple
        );
      }

      // Filamentos helicoidales suaves
      const helixR = tubeR * 1.45 + 0.04;
      const phaseA = s * Math.PI * 5.0 - time * 20;
      const phaseB = phaseA + Math.PI;
      const hThick = 0.034 * (1 - s * 0.55) + 0.01;

      const ax = side.x * Math.cos(phaseA) * helixR + binorm.x * Math.sin(phaseA) * helixR;
      const ay = side.y * Math.cos(phaseA) * helixR + binorm.y * Math.sin(phaseA) * helixR;
      const az = side.z * Math.cos(phaseA) * helixR + binorm.z * Math.sin(phaseA) * helixR;
      hAPos.setXYZ(i * 2, p.x + ax - binorm.x * hThick, p.y + ay - binorm.y * hThick, p.z + az - binorm.z * hThick);
      hAPos.setXYZ(i * 2 + 1, p.x + ax + binorm.x * hThick, p.y + ay + binorm.y * hThick, p.z + az + binorm.z * hThick);

      const bx = side.x * Math.cos(phaseB) * helixR + binorm.x * Math.sin(phaseB) * helixR;
      const by = side.y * Math.cos(phaseB) * helixR + binorm.y * Math.sin(phaseB) * helixR;
      const bz = side.z * Math.cos(phaseB) * helixR + binorm.z * Math.sin(phaseB) * helixR;
      hBPos.setXYZ(i * 2, p.x + bx - binorm.x * hThick, p.y + by - binorm.y * hThick, p.z + bz - binorm.z * hThick);
      hBPos.setXYZ(i * 2 + 1, p.x + bx + binorm.x * hThick, p.y + by + binorm.y * hThick, p.z + bz + binorm.z * hThick);

      // Cresta continua fluida de espuma en el borde de ataque del barrido (suavizada, sin picos rígidos)
      const foamArc = Math.sin(s * Math.PI) * (0.1 + 0.045 * Math.sin(s * 14 - time * 22));
      const edgeBase = tubeR * 0.88;
      foamPos.setXYZ(
        i * 2,
        p.x + side.x * sweepSign * edgeBase + binorm.x * 0.02,
        p.y + side.y * sweepSign * edgeBase + binorm.y * 0.02,
        p.z + side.z * sweepSign * edgeBase + binorm.z * 0.02
      );
      foamPos.setXYZ(
        i * 2 + 1,
        p.x + side.x * sweepSign * (edgeBase + foamArc) + binorm.x * 0.04,
        p.y + side.y * sweepSign * (edgeBase + foamArc) + binorm.y * 0.04,
        p.z + side.z * sweepSign * (edgeBase + foamArc) + binorm.z * 0.04
      );
    }

    for (const geo of [mainTubeGeo, helixAGeo, helixBGeo, foamGeo]) {
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    }
  };

  return {
    group,
    updateCurve,
    dispose: () => {
      mainTubeGeo.dispose();
      helixAGeo.dispose();
      helixBGeo.dispose();
      foamGeo.dispose();
    },
  };
}

/**
 * 2. Orbe de Cometa Acuático (`createWaterCometOrb`):
 *   - Gota fluida translúcida con reflejo Fresnel húmedo (sin borde negro).
 *   - 2 cintas tubulares curvadas afiladas orbitando alrededor.
 *   - Estela líquida ondulada sin contornos duros.
 * @returns {{group: THREE.Group, update: (dt: number, age: number) => void, dispose: () => void}}
 */
export function createWaterCometOrb(radius = 0.3) {
  const { turquoiseMat, turquoiseLightMat, foamMat } = getWaterMaterials();
  const group = new THREE.Group();
  const geos = [];

  // Núcleo de agua en forma de gota orgánica suave
  const coreGeo = new THREE.SphereGeometry(radius, 22, 16);
  const cPos = coreGeo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < cPos.count; i++) {
    v.fromBufferAttribute(cPos, i);
    if (v.z < 0) {
      const k = Math.min(1, -v.z / radius);
      v.z *= 1.65;
      v.x *= 1 - k * 0.48;
      v.y *= 1 - k * 0.48;
    } else {
      v.z *= 1.15;
    }
    cPos.setXYZ(i, v.x, v.y, v.z);
  }
  coreGeo.computeVertexNormals();
  geos.push(coreGeo);
  const coreMesh = new THREE.Mesh(coreGeo, turquoiseMat);
  coreMesh.userData.noOutline = true;
  group.add(coreMesh);

  // Reflejo frontal de espuma húmeda suave
  const capGeo = new THREE.SphereGeometry(radius * 0.56, 14, 12);
  capGeo.translate(0, 0.03, radius * 0.35);
  geos.push(capGeo);
  const capMesh = new THREE.Mesh(capGeo, foamMat);
  capMesh.userData.noOutline = true;
  group.add(capMesh);

  // 2 cintas fluidas tubulares con puntas afiladas (reemplaza anillos rígidos)
  const ribAGeo = createTaperedOrbitTube(radius * 1.44, 0.042, Math.PI * 1.45, 24, 6);
  const ribBGeo = createTaperedOrbitTube(radius * 1.2, 0.034, Math.PI * 1.35, 22, 6);
  geos.push(ribAGeo, ribBGeo);

  const ringA = new THREE.Mesh(ribAGeo, turquoiseLightMat);
  ringA.rotation.set(0.55, 0.35, 0.4);
  ringA.userData.noOutline = true;
  const ringB = new THREE.Mesh(ribBGeo, foamMat);
  ringB.rotation.set(-0.62, -0.45, 0.9);
  ringB.userData.noOutline = true;
  group.add(ringA, ringB);

  // Estela curva líquida hacia -Z (sin borde negro, desvanecimiento suave)
  const tailSegs = 14;
  const tailGeo = createRibbonBufferGeometry(tailSegs);
  const foamTailGeo = createRibbonBufferGeometry(tailSegs);
  geos.push(tailGeo, foamTailGeo);

  const tailMesh = new THREE.Mesh(tailGeo, turquoiseLightMat);
  const foamTailMesh = new THREE.Mesh(foamTailGeo, foamMat);
  tailMesh.userData.noOutline = true;
  foamTailMesh.userData.noOutline = true;
  group.add(tailMesh, foamTailMesh);

  const updateTail = (age) => {
    const tPos = tailGeo.attributes.position;
    const fPos = foamTailGeo.attributes.position;
    const len = 1.75;
    for (let i = 0; i <= tailSegs; i++) {
      const s = i / tailSegs;
      const z = -s * len;
      const swayX = Math.sin(s * 6.5 - age * 14) * (0.24 * s) - (s * s) * 0.2;
      const swayY = Math.cos(s * 5.0 - age * 11) * (0.12 * s);
      const hw = radius * 0.95 * (1 - s * 0.85);
      const fw = hw * 0.44;

      tPos.setXYZ(i * 2, swayX - hw, swayY - hw * 0.35, z);
      tPos.setXYZ(i * 2 + 1, swayX + hw, swayY + hw * 0.35, z);

      fPos.setXYZ(i * 2, swayX - fw, swayY + 0.04, z);
      fPos.setXYZ(i * 2 + 1, swayX + fw, swayY + 0.09, z);
    }
    tailGeo.attributes.position.needsUpdate = true;
    foamTailGeo.attributes.position.needsUpdate = true;
    tailGeo.computeVertexNormals();
    foamTailGeo.computeVertexNormals();
  };

  updateTail(0);

  return {
    group,
    update: (dt, age) => {
      ringA.rotation.y += dt * 9.5;
      ringB.rotation.y -= dt * 11.5;
      ringB.rotation.z += dt * 3.5;
      updateTail(age);
    },
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * 3. Jabalina de Cristal Glaciar Multi-Pieza (`createCrystallineIceSpear`):
 *   - SÓLIDO DE HIELO: mantiene facetas cristalinas translúcidas + contorno fino nítido
 *     con un núcleo interior de brillo especular glaciar.
 * @returns {{group: THREE.Group, update: (dt: number) => void, dispose: () => void}}
 */
export function createCrystallineIceSpear(seed = 1) {
  const { iceCoreMat, iceFinMat, turquoiseLightMat } = getWaterMaterials();
  const group = new THREE.Group();
  const geos = [];

  // Cuerpo principal hexagonal afilado (+Z punta, -Z talón)
  const tipGeo = new THREE.ConeGeometry(0.19, 1.55, 6, 3);
  tipGeo.rotateX(Math.PI / 2);
  tipGeo.translate(0, 0, 0.25);
  const tp = tipGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const z = tp.getZ(i);
    if (z > -0.4 && z < 0.7) {
      const k = 1 + 0.14 * Math.sin(z * 11 + seed);
      tp.setX(i, tp.getX(i) * k);
      tp.setY(i, tp.getY(i) * k);
    }
  }
  tipGeo.computeVertexNormals();
  geos.push(tipGeo);
  const tipMesh = new THREE.Mesh(tipGeo, iceCoreMat);
  group.add(tipMesh);

  // Núcleo especular interior brillante dentro del cristal
  const innerGeo = new THREE.ConeGeometry(0.085, 1.15, 6);
  innerGeo.rotateX(Math.PI / 2);
  innerGeo.translate(0, 0, 0.2);
  geos.push(innerGeo);
  const innerMesh = new THREE.Mesh(innerGeo, iceFinMat);
  innerMesh.userData.noOutline = true;
  group.add(innerMesh);

  // Talón posterior facetado hexagonal
  const tailGeo = new THREE.ConeGeometry(0.17, 0.65, 6);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.translate(0, 0, -0.84);
  geos.push(tailGeo);
  const tailMesh = new THREE.Mesh(tailGeo, iceCoreMat);
  group.add(tailMesh);

  // 3 aletas traseras de escarcha angular (120°)
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.28, -0.35);
  finShape.lineTo(0.16, -0.68);
  finShape.lineTo(0, -0.45);
  finShape.closePath();

  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 1,
  });
  finGeo.translate(0, 0, -0.018);
  finGeo.rotateX(Math.PI / 2);
  geos.push(finGeo);

  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    const fin = new THREE.Mesh(finGeo, iceFinMat);
    fin.position.set(0.11, 0, -0.15);
    holder.add(fin);
    group.add(holder);
  }

  // Esquirlas cristalinas pequeñas orbitando cerca de la punta
  const shardOrbit = new THREE.Group();
  shardOrbit.position.z = 0.55;
  const shardGeo = new THREE.OctahedronGeometry(0.068, 0);
  shardGeo.scale(0.65, 0.65, 1.85);
  geos.push(shardGeo);

  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const sh = new THREE.Mesh(shardGeo, i === 0 ? iceFinMat : turquoiseLightMat);
    sh.position.set(Math.cos(ang) * 0.28, Math.sin(ang) * 0.28, (i - 1) * 0.14);
    sh.rotation.z = ang;
    sh.userData.noOutline = true;
    shardOrbit.add(sh);
  }
  group.add(shardOrbit);

  // Hielo sólido mantiene contorno nítido
  addOutline(group, 0.01, WATER_PALETTE.outline);

  return {
    group,
    update: (dt) => {
      shardOrbit.rotation.z -= dt * 16;
    },
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * Genera una geometría paramétrica de ola rompiente con perfil cóncavo profundo en "C"
 * curvado hacia adelante en la cresta, completamente suave y sin bordes rígidos.
 */
function createCurvedCWaveGeometry(width, height, thickFactor = 1.0, segsX = 30, segsU = 20) {
  // Perfil 2D cerrado que envuelve el frente y dorso del rizo en forma de "C"
  // Para máxima suavidad, generamos dos caras conectadas sobre la curva guía C(u) con espesor variable
  const profPts = [];
  const halfSteps = segsU;
  // Construimos un lazo de espesor alrededor de la curva central de la ola:
  // u = 0 en la base -> u = 1 en la punta de la cresta rizada hacia adelante (+Z)
  const frontPts = [];
  const backPts = [];
  for (let i = 0; i <= halfSteps; i++) {
    const u = i / halfSteps;
    // Espina de la ola en YZ: parte vertical en la base, se ahueca hacia atrás y luego riza fuerte en C hacia +Z
    let cy;
    let cz;
    if (u < 0.72) {
      const k = u / 0.72;
      cy = height * Math.sin(k * Math.PI * 0.5) * 0.96;
      cz = -0.35 * Math.sin(k * Math.PI) + k * k * 0.95;
    } else {
      // Rizo superior cayendo hacia adelante (+Z y ligeramente hacia abajo)
      const k = (u - 0.72) / 0.28;
      const a = k * Math.PI * 0.72;
      cy = height * 0.96 + Math.sin(a) * (height * 0.14) - (1 - Math.cos(a)) * (height * 0.24);
      cz = 0.95 + Math.sin(a) * 0.98 + k * 0.18;
    }
    // Tangente aproximada para desplazar grosor normal al perfil
    const thick = (0.58 * (1 - u * 0.78) + 0.08) * thickFactor;
    const nx = u < 0.72 ? 1.0 - u * 0.55 : -Math.sin(((u - 0.72) / 0.28) * 1.4);
    const ny = u < 0.72 ? u * 0.35 : 0.85;
    const nLen = Math.hypot(nx, ny) || 1;
    const ux = nx / nLen;
    const uy = ny / nLen;
    frontPts.push({ cy: cy + uy * thick * 0.5, cz: cz + ux * thick * 0.5, u });
    backPts.push({ cy: cy - uy * thick * 0.5, cz: cz - ux * thick * 0.5, u });
  }
  for (let i = 0; i <= halfSteps; i++) profPts.push(frontPts[i]);
  for (let i = halfSteps; i >= 0; i--) profPts.push(backPts[i]);

  const cols = segsX + 1;
  const rows = profPts.length;
  const vertCount = cols * rows;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const baseData = new Float32Array(vertCount * 4);
  const indices = [];

  for (let ix = 0; ix < cols; ix++) {
    const vx = ix / segsX; // 0..1 a lo ancho
    const xNorm = (vx - 0.5) * 2; // -1..+1
    const rawX = xNorm * (width * 0.5);
    const wingArc = xNorm * xNorm;
    const heightEnvelope = 1 - wingArc * 0.28;
    const sweepBackZ = wingArc * 0.42;

    for (let ip = 0; ip < rows; ip++) {
      const pt = profPts[ip];
      const idx = ix * rows + ip;
      const y = pt.cy * heightEnvelope;
      const z = pt.cz + sweepBackZ + Math.sin(xNorm * Math.PI * 3.0) * 0.08 * pt.u;

      positions[idx * 3] = rawX;
      positions[idx * 3 + 1] = Math.max(0, y);
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = vx * 2.0;
      uvs[idx * 2 + 1] = pt.u;

      baseData[idx * 4] = rawX;
      baseData[idx * 4 + 1] = Math.max(0, y);
      baseData[idx * 4 + 2] = z;
      baseData[idx * 4 + 3] = pt.u;
    }
  }

  for (let ix = 0; ix < segsX; ix++) {
    for (let ip = 0; ip < rows - 1; ip++) {
      const a = ix * rows + ip;
      const b = (ix + 1) * rows + ip;
      const c = (ix + 1) * rows + (ip + 1);
      const d = ix * rows + (ip + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.baseData = baseData;
  return geo;
}

/**
 * 4. Ola Oceánica Curva en "C" con Espuma Volumétrica (`createBreakingTsunamiMesh`):
 *   - Perfil en "C" esculpido suavizado con textura animada de cáusticas acuáticas (SIN bordes negros).
 *   - Cresta espumosa continua volumétrica envuelta sobre el labio del rizo + gotas saltando.
 *   - Base turbulenta de espuma suave deslizándose sobre el suelo.
 * @returns {{group: THREE.Group, update: (dt: number, age: number) => void, dispose: () => void}}
 */
export function createBreakingTsunamiMesh(width = 5.6, height = 2.7) {
  const { deepMat, turquoiseMat, turquoiseLightMat, foamMat, waterCaustics } = getWaterMaterials();
  const group = new THREE.Group();
  const geos = [];

  // 1. Cuerpo principal azul profundo + manto frontal turquesa translúcido con cáusticas
  const deepGeo = createCurvedCWaveGeometry(width, height, 1.0, 30, 20);
  const turqGeo = createCurvedCWaveGeometry(width * 0.94, height * 0.96, 0.72, 26, 18);
  turqGeo.translate(0, 0.04, 0.16);
  geos.push(deepGeo, turqGeo);

  const deepMesh = new THREE.Mesh(deepGeo, deepMat);
  const turqMesh = new THREE.Mesh(turqGeo, turquoiseMat);
  deepMesh.userData.noOutline = true;
  turqMesh.userData.noOutline = true;
  group.add(deepMesh, turqMesh);

  // 2. Cresta superior continua de espuma blanca voluminosa envuelta en el borde del rizo
  const crestPts = [];
  for (let i = 0; i <= 20; i++) {
    const xN = (i / 20 - 0.5) * 2;
    const x = xN * (width * 0.49);
    const wing = xN * xN;
    const y = (height * 0.94) * (1 - wing * 0.28);
    const z = 1.88 + wing * 0.42 + Math.sin(xN * Math.PI * 3.0) * 0.07;
    crestPts.push(new THREE.Vector3(x, y, z));
  }
  const crestCurve = new THREE.CatmullRomCurve3(crestPts);
  const crestTubeGeo = new THREE.TubeGeometry(crestCurve, 28, 0.22, 10, false);
  geos.push(crestTubeGeo);
  const crestMesh = new THREE.Mesh(crestTubeGeo, foamMat);
  crestMesh.userData.noOutline = true;
  group.add(crestMesh);

  // Rizo volumétrico de espuma suavizada (cúmulos blandos en el labio superior + gotas salpicando)
  const foamClumps = [];
  const foamBlobGeo = new THREE.SphereGeometry(0.28, 14, 10);
  geos.push(foamBlobGeo);

  for (let i = 0; i < 14; i++) {
    const s = i / 13;
    const pt = crestCurve.getPointAt(s);
    const blob = new THREE.Mesh(foamBlobGeo, i % 4 === 1 ? turquoiseLightMat : foamMat);
    const sc = 0.75 + Math.sin(s * Math.PI) * 0.55 + (i % 2) * 0.18;
    blob.position.set(pt.x, pt.y + (i % 2) * 0.1, pt.z + 0.12);
    blob.scale.set(sc * 1.15, sc * 0.82, sc * 1.35);
    blob.userData.baseY = blob.position.y;
    blob.userData.baseZ = blob.position.z;
    blob.userData.phase = i * 0.85;
    blob.userData.noOutline = true;
    group.add(blob);
    foamClumps.push(blob);
  }

  // Gotas orgánicas saltando por delante del rizo
  const drops = [];
  const dropGeo = new THREE.SphereGeometry(0.085, 10, 8);
  dropGeo.scale(0.85, 1.3, 0.85);
  geos.push(dropGeo);
  for (let i = 0; i < 12; i++) {
    const u = i / 11 - 0.5;
    const d = new THREE.Mesh(dropGeo, i % 2 === 0 ? foamMat : turquoiseLightMat);
    const baseY = height * (0.45 + (i % 3) * 0.2);
    const baseZ = 1.65 + (i % 4) * 0.18;
    d.position.set(u * width * 0.86, baseY, baseZ);
    d.userData = { baseY, baseZ, phase: i * 1.3, noOutline: true };
    group.add(d);
    drops.push(d);
  }

  // Base de espuma turbulenta que barre el suelo delante de la ola
  const baseSurge = [];
  const surgePuffGeo = new THREE.SphereGeometry(0.36, 12, 8);
  geos.push(surgePuffGeo);
  for (let i = 0; i < 12; i++) {
    const u = i / 11 - 0.5;
    const x = u * (width * 0.92);
    const pf = new THREE.Mesh(surgePuffGeo, i % 3 === 0 ? turquoiseLightMat : foamMat);
    pf.position.set(x, 0.16, 0.68 + u * u * 0.35);
    pf.scale.set(1.25, 0.42, 1.35);
    pf.userData.phase = i * 0.7;
    pf.userData.baseY = 0.16;
    pf.userData.noOutline = true;
    group.add(pf);
    baseSurge.push(pf);
  }

  const animateWaveSurface = (geo, age, phaseBias) => {
    const base = geo.userData?.baseData;
    if (!base) return;
    const pos = geo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 4];
      const by = base[i * 4 + 1];
      const bz = base[i * 4 + 2];
      const u = base[i * 4 + 3];
      const xN = bx / (width * 0.5);
      const wave = Math.sin(u * 8.0 - age * 15.0 + xN * 4.0 + phaseBias) * 0.08 * Math.sin(u * Math.PI);
      arr[i * 3] = bx;
      arr[i * 3 + 1] = by + wave * 0.45;
      arr[i * 3 + 2] = bz + wave;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };

  return {
    group,
    update: (dt, age) => {
      animateWaveSurface(deepGeo, age, 0);
      animateWaveSurface(turqGeo, age, 1.1);

      // Desplaza cáusticas animadas sobre el cuerpo de la ola
      if (deepMat.uniforms?.uMapOffset) {
        deepMat.uniforms.uMapOffset.value.y = -(age * 0.65) % 1;
        deepMat.uniforms.uMapOffset.value.x = Math.sin(age * 1.4) * 0.08;
      }
      if (turquoiseMat.uniforms?.uMapOffset) {
        turquoiseMat.uniforms.uMapOffset.value.y = -(age * 0.85) % 1;
      }
      waterCaustics.offset.y = -(age * 0.45) % 1;

      for (const blob of foamClumps) {
        blob.position.y = blob.userData.baseY + Math.sin(age * 14 + blob.userData.phase) * 0.07;
        blob.position.z = blob.userData.baseZ + Math.cos(age * 12 + blob.userData.phase) * 0.05;
      }
      for (const d of drops) {
        const cyc = (age * 2.2 + d.userData.phase) % 1;
        d.position.y = d.userData.baseY + Math.sin(cyc * Math.PI) * 0.35;
        d.position.z = d.userData.baseZ + cyc * 0.32;
      }
      for (const pf of baseSurge) {
        pf.position.y = pf.userData.baseY + Math.sin(age * 16 + pf.userData.phase) * 0.05;
      }
    },
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * Genera una silueta orgánica irregular (lago/charco natural, sin círculos ni
 * bordes negros) con textura animada de cáusticas acuáticas y orilla de espuma.
 */
export function createWaterLakePatch(width = 3.6, length = 3.2, seed = 0) {
  const { waterCaustics } = getWaterMaterials();
  const group = new THREE.Group();
  const geos = [];
  const mats = [];

  const buildOrganicLakeGeo = (w, l, sOffset, shrink = 1.0) => {
    const pts = [];
    const segs = 30;
    const rx = w * 0.5 * shrink;
    const rz = l * 0.5 * shrink;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const mod =
        1 +
        0.16 * Math.sin(a * 3 + seed + sOffset) +
        0.11 * Math.cos(a * 5 - seed * 1.3 + sOffset) +
        0.07 * Math.sin(a * 2 + seed * 0.7);
      pts.push(new THREE.Vector2(Math.cos(a) * rx * mod, Math.sin(a) * rz * mod));
    }
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);

    // Mapea UVs proporcionales en XZ para lucir cáusticas acuáticas continuas
    const pos = geo.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = pos.getX(i) * 0.28 + 0.5;
      uvs[i * 2 + 1] = pos.getZ(i) * 0.28 + 0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    geos.push(geo);
    return geo;
  };

  // Orilla exterior de espuma suave orgánica
  const shoreGeo = buildOrganicLakeGeo(width, length, 0.2, 1.07);
  const shoreMat = createEnergyVFXMaterial({
    coreColor: '#bceeff',
    rimColor: WATER_PALETTE.foam,
    opacity: 0.44,
    softEdge: true,
    depthWrite: false,
  });
  mats.push(shoreMat);
  const shoreMesh = new THREE.Mesh(shoreGeo, shoreMat);
  shoreMesh.position.y = 0.002;
  shoreMesh.userData.noOutline = true;

  // Lámina principal de agua profunda con cáusticas en movimiento
  const lakeGeo = buildOrganicLakeGeo(width, length, 0.2, 1.0);
  const lakeMat = createEnergyVFXMaterial({
    coreColor: '#055e9c',
    rimColor: '#48cae4',
    opacity: 0.82,
    fresnelPower: 1.4,
    rimIntensity: 1.15,
    map: waterCaustics,
    mapStrength: 0.78,
    softEdge: true,
    depthWrite: false,
  });
  mats.push(lakeMat);
  const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
  lakeMesh.position.y = 0.008;
  lakeMesh.userData.noOutline = true;

  // Brillo interior ondulante de superficie celeste
  const sheenGeo = buildOrganicLakeGeo(width, length, 3.7, 0.68);
  const sheenMat = createEnergyVFXMaterial({
    coreColor: '#48cae4',
    rimColor: '#e0faff',
    opacity: 0.42,
    map: waterCaustics,
    mapStrength: 0.55,
    additive: true,
    softEdge: true,
    depthWrite: false,
  });
  mats.push(sheenMat);
  const sheenMesh = new THREE.Mesh(sheenGeo, sheenMat);
  sheenMesh.position.y = 0.015;
  sheenMesh.userData.noOutline = true;

  group.add(shoreMesh, lakeMesh, sheenMesh);

  return {
    group,
    update(age, fadeFactor = 1.0) {
      const ripple = 0.92 + 0.08 * Math.sin(age * 4.4 + seed);
      if (lakeMat.uniforms?.uMapOffset) {
        lakeMat.uniforms.uMapOffset.value.set(Math.sin(age * 0.7 + seed) * 0.14, -(age * 0.28) % 1);
      }
      if (sheenMat.uniforms?.uMapOffset) {
        sheenMat.uniforms.uMapOffset.value.set(Math.cos(age * 0.9 + seed) * 0.18, (age * 0.22) % 1);
      }
      shoreMat.uniforms.uOpacity.value = 0.44 * fadeFactor * ripple;
      lakeMat.uniforms.uOpacity.value = 0.82 * fadeFactor;
      sheenMat.uniforms.uOpacity.value = 0.42 * fadeFactor * (0.85 + 0.15 * Math.cos(age * 5.2 + seed));
      sheenMesh.scale.setScalar(0.96 + 0.04 * Math.sin(age * 3.8 + seed));
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
