import * as THREE from 'three';
import { createEnergyVFXMaterial } from './ToonMaterial.js';

/**
 * AirGeometry
 * ------------------------------------------------------------
 * Módulo de corrientes, vórtices y tornados aerodinámicos suavizados
 * sin contornos negros ni anillos planos dentados:
 *   - Cintas en doble hélice (`TubeGeometry` cónico con puntas desvanecidas por transparencia).
 *   - Embudos translúcidos giratorios suaves (`flatShading: false`).
 *   - Paleta aérea luminosa: blanco `#f7fcff`, celeste pálido `#b8f2ff`, turquesa `#56cfe1`.
 */

export const AIR_PALETTE = {
  white: '#f7fcff',
  paleBlue: '#b8f2ff',
  turquoise: '#56cfe1',
  outline: 0x1b3b4b,
};

let sharedAirMats = null;
export function getAirMaterials() {
  if (sharedAirMats) return sharedAirMats;
  sharedAirMats = {
    whiteMat: createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: '#c8f6ff',
      opacity: 0.86,
      fresnelPower: 1.6,
      rimIntensity: 1.0,
      fadeEnds: true,
      depthWrite: false,
    }),
    whiteTransMat: createEnergyVFXMaterial({
      coreColor: '#f7fcff',
      rimColor: '#b8f2ff',
      opacity: 0.62,
      softEdge: true,
      fresnelPower: 1.5,
      rimIntensity: 0.9,
      depthWrite: false,
    }),
    paleBlueMat: createEnergyVFXMaterial({
      coreColor: '#b8f2ff',
      rimColor: '#56cfe1',
      opacity: 0.44,
      softEdge: true,
      fadeEndsY: true,
      fresnelPower: 1.4,
      rimIntensity: 1.1,
      depthWrite: false,
    }),
    turquoiseMat: createEnergyVFXMaterial({
      coreColor: '#7ae8f8',
      rimColor: '#2fb8d4',
      opacity: 0.72,
      fresnelPower: 1.75,
      rimIntensity: 1.15,
      fadeEnds: true,
      depthWrite: false,
    }),
    glowAdditiveMat: createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: '#8aefff',
      opacity: 0.75,
      additive: true,
      softEdge: true,
      fresnelPower: 1.4,
      depthWrite: false,
    }),
  };
  return sharedAirMats;
}

/**
 * Genera una cinta tubular aerodinámica cónica en hélice a lo largo de +Y (`0..length`)
 * usando `TubeGeometry` suavizado cuyo radio y alfa se desvanecen en ambos extremos.
 */
export function createWindRibbonTube(
  radiusStart = 0.22,
  radiusEnd = 0.22,
  length = 1.0,
  turns = 1.5,
  segments = 28,
  ribbonRadius = 0.06
) {
  const curvePts = [];
  const steps = Math.max(12, Math.floor(segments * 0.75));
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const r = THREE.MathUtils.lerp(radiusStart, radiusEnd, s);
    const theta = s * turns * Math.PI * 2;
    curvePts.push(new THREE.Vector3(Math.cos(theta) * r, s * length, Math.sin(theta) * r));
  }
  const curve = new THREE.CatmullRomCurve3(curvePts);
  const geo = new THREE.TubeGeometry(curve, segments, ribbonRadius, 8, false);

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const center = new THREE.Vector3();
  const offset = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    curve.getPointAt(u, center);
    offset.fromBufferAttribute(pos, i).sub(center);
    // Perfil en lágrima afilado suavemente en ambos extremos (0.04 en puntas -> 1 en el tramo medio)
    const taper = 0.04 + 0.96 * Math.sin(u * Math.PI);
    offset.multiplyScalar(taper);
    // Ligero aplastamiento aerodinámico horizontal/radial
    offset.y *= 1.18;
    pos.setXYZ(i, center.x + offset.x, center.y + offset.y, center.z + offset.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * 1. Pequeño torbellino horizontal apuntando hacia adelante (+Z) para el ataque básico:
 *   - Núcleo cónico hueco translúcido suave.
 *   - 3 cintas en doble hélice suavizadas cuyos extremos se desvanecen (sin bordes negros).
 * @returns {{group: THREE.Group, update: (dt: number) => void, dispose: () => void}}
 */
export function createHorizontalVortexMesh() {
  const { whiteMat, paleBlueMat, turquoiseMat, glowAdditiveMat } = getAirMaterials();
  const group = new THREE.Group();
  const geos = [];

  // Núcleo cónico suave apuntando hacia +Z
  const coreGeo = new THREE.CylinderGeometry(0.06, 0.34, 1.12, 20, 6, true);
  coreGeo.rotateX(Math.PI / 2);
  geos.push(coreGeo);
  const coreMesh = new THREE.Mesh(coreGeo, paleBlueMat);
  coreMesh.userData.noOutline = true;
  coreMesh.renderOrder = 1;
  group.add(coreMesh);

  // Doble hélice aerodinámica a lo largo del eje +Z
  const ribbonHolder = new THREE.Group();
  const ribbonGeoA = createWindRibbonTube(0.38, 0.08, 1.22, 1.7, 26, 0.052);
  ribbonGeoA.translate(0, -0.61, 0);
  ribbonGeoA.rotateX(Math.PI / 2);
  const ribbonGeoB = createWindRibbonTube(0.3, 0.06, 1.08, 2.0, 24, 0.038);
  ribbonGeoB.translate(0, -0.54, 0);
  ribbonGeoB.rotateX(Math.PI / 2);
  geos.push(ribbonGeoA, ribbonGeoB);

  for (let i = 0; i < 2; i++) {
    const rA = new THREE.Mesh(ribbonGeoA, i === 0 ? whiteMat : turquoiseMat);
    rA.rotation.z = i * Math.PI;
    rA.userData.noOutline = true;
    rA.renderOrder = 2;

    const rB = new THREE.Mesh(ribbonGeoB, glowAdditiveMat);
    rB.rotation.z = i * Math.PI + Math.PI * 0.5;
    rB.userData.noOutline = true;
    rB.renderOrder = 3;

    ribbonHolder.add(rA, rB);
  }
  group.add(ribbonHolder);

  return {
    group,
    update: (dt) => {
      ribbonHolder.rotation.z += dt * 26;
      coreMesh.rotation.z += dt * 16;
    },
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * 2. Vórtice compacto y ágil (`radio ~0.75`) para el Click Der en Zigzag:
 *   - Remolino vertical-inclinado con cintas tubulares en doble hélice suaves (sin bordes negros).
 *   - Estelas aerodinámicas translúcidas que acentúan el zigzag.
 * @returns {{group: THREE.Group, tiltGroup: THREE.Group, update: (dt: number, age: number) => void, dispose: () => void}}
 */
export function createZigzagVortexMesh() {
  const { whiteMat, whiteTransMat, paleBlueMat, turquoiseMat, glowAdditiveMat } = getAirMaterials();
  const group = new THREE.Group();
  const tiltGroup = new THREE.Group();
  group.add(tiltGroup);
  const geos = [];

  // Embudo compacto suavizado
  const funnelGeo = new THREE.CylinderGeometry(0.56, 0.2, 1.42, 22, 8, true);
  geos.push(funnelGeo);
  const funnel = new THREE.Mesh(funnelGeo, paleBlueMat);
  funnel.userData.noOutline = true;
  funnel.renderOrder = 1;
  tiltGroup.add(funnel);

  // Doble hélice aerodinámica suave (4 cintas entrelazadas)
  const spiralGroup = new THREE.Group();
  const bandGeoA = createWindRibbonTube(0.28, 0.72, 1.5, 1.85, 28, 0.068);
  bandGeoA.translate(0, -0.75, 0);
  const bandGeoB = createWindRibbonTube(0.22, 0.62, 1.38, 1.55, 24, 0.048);
  bandGeoB.translate(0, -0.69, 0);
  geos.push(bandGeoA, bandGeoB);

  for (let i = 0; i < 2; i++) {
    const mA = new THREE.Mesh(bandGeoA, i === 0 ? whiteMat : turquoiseMat);
    mA.rotation.y = i * Math.PI;
    mA.userData.noOutline = true;

    const mB = new THREE.Mesh(bandGeoB, glowAdditiveMat);
    mB.rotation.y = i * Math.PI + Math.PI * 0.5;
    mB.userData.noOutline = true;

    spiralGroup.add(mA, mB);
  }
  tiltGroup.add(spiralGroup);

  // Estelas fluidas hacia -Z
  const wakeShape = new THREE.Shape();
  wakeShape.moveTo(0, 0.12);
  wakeShape.quadraticCurveTo(0.45, 0.06, 0.92, -1.05);
  wakeShape.quadraticCurveTo(0.32, -0.32, 0, -0.1);
  wakeShape.closePath();

  const wakeGeo = new THREE.ShapeGeometry(wakeShape, 14);
  wakeGeo.rotateX(Math.PI / 2);
  geos.push(wakeGeo);

  const wakeLeft = new THREE.Mesh(wakeGeo, whiteTransMat);
  wakeLeft.position.set(-0.22, 0.05, 0);
  wakeLeft.scale.x = -1;
  wakeLeft.userData.noOutline = true;

  const wakeRight = new THREE.Mesh(wakeGeo, glowAdditiveMat);
  wakeRight.position.set(0.22, -0.05, 0);
  wakeRight.userData.noOutline = true;
  tiltGroup.add(wakeLeft, wakeRight);

  return {
    group,
    tiltGroup,
    update: (dt, age) => {
      spiralGroup.rotation.y += dt * 19;
      funnel.rotation.y -= dt * 14;
      wakeLeft.rotation.z = Math.sin(age * 16) * 0.18;
      wakeRight.rotation.z = -Math.sin(age * 16) * 0.18;
    },
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * 3. Ráfaga Concussiva (`createConcussiveWindWaveMesh`):
 *   - Combina 3 medialunas aerodinámicas translúcidas y anillos suaves de presión (sin bordes negros).
 * @returns {{group: THREE.Group, crescents: THREE.Mesh[], rings: THREE.Mesh[], dispose: () => void}}
 */
export function createConcussiveWindWaveMesh() {
  const { whiteMat, whiteTransMat, turquoiseMat, glowAdditiveMat } = getAirMaterials();
  const group = new THREE.Group();
  const geos = [];

  const crescentShape = new THREE.Shape();
  crescentShape.moveTo(-1.38, -0.46);
  crescentShape.quadraticCurveTo(0, 1.0, 1.38, -0.46);
  crescentShape.quadraticCurveTo(0, 0.36, -1.38, -0.46);

  const crescentGeo = new THREE.ExtrudeGeometry(crescentShape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 26,
  });
  crescentGeo.translate(0, 0, -0.1);
  crescentGeo.rotateX(Math.PI / 2);
  geos.push(crescentGeo);

  const ringGeo = new THREE.TorusGeometry(0.88, 0.052, 12, 32);
  geos.push(ringGeo);

  const crescents = [];
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const cMat = i === 0 ? glowAdditiveMat : i === 1 ? whiteMat : turquoiseMat;
    const cMesh = new THREE.Mesh(crescentGeo, cMat);
    cMesh.rotation.z = (i - 1) * 0.34;
    cMesh.rotation.x = 0.22;
    cMesh.userData.noOutline = true;
    group.add(cMesh);
    crescents.push(cMesh);

    const rMesh = new THREE.Mesh(ringGeo, i % 2 === 0 ? whiteTransMat : glowAdditiveMat);
    rMesh.userData.noOutline = true;
    group.add(rMesh);
    rings.push(rMesh);
  }

  return {
    group,
    crescents,
    rings,
    dispose: () => {
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * 4. Gran Tornado Errante Aerodinámico (`createGrandTornadoMesh`):
 *   - Cero anillos planos dentados y cero bordes negros.
 *   - Embudo interior translúcido suavizado giratorio con desvanecimiento en extremos.
 *   - Cintas aerodinámicas en doble hélice (`TubeGeometry` cónico con puntas afiladas transparentes).
 *   - Remolino suave de succión en la base + estelas de polvo y hojas ligeras.
 * @returns {{group: THREE.Group, update: (dt: number, age: number) => void, dispose: () => void}}
 */
export function createGrandTornadoMesh(height = 4.2, topRadius = 1.8) {
  const { whiteMat, whiteTransMat, paleBlueMat, turquoiseMat, glowAdditiveMat } = getAirMaterials();
  const group = new THREE.Group();
  const geos = [];

  // 1. Embudo interior retorcido suavizado con desvanecimiento arriba/abajo (`fadeEndsY`)
  const funnelGeo = new THREE.CylinderGeometry(topRadius * 0.56, 0.24, height, 28, 18, true);
  funnelGeo.translate(0, height * 0.5, 0);
  const pos = funnelGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const u = THREE.MathUtils.clamp(vy / height, 0, 1);
    const r = Math.hypot(vx, vz);
    const ang = Math.atan2(vz, vx);
    if (r > 1e-4) {
      const twist = ang + u * 4.8;
      const wave = 1 + Math.sin(twist * 3.0) * 0.1 * Math.sin(u * Math.PI);
      const swayX = Math.sin(u * Math.PI * 1.25) * 0.16;
      const swayZ = Math.cos(u * Math.PI * 0.9) * 0.1;
      pos.setXYZ(i, Math.cos(ang) * r * wave + swayX, vy, Math.sin(ang) * r * wave + swayZ);
    }
  }
  funnelGeo.computeVertexNormals();
  geos.push(funnelGeo);

  const innerFunnel = new THREE.Mesh(funnelGeo, paleBlueMat);
  innerFunnel.userData.noOutline = true;
  innerFunnel.renderOrder = 1;
  group.add(innerFunnel);

  // 2. Cintas aerodinámicas en doble hélice (`TubeGeometry` cónico suave, puntas desvanecidas)
  const bands = [];
  const innerHelixGeo = createWindRibbonTube(0.32, topRadius * 0.72, height * 0.98, 2.25, 36, 0.092);
  const outerHelixGeo = createWindRibbonTube(0.52, topRadius * 1.04, height * 1.04, 1.85, 36, 0.115);
  geos.push(innerHelixGeo, outerHelixGeo);

  for (let i = 0; i < 3; i++) {
    const innerBand = new THREE.Mesh(innerHelixGeo, i === 0 ? glowAdditiveMat : whiteMat);
    innerBand.rotation.y = (i / 3) * Math.PI * 2;
    innerBand.userData.noOutline = true;
    innerBand.renderOrder = 3;
    group.add(innerBand);
    bands.push({ mesh: innerBand, speed: 15 + i * 2.5 });

    const outerBand = new THREE.Mesh(outerHelixGeo, i % 2 === 0 ? turquoiseMat : whiteTransMat);
    outerBand.rotation.y = (i / 3) * Math.PI * 2 + Math.PI / 3;
    outerBand.userData.noOutline = true;
    outerBand.renderOrder = 2;
    group.add(outerBand);
    bands.push({ mesh: outerBand, speed: 10.5 + i * 2.0 });
  }

  // 3. Base de succión vaporosa y suave en el suelo (sin bordes negros)
  const baseGeo = new THREE.RingGeometry(0.35, 1.85, 36);
  baseGeo.rotateX(-Math.PI / 2);
  geos.push(baseGeo);
  const baseRing = new THREE.Mesh(baseGeo, whiteTransMat);
  baseRing.position.y = 0.08;
  baseRing.userData.noOutline = true;
  group.add(baseRing);

  const baseSwirlGeo = createWindRibbonTube(1.45, 0.75, 0.55, 1.35, 24, 0.065);
  geos.push(baseSwirlGeo);
  const baseSwirl = new THREE.Mesh(baseSwirlGeo, turquoiseMat);
  baseSwirl.position.y = 0.05;
  baseSwirl.userData.noOutline = true;
  group.add(baseSwirl);

  // 4. Estelas de polvo ligero y hojas aerodinámicas orbitando cerca de la base y cuerpo
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0.14);
  leafShape.quadraticCurveTo(0.08, 0.02, 0, -0.14);
  leafShape.quadraticCurveTo(-0.08, 0.02, 0, 0.14);
  const leafGeo = new THREE.ShapeGeometry(leafShape);
  geos.push(leafGeo);

  const leafMatA = createEnergyVFXMaterial({
    coreColor: '#e8fcff',
    rimColor: '#90e0ef',
    opacity: 0.78,
    softEdge: true,
  });
  const leafMatB = createEnergyVFXMaterial({
    coreColor: '#b7f5a6',
    rimColor: '#74c69d',
    opacity: 0.82,
    softEdge: true,
  });
  const leafMeshes = [];
  const leafOrbitGroup = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const u = i / 12;
    const r = THREE.MathUtils.lerp(0.55, topRadius * 1.12, u);
    const ang = i * 1.85;
    const leaf = new THREE.Mesh(leafGeo, i % 3 === 0 ? leafMatB : leafMatA);
    leaf.position.set(Math.cos(ang) * r, 0.25 + u * (height * 0.82), Math.sin(ang) * r);
    leaf.rotation.set(i * 0.7, ang, i * 0.5);
    leaf.userData = { baseY: leaf.position.y, phase: i * 0.9, noOutline: true };
    leafOrbitGroup.add(leaf);
    leafMeshes.push(leaf);
  }
  group.add(leafOrbitGroup);

  return {
    group,
    update: (dt, age) => {
      innerFunnel.rotation.y += dt * 12;
      for (const b of bands) {
        b.mesh.rotation.y += dt * b.speed;
      }
      baseRing.rotation.y += dt * 9;
      baseSwirl.rotation.y -= dt * 14;
      const suctionPulse = 0.92 + Math.sin(age * 12) * 0.08;
      baseRing.scale.setScalar(suctionPulse);

      leafOrbitGroup.rotation.y += dt * 10.5;
      for (const leaf of leafMeshes) {
        leaf.rotation.x += dt * 7;
        leaf.rotation.z += dt * 5;
        leaf.position.y = leaf.userData.baseY + Math.sin(age * 8 + leaf.userData.phase) * 0.2;
      }
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      leafMatA.dispose();
      leafMatB.dispose();
    },
  };
}
