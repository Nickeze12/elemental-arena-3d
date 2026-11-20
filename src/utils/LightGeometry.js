import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial, addOutline } from './ToonMaterial.js';

/**
 * LightGeometry
 * ----------------------------------------------------------------------
 * Constructores geométricos procedurales para el 8.º Maestro Elemental:
 * Control de Luz / Prisma (`'light'`).
 *  - Sólidos cristalinos (Prisma Refractario): cristal facetado translúcido
 *    con contorno fino de tinta (`OUTLINE_COLOR`).
 *  - Energía fotónica (Haces, láseres espectrales, destello solar, estrellitas
 *    de aturdimiento y clones Fresnel): `createEnergyVFXMaterial` con
 *    `AdditiveBlending` y sin contornos negros (`noOutline = true`).
 */

export const LIGHT_PALETTE = {
  pearl: '#f8fafc',
  ivory: '#fef9c3',
  solarGold: '#facc15',
  amber: '#d97706',
  cyan: '#38bdf8',
  magenta: '#e879f9',
  white: '#ffffff',
  rivalRose: '#fb7185',
  rivalCyan: '#22d3ee',
};

const OUTLINE_COLOR = 0x1b2028;

/**
 * Lanza lineal de Haz Fotónico (orientada hacia +Z) con núcleo blanco aditivo,
 * envolvente dorado-cian y anillos prismáticos de impulso.
 */
export function createPhotonBeamGroup(length = 1.45, radius = 0.085, coreTint = LIGHT_PALETTE.solarGold) {
  const group = new THREE.Group();

  const coreGeo = new THREE.CapsuleGeometry(radius * 0.56, length * 0.86, 6, 12);
  coreGeo.rotateX(Math.PI * 0.5);
  const coreMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: LIGHT_PALETTE.ivory,
    opacity: 0.98,
    fresnelPower: 1.4,
    additive: true,
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.userData.noOutline = true;

  const haloGeo = new THREE.CapsuleGeometry(radius * 1.32, length, 6, 12);
  haloGeo.rotateX(Math.PI * 0.5);
  const haloMat = createEnergyVFXMaterial({
    coreColor: coreTint,
    rimColor: LIGHT_PALETTE.cyan,
    opacity: 0.58,
    fresnelPower: 1.6,
    softEdge: true,
    additive: true,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.userData.noOutline = true;

  const ringGeo = new THREE.TorusGeometry(radius * 1.45, radius * 0.22, 8, 20);
  const ringMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.82,
    additive: true,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.z = length * 0.12;
  ringMesh.userData.noOutline = true;

  group.add(haloMesh, coreMesh, ringMesh);

  return {
    group,
    update(dt, age = 0) {
      ringMesh.rotation.z += dt * 11;
      const pulse = 1 + Math.sin(age * 28) * 0.09;
      haloMesh.scale.set(pulse, pulse, 1);
    },
    dispose() {
      coreGeo.dispose();
      haloGeo.dispose();
      ringGeo.dispose();
      coreMat.dispose();
      haloMat.dispose();
      ringMat.dispose();
    },
  };
}

/**
 * Rayo láser espectral recto entre `start` y `end` (oro, cian o magenta)
 * con núcleo incandescente aditivo y halo cromático.
 */
export function createLaserBeamMesh(
  start,
  end,
  { coreColor = '#ffffff', rimColor = LIGHT_PALETTE.solarGold, radius = 0.068 } = {}
) {
  const group = new THREE.Group();
  const delta = new THREE.Vector3().subVectors(end, start);
  const dist = Math.max(0.05, delta.length());
  const dir = delta.clone().divideScalar(dist);
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

  const coreGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.45, dist, 10, 1, false);
  coreGeo.rotateX(Math.PI * 0.5);
  const coreMat = createEnergyVFXMaterial({
    coreColor,
    rimColor: LIGHT_PALETTE.ivory,
    opacity: 0.98,
    additive: true,
    depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.userData.noOutline = true;

  const haloGeo = new THREE.CylinderGeometry(radius * 1.45, radius * 1.15, dist, 12, 1, false);
  haloGeo.rotateX(Math.PI * 0.5);
  const haloMat = createEnergyVFXMaterial({
    coreColor: rimColor,
    rimColor,
    opacity: 0.62,
    softEdge: true,
    additive: true,
    depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.userData.noOutline = true;

  const endFlareGeo = new THREE.SphereGeometry(radius * 2.2, 12, 10);
  const endFlare = new THREE.Mesh(endFlareGeo, coreMat);
  endFlare.position.z = dist * 0.5;
  endFlare.userData.noOutline = true;

  group.add(haloMesh, coreMesh, endFlare);
  group.position.copy(mid);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

  return {
    group,
    coreMat,
    haloMat,
    setFade(fade) {
      const clamped = Math.max(0, Math.min(1, fade));
      coreMat.opacity = 0.98 * clamped;
      haloMat.opacity = 0.62 * clamped;
      const w = 0.45 + 0.55 * clamped;
      haloMesh.scale.set(w, w, 1);
      coreMesh.scale.set(w, w, 1);
    },
    dispose() {
      coreGeo.dispose();
      haloGeo.dispose();
      endFlareGeo.dispose();
      coreMat.dispose();
      haloMat.dispose();
    },
  };
}

/**
 * Prisma Refractario flotante: cristal octaedro alargado translúcido con
 * contorno fino de tinta, núcleo iridiscente interno y anillos orbitales dorados.
 */
export function createRefractionPrismGroup(scale = 1, isRival = false) {
  const group = new THREE.Group();

  const crystalMat = createToonMaterial(isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan, {
    flatShading: true,
    transparent: true,
    opacity: 0.82,
    emissive: isRival ? LIGHT_PALETTE.rivalRose : LIGHT_PALETTE.solarGold,
    emissiveIntensity: 0.35,
  });
  const crystalGeo = new THREE.OctahedronGeometry(0.42 * scale, 0);
  crystalGeo.scale(0.68, 1.55, 0.68);
  const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
  addOutline(crystalMesh, 0.012, OUTLINE_COLOR);

  const innerGeo = new THREE.OctahedronGeometry(0.22 * scale, 0);
  innerGeo.scale(0.66, 1.42, 0.66);
  const innerMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.95,
    additive: true,
    depthWrite: false,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.userData.noOutline = true;

  const orbitRingGeo = new THREE.TorusGeometry(0.58 * scale, 0.028 * scale, 8, 28);
  const orbitRingMat = createEnergyVFXMaterial({
    coreColor: LIGHT_PALETTE.ivory,
    rimColor: isRival ? LIGHT_PALETTE.rivalRose : LIGHT_PALETTE.solarGold,
    opacity: 0.85,
    additive: true,
    depthWrite: false,
  });
  const orbitRingA = new THREE.Mesh(orbitRingGeo, orbitRingMat);
  orbitRingA.rotation.x = Math.PI * 0.38;
  orbitRingA.userData.noOutline = true;

  const orbitRingB = new THREE.Mesh(orbitRingGeo, orbitRingMat);
  orbitRingB.rotation.set(-Math.PI * 0.32, Math.PI * 0.4, 0);
  orbitRingB.scale.setScalar(0.84);
  orbitRingB.userData.noOutline = true;

  const fieldGeo = new THREE.SphereGeometry(0.75 * scale, 16, 12);
  const fieldMat = createEnergyVFXMaterial({
    coreColor: LIGHT_PALETTE.cyan,
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.16,
    fresnelPower: 2.0,
    softEdge: true,
    additive: true,
    depthWrite: false,
  });
  const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.userData.noOutline = true;

  group.add(fieldMesh, crystalMesh, innerMesh, orbitRingA, orbitRingB);

  let flashTimer = 0;

  return {
    group,
    crystalMesh,
    triggerRefractFlash() {
      flashTimer = 0.28;
    },
    update(dt, age = 0) {
      crystalMesh.rotation.y += dt * 1.85;
      innerMesh.rotation.y -= dt * 2.6;
      orbitRingA.rotation.z += dt * 2.2;
      orbitRingB.rotation.y += dt * 2.8;

      const bob = Math.sin(age * 3.4) * 0.08 * scale;
      crystalMesh.position.y = bob;
      innerMesh.position.y = bob;

      if (flashTimer > 0) {
        flashTimer = Math.max(0, flashTimer - dt);
        const f = flashTimer / 0.28;
        crystalMat.emissiveIntensity = 0.35 + f * 1.45;
        fieldMat.opacity = 0.16 + f * 0.42;
        fieldMesh.scale.setScalar(1 + f * 0.45);
      } else {
        crystalMat.emissiveIntensity = 0.35 + Math.sin(age * 5) * 0.12;
        fieldMat.opacity = 0.16;
        fieldMesh.scale.setScalar(1);
      }
    },
    dispose() {
      crystalGeo.dispose();
      innerGeo.dispose();
      orbitRingGeo.dispose();
      fieldGeo.dispose();
      crystalMat.dispose();
      innerMat.dispose();
      orbitRingMat.dispose();
      fieldMat.dispose();
    },
  };
}

/**
 * Material Fresnel energético translúcido para el Clon Ilusorio / Espejismo
 * (dorado-cian con `AdditiveBlending` y cero contornos negros).
 */
export function createMirageFresnelMaterial(isRival = false) {
  return createEnergyVFXMaterial({
    coreColor: isRival ? LIGHT_PALETTE.rivalRose : LIGHT_PALETTE.solarGold,
    rimColor: isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.cyan,
    opacity: 0.54,
    fresnelPower: 1.85,
    rimIntensity: 1.45,
    additive: true,
    depthWrite: false,
  });
}

/**
 * Destello Solar radial expandible (Q) con cúpula de luz y anillo prismático.
 */
export function createSolarFlashGroup(maxRadius = 4.6) {
  const group = new THREE.Group();

  const domeGeo = new THREE.SphereGeometry(1, 24, 16);
  const domeMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.78,
    fresnelPower: 1.35,
    softEdge: true,
    additive: true,
    depthWrite: false,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.userData.noOutline = true;

  const ringGeo = new THREE.RingGeometry(0.68, 1.0, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = createEnergyVFXMaterial({
    coreColor: LIGHT_PALETTE.ivory,
    rimColor: LIGHT_PALETTE.cyan,
    opacity: 0.9,
    additive: true,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.12;
  ringMesh.userData.noOutline = true;

  group.add(domeMesh, ringMesh);

  return {
    group,
    updateProgress(t) {
      const ease = 1 - Math.pow(1 - Math.min(1, t), 2.2);
      const r = Math.max(0.25, ease * maxRadius);
      domeMesh.scale.set(r, r * 0.72, r);
      ringMesh.scale.setScalar(r * 1.05);
      const fade = Math.max(0, 1 - t * t);
      domeMat.opacity = 0.78 * fade;
      ringMat.opacity = 0.9 * fade;
    },
    dispose() {
      domeGeo.dispose();
      ringGeo.dispose();
      domeMat.dispose();
      ringMat.dispose();
    },
  };
}

/**
 * Corona de estrellitas solares giratorias sobre la cabeza durante el estado
 * Aturdido / Cegado (`setStunned`).
 */
export function createLightStunStarsGroup(radius = 0.36) {
  const group = new THREE.Group();

  const ringGeo = new THREE.TorusGeometry(radius, 0.016, 8, 28);
  ringGeo.rotateX(Math.PI * 0.5);
  const ringMat = createEnergyVFXMaterial({
    coreColor: LIGHT_PALETTE.ivory,
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.84,
    additive: true,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.userData.noOutline = true;

  const starGeo = new THREE.OctahedronGeometry(0.068, 0);
  const starMat = createEnergyVFXMaterial({
    coreColor: '#ffffff',
    rimColor: LIGHT_PALETTE.solarGold,
    opacity: 0.95,
    additive: true,
    depthWrite: false,
  });

  group.add(ring);
  const stars = [];
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const s = new THREE.Mesh(starGeo, starMat);
    s.position.set(Math.cos(ang) * radius, 0.02, Math.sin(ang) * radius);
    s.userData.noOutline = true;
    group.add(s);
    stars.push(s);
  }

  return {
    group,
    stars,
    dispose() {
      ringGeo.dispose();
      starGeo.dispose();
      ringMat.dispose();
      starMat.dispose();
    },
  };
}
