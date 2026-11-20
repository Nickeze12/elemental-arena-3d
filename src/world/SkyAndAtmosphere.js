import * as THREE from 'three';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';

/**
 * SkyAndAtmosphere
 * ----------------------------------------------------------------------
 * Sistema atmosférico compartido para ambos mapas:
 *  - Cúpula celeste invertida con shader de gradiente suave + halo solar.
 *  - Cordilleras montañosas escalonadas con perspectiva aérea en 360°.
 *  - Nubes voluminosas redondeadas (suavizadas sin caras facetadas) flotando lentamente.
 *  - Niebla exponencial (`THREE.FogExp2`) + iluminación hemisférica y direccional suave.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRESETS = {
  coliseum: {
    name: 'ColiseumAtmosphere',
    fogColor: '#cf9769',
    fogDensity: 0.0056,
    skyTop: '#4a3d6e',
    skyMid: '#b56e5c',
    skyHorizon: '#f0b87d',
    skyBottom: '#291912',
    sunDir: [0.55, 0.42, 0.38],
    sunGlow: '#ffe29c',
    hemiSky: '#ffe0b3',
    hemiGround: '#435173',
    hemiIntensity: 0.96,
    sunColor: '#ffeed0',
    sunIntensity: 2.75,
    sunPos: [26, 40, 20],
    shadowExtent: 38,
    shadowFar: 112,
    fillColor: '#9fb4ff',
    fillIntensity: 0.38,
    fillPos: [-20, 12, -22],
    cloudColor: '#ffe7cb',
    cloudOutline: 0x9c6d56,
    cloudCount: 12,
    cloudRadius: [92, 165],
    cloudHeight: [28, 52],
    mountainLayers: [
      { radius: 146, count: 22, minH: 26, maxH: 48, color: '#8f695c', opacity: 0.95, seed: 2101 },
      { radius: 188, count: 28, minH: 38, maxH: 66, color: '#b8856d', opacity: 0.78, seed: 2202 },
    ],
  },
  sanctuary: {
    name: 'SanctuaryAtmosphere',
    fogColor: '#bce6ff',
    fogDensity: 0.0023,
    skyTop: '#1f83d6',
    skyMid: '#5db9f2',
    skyHorizon: '#caeeff',
    skyBottom: '#8bc6e8',
    sunDir: [0.46, 0.72, 0.36],
    sunGlow: '#fff7d2',
    hemiSky: '#ffffff',
    hemiGround: '#7ab37b',
    hemiIntensity: 1.15,
    sunColor: '#fff8e8',
    sunIntensity: 2.45,
    sunPos: [42, 72, 34],
    shadowExtent: 64,
    shadowFar: 165,
    fillColor: '#b5e2ff',
    fillIntensity: 0.45,
    fillPos: [-40, 28, -36],
    cloudColor: '#ffffff',
    cloudOutline: 0x9ec4dc,
    cloudCount: 16,
    cloudRadius: [64, 148],
    cloudHeight: [30, 56],
    mountainLayers: [
      { radius: 144, count: 24, minH: 22, maxH: 44, color: '#7ea6bd', opacity: 0.96, seed: 5501 },
      { radius: 186, count: 30, minH: 34, maxH: 62, color: '#a5cce0', opacity: 0.78, seed: 5602 },
    ],
  },
};

function createSkyDomeMesh(cfg) {
  const skyGeo = new THREE.SphereGeometry(420, 36, 20);
  const sunVec = new THREE.Vector3(...cfg.sunDir).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(cfg.skyTop) },
      midColor: { value: new THREE.Color(cfg.skyMid) },
      horizonColor: { value: new THREE.Color(cfg.skyHorizon) },
      bottomColor: { value: new THREE.Color(cfg.skyBottom) },
      sunDir: { value: sunVec },
      sunGlowColor: { value: new THREE.Color(cfg.sunGlow) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDir;
      uniform vec3 sunGlowColor;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col;
        if (h > 0.0) {
          float t1 = smoothstep(0.0, 0.28, h);
          float t2 = smoothstep(0.22, 0.85, h);
          col = mix(horizonColor, midColor, t1);
          col = mix(col, topColor, t2);
        } else {
          col = mix(horizonColor, bottomColor, smoothstep(0.0, 0.45, -h));
        }
        float sunAmt = max(0.0, dot(dir, sunDir));
        col += sunGlowColor * (pow(sunAmt, 14.0) * 0.28 + pow(sunAmt, 160.0) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(skyGeo, skyMat);
  mesh.name = `${cfg.name}_SkyDome`;
  mesh.renderOrder = -2;
  return mesh;
}

/**
 * Construye una cadena de cordilleras escalonadas suaves alrededor del horizonte 360°.
 */
function createMountainLayer(layer) {
  const group = new THREE.Group();
  const rng = mulberry32(layer.seed);
  const mat = new THREE.MeshToonMaterial({
    color: layer.color,
    transparent: layer.opacity < 0.99,
    opacity: layer.opacity,
    flatShading: false,
  });

  // Geometría cónica suavizada por perfil curvo y cresta orgánica
  const geoBase = new THREE.CylinderGeometry(0.14, 1.0, 1.0, 14, 4);
  geoBase.translate(0, 0.5, 0);
  const pos = geoBase.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 1e-4) {
      const ang = Math.atan2(z, x);
      const ridge = 1 + Math.sin(ang * 3 + layer.seed) * 0.14 + Math.cos(ang * 5) * 0.08;
      // Perfil cóncavo de ladera montañosa
      const curve = Math.pow(1 - y, 0.85);
      pos.setXYZ(i, (x / r) * (0.14 + 0.86 * curve) * ridge, y, (z / r) * (0.14 + 0.86 * curve) * ridge);
    }
  }
  geoBase.computeVertexNormals();

  for (let i = 0; i < layer.count; i++) {
    const a = (i / layer.count) * Math.PI * 2 + (rng() - 0.5) * 0.14;
    const h = layer.minH + rng() * (layer.maxH - layer.minH);
    const w = h * (0.72 + rng() * 0.42);
    const dist = layer.radius + (rng() - 0.5) * 18;
    const peak = new THREE.Mesh(geoBase, mat);
    peak.position.set(Math.cos(a) * dist, -6, Math.sin(a) * dist);
    peak.scale.set(w, h, w * (0.75 + rng() * 0.35));
    peak.rotation.y = rng() * Math.PI * 2;
    group.add(peak);
  }
  return group;
}

/**
 * Construye nubes estilizadas voluminosas compuestas por esferas suavizadas.
 */
function createStylizedCloudRing(cfg) {
  const group = new THREE.Group();
  const clouds = [];
  const cloudMat = createToonMaterial(cfg.cloudColor, { flatShading: false });
  const puffGeo = new THREE.SphereGeometry(1, 14, 10);
  const rng = mulberry32(cfg.name.length * 197 + 9042);

  for (let i = 0; i < cfg.cloudCount; i++) {
    const cg = new THREE.Group();
    const puffs = 4 + (i % 3);
    for (let p = 0; p < puffs; p++) {
      const rad = 3.0 + rng() * 2.8;
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.position.set((p - (puffs - 1) * 0.5) * 3.1, (rng() - 0.35) * 1.15, (rng() - 0.5) * 2.3);
      puff.scale.set(rad * 1.25, rad * 0.68, rad * 1.02);
      addOutline(puff, 0.045, cfg.cloudOutline);
      cg.add(puff);
    }
    const ang = (i / cfg.cloudCount) * Math.PI * 2 + rng() * 0.22;
    const dist = cfg.cloudRadius[0] + rng() * (cfg.cloudRadius[1] - cfg.cloudRadius[0]);
    const bx = Math.cos(ang) * dist;
    const by = cfg.cloudHeight[0] + rng() * (cfg.cloudHeight[1] - cfg.cloudHeight[0]);
    const bz = Math.sin(ang) * dist;
    cg.position.set(bx, by, bz);
    cg.rotation.y = -ang + Math.PI * 0.5;
    group.add(cg);

    clouds.push({
      group: cg,
      baseX: bx,
      baseY: by,
      speed: 0.38 + rng() * 0.45,
      phase: rng() * Math.PI * 2,
    });
  }

  return { group, clouds };
}

/**
 * Crea el conjunto atmosférico completo (cúpula de cielo, cordilleras, nubes, niebla y luces).
 * @param {THREE.Scene} scene
 * @param {'coliseum'|'sanctuary'} [preset='coliseum']
 */
export function createAtmosphereSystem(scene, preset = 'coliseum') {
  const cfg = PRESETS[preset] || PRESETS.coliseum;
  const fogColor = new THREE.Color(cfg.fogColor);
  const fog = new THREE.FogExp2(fogColor, cfg.fogDensity);

  const skyDome = createSkyDomeMesh(cfg);
  scene.add(skyDome);

  const backdropGroup = new THREE.Group();
  backdropGroup.name = `${cfg.name}_Backdrop`;
  for (const layer of cfg.mountainLayers) {
    backdropGroup.add(createMountainLayer(layer));
  }
  const cloudRing = createStylizedCloudRing(cfg);
  backdropGroup.add(cloudRing.group);
  scene.add(backdropGroup);

  const hemi = new THREE.HemisphereLight(cfg.hemiSky, cfg.hemiGround, cfg.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
  sun.position.set(...cfg.sunPos);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = cfg.shadowExtent;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 6;
  sun.shadow.camera.far = cfg.shadowFar;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.4;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(cfg.fillColor, cfg.fillIntensity);
  fill.position.set(...cfg.fillPos);
  scene.add(fill);

  const lights = [hemi, sun, fill];
  let elapsed = 0;

  return {
    skyDome,
    backdropGroup,
    fog,
    fogColor,
    lights,
    sun,
    clouds: cloudRing.clouds,
    apply() {
      scene.fog = fog;
      scene.background = fogColor.clone();
    },
    setVisible(visible) {
      skyDome.visible = !!visible;
      backdropGroup.visible = !!visible;
      for (const l of lights) l.visible = !!visible;
      if (visible) {
        scene.fog = fog;
        scene.background = fogColor.clone();
      }
    },
    update(dt, cameraPosition) {
      elapsed += dt;
      for (const cl of cloudRing.clouds) {
        cl.group.position.x = cl.baseX + Math.sin(elapsed * 0.055 * cl.speed + cl.phase) * 9.5;
        cl.group.position.y = cl.baseY + Math.cos(elapsed * 0.35 + cl.phase) * 0.65;
      }
      if (cameraPosition) {
        skyDome.position.copy(cameraPosition);
      }
    },
  };
}
