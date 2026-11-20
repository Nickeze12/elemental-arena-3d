import * as THREE from 'three';
import { createToonMaterial, addOutline } from './ToonMaterial.js';

/**
 * RockGeometry
 * ------------------------------------------------------------
 * Generador procedural de geometrías de roca facetada y construcciones
 * tectónicas estratificadas estilo Cel-Shaded / Anime:
 *  - Paleta granito/pizarra en 3 tonos:
 *      sombra `#495059`, medio `#68717c`, filo `#8c96a3`
 *    más vetas mineralizadas ocre/ámbar (`#d9822b`) y contorno (`#1b2028`).
 *  - Geometrías desindexadas (`.toNonIndexed()`) con `flatShading: true` y
 *    `outlineNormal` suavizado para que los contornos de tinta no se rompan.
 */

export const ROCK_PALETTE = {
  shadow: '#495059',
  mid: '#68717c',
  highlight: '#8c96a3',
  amberVein: '#d9822b',
  amberHot: '#ff9b26',
  outline: 0x1b2028,
  // Alias legados para compatibilidad
  granite: '#68717c',
  graniteMid: '#68717c',
  graniteDark: '#495059',
  slateDark: '#555d67',
};

let sharedRockMats = null;
export function getRockMaterials() {
  if (sharedRockMats) return sharedRockMats;
  sharedRockMats = {
    shadowMat: createToonMaterial(ROCK_PALETTE.shadow, { flatShading: true }),
    midMat: createToonMaterial(ROCK_PALETTE.mid, { flatShading: true }),
    highlightMat: createToonMaterial(ROCK_PALETTE.highlight, { flatShading: true }),
    veinMat: new THREE.MeshStandardMaterial({
      color: ROCK_PALETTE.amberVein,
      emissive: ROCK_PALETTE.amberVein,
      emissiveIntensity: 0.75,
      roughness: 0.6,
      flatShading: true,
    }),
  };
  return sharedRockMats;
}

/** Ruido 3D determinista suave pero anguloso para fracturas de roca */
function noise3D(x, y, z, seed = 1) {
  const s1 = Math.sin(x * 3.7 + y * 2.3 + z * 4.1 + seed * 1.7) * 43758.5453;
  const s2 = Math.cos(x * 6.1 - y * 4.9 + z * 3.3 + seed * 3.1) * 24634.6345;
  const n1 = s1 - Math.floor(s1);
  const n2 = s2 - Math.floor(s2);
  return (n1 * 0.65 + n2 * 0.35) * 2 - 1;
}

function seededRandom(seed) {
  let s = Math.floor(seed * 9973) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Deforma vértices compartidos con `displaceFn(v)` y devuelve geometría no indexada
 * con normales por cara (`flatShading`) + atributo `outlineNormal` suavizado.
 */
function finalizeFacetedGeometry(indexedGeo, displaceFn) {
  const pos = indexedGeo.attributes.position;
  const cache = new Map();
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let out = cache.get(key);
    if (!out) {
      const displaced = v.clone();
      displaceFn(displaced);
      out = [displaced.x, displaced.y, displaced.z];
      cache.set(key, out);
    }
    pos.setXYZ(i, out[0], out[1], out[2]);
  }
  pos.needsUpdate = true;

  indexedGeo.computeVertexNormals();
  const smoothNorm = indexedGeo.attributes.normal;
  const normMap = new Map();
  const nVec = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    nVec.fromBufferAttribute(smoothNorm, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let acc = normMap.get(key);
    if (!acc) {
      acc = new THREE.Vector3();
      normMap.set(key, acc);
    }
    acc.add(nVec);
  }
  for (const acc of normMap.values()) acc.normalize();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    const sn = normMap.get(key);
    smoothNorm.setXYZ(i, sn.x, sn.y, sn.z);
  }

  indexedGeo.setAttribute('outlineNormal', smoothNorm.clone());
  const nonIndexed = indexedGeo.index ? indexedGeo.toNonIndexed() : indexedGeo;
  if (nonIndexed !== indexedGeo) indexedGeo.dispose();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

/**
 * Aguja / estalagmita estrecha, asimétrica y fracturada con punta afilada.
 * El origen queda en la base (`y = 0`) y sube hasta `y = height`.
 */
export function createJaggedStalagmite(height = 2.4, baseRadius = 0.44, seed = Math.random() * 100) {
  const radialSegs = 6 + (Math.floor(seed) % 2);
  const heightSegs = 5;
  const geo = new THREE.ConeGeometry(baseRadius, height, radialSegs, heightSegs);
  geo.translate(0, height * 0.5, 0);

  return finalizeFacetedGeometry(geo, (v) => {
    const hRatio = THREE.MathUtils.clamp(v.y / height, 0, 1);
    if (hRatio > 0.96) {
      v.x += noise3D(1.1, 2.2, 3.3, seed) * baseRadius * 0.16;
      v.z += noise3D(4.4, 5.5, 6.6, seed) * baseRadius * 0.16;
      return;
    }

    const angle = Math.atan2(v.z, v.x);
    const ridge = noise3D(Math.cos(angle) * 1.9, hRatio * 3.4, Math.sin(angle) * 1.9, seed);
    const step = noise3D(v.x * 2.5, hRatio * 5.0, v.z * 2.5, seed + 17);
    const radialScale = 1 + ridge * 0.28 + step * 0.14;

    v.x *= radialScale;
    v.z *= radialScale;

    const bend = Math.sin(hRatio * Math.PI) * baseRadius * 0.24;
    v.x += bend * noise3D(0.5, hRatio, 0.2, seed + 5);
    v.z += bend * noise3D(0.2, hRatio, 0.8, seed + 9);
    if (hRatio > 0.08 && hRatio < 0.92) {
      v.y += step * (height / heightSegs) * 0.3;
    }
  });
}

/**
 * Bloque monolítico de piedra tallada/fracturada con bordes biselados
 * irregulares y cresta diagonal opcional en la coronación.
 * El origen queda en la base (`y = 0`) y sube hasta `y = height`.
 */
export function createStoneSlab(width = 0.62, height = 2.3, depth = 0.58, seed = Math.random() * 100, crestSlope = 0) {
  const geo = new THREE.BoxGeometry(width, height, depth, 3, 6, 3);
  geo.translate(0, height * 0.5, 0);

  const hx = width * 0.5;
  const hz = depth * 0.5;

  return finalizeFacetedGeometry(geo, (v) => {
    const hRatio = THREE.MathUtils.clamp(v.y / height, 0, 1);

    const topTaper = hRatio > 0.76 ? 1 - ((hRatio - 0.76) / 0.24) * 0.28 : 1 - hRatio * 0.05;
    v.x *= topTaper;
    v.z *= topTaper;

    const ax = Math.abs(v.x) / (hx * topTaper + 1e-4);
    const az = Math.abs(v.z) / (hz * topTaper + 1e-4);
    if (ax > 0.85 && az > 0.85) {
      v.x *= 0.84;
      v.z *= 0.84;
    }

    const nX = noise3D(v.x * 2.4, v.y * 1.9, v.z * 2.4, seed);
    const nY = noise3D(v.x * 3.1, v.y * 2.7, v.z * 3.1, seed + 13);
    const nZ = noise3D(v.x * 2.2, v.y * 2.1, v.z * 2.8, seed + 29);

    const edgeFactor = hRatio < 0.05 ? 0.35 : 1.0;
    v.x += nX * width * 0.11 * edgeFactor;
    v.z += nZ * depth * 0.12 * edgeFactor;

    if (hRatio > 0.06) {
      v.y += nY * height * (hRatio > 0.88 ? 0.07 : 0.03);
    }
    // Cresta diagonal fracturada en la parte superior
    if (crestSlope !== 0 && hRatio > 0.72) {
      const k = (hRatio - 0.72) / 0.28;
      v.y += (v.x / (hx + 1e-4)) * crestSlope * k * 0.22;
    }
  });
}

/**
 * Laja / disco irregular de piedra facetada con bordes biselados quebrados.
 */
export function createEarthDisc(radius = 0.55, thickness = 0.22, seed = Math.random() * 100) {
  const rng = seededRandom(seed);
  const segs = 9 + Math.floor(rng() * 3); // 9 a 11 lados irregulares
  const geo = new THREE.CylinderGeometry(radius, radius * 0.94, thickness, segs, 2);

  return finalizeFacetedGeometry(geo, (v) => {
    const r = Math.hypot(v.x, v.z);
    const angle = Math.atan2(v.z, v.x);
    const ySign = Math.sign(v.y);
    const isOuter = r > radius * 0.52;

    if (isOuter && Math.abs(v.y) > thickness * 0.18) {
      const shrink = 0.8 + noise3D(Math.cos(angle) * 2.4, ySign, Math.sin(angle) * 2.4, seed) * 0.1;
      v.x *= shrink;
      v.z *= shrink;
      v.y *= 0.84;
    }

    const rimNoise = noise3D(Math.cos(angle) * 2.7, v.y * 3.5, Math.sin(angle) * 2.7, seed + 7);
    const asym = noise3D(Math.cos(angle * 2) * 1.4, 0.5, Math.sin(angle * 2) * 1.4, seed + 41);
    const faceNoise = noise3D(v.x * 3.8, v.y * 5.2, v.z * 3.8, seed + 19);

    if (r > 1e-4) {
      const radialFactor = 1 + rimNoise * 0.18 + asym * 0.1;
      v.x *= radialFactor;
      v.z *= radialFactor;
    }
    v.y += faceNoise * thickness * 0.24;
  });
}

/**
 * 1. Racimo tectónico de 3 a 4 agujas/lajas afiladas entrelazadas a distintas
 * alturas y ángulos en 3 tonos de granito + veta mineral ámbar en la base.
 * @returns {{group: THREE.Group, dispose: () => void}}
 */
export function createTectonicShardCluster(height = 2.4, baseRadius = 0.44, seed = Math.random() * 1000) {
  const rng = seededRandom(seed);
  const { shadowMat, midMat, highlightMat, veinMat } = getRockMaterials();
  const group = new THREE.Group();
  const geos = [];

  // Aguja principal alta + 2 o 3 esquirlas laterales menores entrelazadas
  const sideCount = rng() > 0.45 ? 3 : 2;
  const mainGeo = createJaggedStalagmite(height, baseRadius, seed + 11);
  geos.push(mainGeo);

  const mainMesh = new THREE.Mesh(mainGeo, midMat);
  mainMesh.rotation.x = 0.24 + (rng() - 0.5) * 0.08;
  mainMesh.rotation.z = (rng() - 0.5) * 0.14;
  group.add(mainMesh);

  // Esquirla laminar de filo claro adosada al lomo de la aguja principal
  const crestGeo = createStoneSlab(baseRadius * 0.72, height * 0.72, baseRadius * 0.46, seed + 37, 0.65);
  geos.push(crestGeo);
  const crestMesh = new THREE.Mesh(crestGeo, highlightMat);
  crestMesh.position.set((rng() - 0.5) * baseRadius * 0.25, -0.05, -baseRadius * 0.18);
  crestMesh.rotation.set(0.28, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.25);
  group.add(crestMesh);

  for (let i = 0; i < sideCount; i++) {
    const subH = height * (0.42 + rng() * 0.24);
    const subR = baseRadius * (0.48 + rng() * 0.14);
    const angle = (i / sideCount) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const subGeo = i % 2 === 0
      ? createJaggedStalagmite(subH, subR, seed + 71 + i * 29)
      : createStoneSlab(subR * 1.4, subH, subR * 1.15, seed + 103 + i * 31, i === 1 ? -0.7 : 0.6);
    geos.push(subGeo);

    const subMesh = new THREE.Mesh(subGeo, i === 0 ? shadowMat : i === 1 ? highlightMat : shadowMat);
    subMesh.position.set(Math.cos(angle) * baseRadius * 0.54, -0.06, Math.sin(angle) * baseRadius * 0.48);
    subMesh.rotation.set(0.22 + (rng() - 0.5) * 0.28, angle * 0.5, (rng() - 0.5) * 0.48);
    group.add(subMesh);
  }

  // Veta ocre/ámbar sutil incrustada en la fractura de la base
  const veinGeo = createJaggedStalagmite(height * 0.26, baseRadius * 0.42, seed + 211);
  geos.push(veinGeo);
  const veinMesh = new THREE.Mesh(veinGeo, veinMat);
  veinMesh.position.set(0, -0.02, baseRadius * 0.34);
  veinMesh.rotation.x = 0.42;
  veinMesh.scale.set(0.75, 1, 0.35);
  veinMesh.userData.noOutline = true;
  group.add(veinMesh);

  group.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  addOutline(group, 0.014, ROCK_PALETTE.outline);

  return {
    group,
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * 2. Peñasco colosal compuesto: núcleo poliédrico irregular atravesado por
 * placas/estrías salientes en 3 tonos de granito + grietas emisivas ámbar
 * que se enfrían durante el vuelo.
 * @returns {{group: THREE.Group, setCoolFactor: (t: number) => void, dispose: () => void}}
 */
export function createRuggedBoulder(radius = 1.1, seed = Math.random() * 1000) {
  const rng = seededRandom(seed);
  const { shadowMat, midMat, highlightMat } = getRockMaterials();
  const group = new THREE.Group();
  const geos = [];

  // Núcleo poliédrico irregular facetado
  const rawCore = new THREE.DodecahedronGeometry(radius * 0.9, 1);
  const coreGeo = finalizeFacetedGeometry(rawCore, (v) => {
    const n = noise3D(v.x * 1.9, v.y * 1.9, v.z * 1.9, seed);
    const ridge = noise3D(v.x * 3.4, v.y * 2.2, v.z * 3.4, seed + 23);
    const f = 1 + n * 0.22 + ridge * 0.1;
    v.multiplyScalar(f);
  });
  geos.push(coreGeo);
  const coreMesh = new THREE.Mesh(coreGeo, midMat);
  group.add(coreMesh);

  // 6 placas y estrías de roca salientes en 3 tonos de granito
  const plateMats = [shadowMat, highlightMat, shadowMat, midMat, highlightMat, shadowMat];
  for (let i = 0; i < 6; i++) {
    const w = radius * (0.62 + rng() * 0.28);
    const h = radius * (0.48 + rng() * 0.26);
    const d = radius * (0.58 + rng() * 0.26);
    const plateGeo = createStoneSlab(w, h, d, seed + 53 + i * 29, i % 2 === 0 ? 0.5 : -0.5);
    plateGeo.translate(0, -h * 0.5, 0);
    geos.push(plateGeo);

    const m = new THREE.Mesh(plateGeo, plateMats[i]);
    const dir = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    m.position.copy(dir).multiplyScalar(radius * 0.62);
    m.lookAt(dir.clone().multiplyScalar(3));
    m.rotateX((rng() - 0.5) * 0.8);
    m.rotateZ((rng() - 0.5) * 0.8);
    group.add(m);
  }

  // Grietas emisivas ámbar que se enfrían progresivamente en el aire
  const crackMat = new THREE.MeshStandardMaterial({
    color: ROCK_PALETTE.amberVein,
    emissive: ROCK_PALETTE.amberHot,
    emissiveIntensity: 1.25,
    roughness: 0.45,
    flatShading: true,
  });

  for (let i = 0; i < 4; i++) {
    const seamGeo = createEarthDisc(radius * (0.94 + rng() * 0.06), 0.085, seed + 307 + i * 17);
    geos.push(seamGeo);
    const seam = new THREE.Mesh(seamGeo, crackMat);
    seam.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    seam.userData.noOutline = true;
    group.add(seam);
  }

  group.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  addOutline(group, 0.015, ROCK_PALETTE.outline);

  return {
    group,
    /** Enfría el brillo ámbar de las grietas (`cool = 0` caliente -> `1` piedra fría) */
    setCoolFactor: (cool) => {
      const k = THREE.MathUtils.clamp(1 - cool, 0, 1);
      crackMat.emissiveIntensity = 0.06 + 1.19 * k * k;
      crackMat.color.set('#584b44').lerp(new THREE.Color(ROCK_PALETTE.amberVein), k);
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      crackMat.dispose();
    },
  };
}

/**
 * 3. Laja flotante irregular de piedra partida (9-11 vértices asimétricos,
 * relieves rugosos en ambas caras, veta ámbar) acompañada de 2-3 piedritas orbitales.
 * @returns {{group: THREE.Group, discMesh: THREE.Group, orbitGroup: THREE.Group, pebbles: THREE.Mesh[], dispose: () => void}}
 */
export function createFloatingRockDisc(radius = 0.55, thickness = 0.22, seed = Math.random() * 1000) {
  const rng = seededRandom(seed);
  const { shadowMat, midMat, highlightMat, veinMat } = getRockMaterials();
  const group = new THREE.Group();
  const geos = [];

  const discHolder = new THREE.Group();

  // Cuerpo principal de laja asimétrica fracturada
  const discGeo = createEarthDisc(radius, thickness, seed);
  geos.push(discGeo);
  const mainMesh = new THREE.Mesh(discGeo, midMat);
  discHolder.add(mainMesh);

  // Capa superior / lasca de filo iluminado biselada para acentuar estratos
  const flakeGeo = createEarthDisc(radius * 0.72, thickness * 0.48, seed + 33);
  geos.push(flakeGeo);
  const flakeMesh = new THREE.Mesh(flakeGeo, highlightMat);
  flakeMesh.position.set(radius * 0.08, thickness * 0.34, -radius * 0.06);
  flakeMesh.rotation.set(0.06, 0.8, -0.04);
  discHolder.add(flakeMesh);

  // Veta ámbar fina incrustada en una fisura de la laja
  const veinGeo = createStoneSlab(radius * 0.92, thickness * 0.32, radius * 0.14, seed + 89, 0);
  veinGeo.translate(0, -thickness * 0.16, 0);
  geos.push(veinGeo);
  const veinMesh = new THREE.Mesh(veinGeo, veinMat);
  veinMesh.position.set(0, thickness * 0.3, 0);
  veinMesh.rotation.y = rng() * Math.PI;
  veinMesh.userData.noOutline = true;
  discHolder.add(veinMesh);

  addOutline(discHolder, 0.014, ROCK_PALETTE.outline);
  group.add(discHolder);

  // 2 o 3 piedritas pequeñas orbitando alrededor de la laja
  const orbitGroup = new THREE.Group();
  const pebbles = [];
  const pebbleCount = rng() > 0.45 ? 3 : 2;
  for (let i = 0; i < pebbleCount; i++) {
    const pr = 0.085 + rng() * 0.045;
    const rawPeb = new THREE.DodecahedronGeometry(pr, 0);
    const pebGeo = finalizeFacetedGeometry(rawPeb, (v) => {
      const f = 1 + noise3D(v.x * 8, v.y * 8, v.z * 8, seed + 200 + i) * 0.25;
      v.multiplyScalar(f);
    });
    geos.push(pebGeo);

    const peb = new THREE.Mesh(pebGeo, i % 2 === 0 ? shadowMat : highlightMat);
    const angle = (i / pebbleCount) * Math.PI * 2 + rng() * 0.5;
    const orbitR = radius * (1.28 + rng() * 0.24);
    peb.position.set(Math.cos(angle) * orbitR, (rng() - 0.5) * 0.18, Math.sin(angle) * orbitR);
    peb.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    peb.scale.set(1.25, 0.78, 0.92);
    addOutline(peb, 0.01, ROCK_PALETTE.outline);
    orbitGroup.add(peb);
    pebbles.push(peb);
  }
  group.add(orbitGroup);

  group.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    discMesh: discHolder,
    orbitGroup,
    pebbles,
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * Rocas facetadas orbitales (1..3) que flotan alrededor del enemigo al ser
 * impactado por Disco Roca (cada carga dura 2.0s; al llegar a 3 activa prisión).
 */
export function createEarthOrbitRocksGroup(scale = 1.0) {
  const { shadowMat, midMat, highlightMat, veinMat } = getRockMaterials();
  const group = new THREE.Group();
  group.name = 'EarthOrbitRocks';
  const geos = [];
  const rocks = [];
  const orbitR = 0.86 * scale;
  const baseY = 1.05 * scale;
  const mats = [midMat, highlightMat, shadowMat];

  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    const ang = (i / 3) * Math.PI * 2;
    const rawGeo = new THREE.DodecahedronGeometry(0.18 * scale, 0);
    const rockGeo = finalizeFacetedGeometry(rawGeo, (v) => {
      const f = 1 + noise3D(v.x * 5, v.y * 5, v.z * 5, 130 + i * 37) * 0.28;
      v.multiplyScalar(f);
    });
    geos.push(rockGeo);

    const mesh = new THREE.Mesh(rockGeo, mats[i % mats.length]);
    mesh.scale.set(1.22, 0.88, 1.05);
    addOutline(mesh, 0.011, ROCK_PALETTE.outline);
    holder.add(mesh);

    const veinGeo = createStoneSlab(0.11 * scale, 0.08 * scale, 0.06 * scale, 220 + i, 0.4);
    geos.push(veinGeo);
    const vein = new THREE.Mesh(veinGeo, veinMat);
    vein.position.set(0.06 * scale, 0.03 * scale, 0.06 * scale);
    vein.userData.noOutline = true;
    holder.add(vein);

    holder.position.set(Math.cos(ang) * orbitR, baseY, Math.sin(ang) * orbitR);
    holder.visible = false;
    group.add(holder);
    rocks.push({ holder, baseAngle: ang, phase: i * 2.1 });
  }

  let activeCount = 0;
  return {
    group,
    setCount(count) {
      activeCount = Math.max(0, Math.min(3, Math.round(count || 0)));
      for (let i = 0; i < rocks.length; i++) {
        rocks[i].holder.visible = i < activeCount;
      }
      group.visible = activeCount > 0;
    },
    update(dt, time = 0) {
      if (activeCount <= 0) return;
      group.rotation.y += dt * 3.8;
      for (let i = 0; i < activeCount; i++) {
        const rk = rocks[i];
        rk.holder.position.y = baseY + Math.sin(time * 5.2 + rk.phase) * (0.14 * scale);
        rk.holder.rotation.x += dt * 2.6;
        rk.holder.rotation.y -= dt * 3.2;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * Prisión de rocas sólidas de granito que atrapan la mitad inferior/media del
 * cuerpo (suelo hasta cintura/pecho) dejando al objetivo inmóvil por 3.0s.
 */
export function createEarthRockTrapGroup(scale = 1.0) {
  const { shadowMat, midMat, highlightMat, veinMat } = getRockMaterials();
  const group = new THREE.Group();
  group.name = 'EarthRockTrap';
  const geos = [];
  const mats = [shadowMat, midMat, highlightMat];

  // Zócalo rocoso ancho anclado al suelo
  const baseGeo = createStoneSlab(1.18 * scale, 0.34 * scale, 1.14 * scale, 41, 0.35);
  baseGeo.translate(0, -0.02 * scale, 0);
  geos.push(baseGeo);
  const baseMesh = new THREE.Mesh(baseGeo, shadowMat);
  group.add(baseMesh);

  // 7 lajas y monolitos inclinados cerrándose alrededor hasta la cintura/pecho (~1.08*scale)
  const count = 7;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.14;
    const h = (0.96 + (i % 3) * 0.12) * scale;
    const w = 0.44 * scale;
    const d = 0.34 * scale;
    const slabGeo = i % 2 === 0
      ? createStoneSlab(w, h, d, 300 + i * 29, 0.65)
      : createJaggedStalagmite(h * 1.04, 0.25 * scale, 510 + i * 31);
    geos.push(slabGeo);

    const mesh = new THREE.Mesh(slabGeo, mats[i % mats.length]);
    const r = 0.44 * scale;
    mesh.position.set(Math.cos(ang) * r, -0.03 * scale, Math.sin(ang) * r);
    // Inclina suavemente hacia el torso para dar sensación de aprisionamiento sólido
    mesh.rotation.y = -ang + Math.PI * 0.5;
    mesh.rotation.x = 0.22;
    group.add(mesh);

    if (i % 2 === 0) {
      const veinGeo = createStoneSlab(0.16 * scale, 0.24 * scale, 0.08 * scale, 700 + i, 0.5);
      geos.push(veinGeo);
      const vein = new THREE.Mesh(veinGeo, veinMat);
      vein.position.set(Math.cos(ang) * (r + 0.09 * scale), 0.36 * scale, Math.sin(ang) * (r + 0.09 * scale));
      vein.rotation.y = -ang;
      vein.userData.noOutline = true;
      group.add(vein);
    }
  }

  addOutline(group, 0.013, ROCK_PALETTE.outline);
  group.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
    },
  };
}
