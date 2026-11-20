import * as THREE from 'three';
import { createToonMaterial, createEnergyVFXMaterial, addOutline } from '../utils/ToonMaterial.js';
import { createFabricWeaveTexture } from '../utils/ProceduralTextures.js';
import {
  createStoneSlab,
  createJaggedStalagmite,
  createEarthOrbitRocksGroup,
  createEarthRockTrapGroup,
  ROCK_PALETTE,
} from '../utils/RockGeometry.js';
import { createLayeredFlame, FIRE_PALETTE } from '../utils/FlameGeometry.js';
import { createWindRibbonTube, AIR_PALETTE } from '../utils/AirGeometry.js';
import { WATER_PALETTE } from '../utils/WaterGeometry.js';
import {
  createLeafBladeGeometry,
  createOrganicVineTubeGeometry,
  createRootClusterGroup,
  NATURE_PALETTE,
} from '../utils/NatureGeometry.js';
import {
  createHypnoticSpiralGroup,
  createRuneHaloGroup,
  PSYCHIC_PALETTE,
} from '../utils/PsychicGeometry.js';
import {
  createMistClusterGroup,
  createZigzagBoltGeometry,
  STORM_PALETTE,
} from '../utils/StormGeometry.js';
import {
  LIGHT_PALETTE,
  createRefractionPrismGroup,
  createLightStunStarsGroup,
} from '../utils/LightGeometry.js';
import {
  SHADOW_PALETTE,
  createShadowScytheGeo,
} from '../utils/ShadowGeometry.js';
import {
  resolveElementFromTheme,
  buildCharacterAppearance,
  CHARACTER_OUTLINE_THICKNESS,
  DETAIL_OUTLINE_THICKNESS,
  HEAD_OUTLINE_THICKNESS,
  CHARACTER_OUTLINE_COLOR,
} from './CharacterOutfitBuilder.js';

/**
 * FighterMesh
 * ------------------------------------------------------------
 * Modelo 3D estilizado (estilo anime / cel-shaded tipo Absolver / Rumble)
 * con anatomía en V esculpida por deformación de vértices (cero cilindros con
 * tapa plana), trapecios inclinados, deltoides integrados, cintura estrecha
 * con fajín ceñido y pantalones holgados de artes marciales ajustados en las
 * pantorrillas.
 *
 * Convenciones (espacio local del personaje):
 *  - El personaje mira hacia +Z. Su lado izquierdo es +X, el derecho -X.
 *  - Extremidades cuelgan hacia -Y desde su pivote.
 *  - rotation.x negativo en cadera/hombro = balanceo hacia adelante.
 *  - rotation.x positivo en rodilla = flexión (pantorrilla hacia atrás).
 *  - rotation.x negativo en codo = flexión (antebrazo hacia adelante).
 *
 * Jerarquía:
 *  root (pies en y=0)
 *   └─ hips ─┬─ spine ── chest ─┬─ neck ── head (cinta + coletas)
 *            │                  ├─ shoulderL ── elbowL ── wristL (puño)
 *            │                  └─ shoulderR ── elbowR ── wristR
 *            ├─ hipL ── kneeL ── ankleL (pie)
 *            └─ hipR ── kneeR ── ankleR
 */

// Dimensiones del esqueleto (proporciones atléticas esbeltas)
const THIGH = 0.46;
const CALF = 0.44;
const FOOT_H = 0.08;
const HIP_HEIGHT = THIGH + CALF + FOOT_H;
const UPPER_ARM = 0.30;
const FOREARM = 0.28;

// Paletas de temas visuales para los 4 Elementos (Jugador y Rival IA):
export const FIGHTER_THEMES = {
  // Alias por defecto
  player: {
    bareChest: true,
    skin: '#d9a176',
    tunic: '#556630',
    tunicDark: '#3d4a22',
    ochre: '#b88228',
    ochreDark: '#7d5516',
    pants: '#475428',
    boots: '#3b2b1d',
    wraps: '#d4be94',
    hair: '#241811',
    band: '#3c5224',
    eye: '#1a120c',
  },
  rival: {
    bareChest: false,
    skin: '#cfa07e',
    tunic: '#2b292e',
    tunicDark: '#19171c',
    ochre: '#c93038',
    ochreDark: '#871b22',
    pants: '#222028',
    boots: '#161318',
    wraps: '#9e242b',
    hair: '#141116',
    band: '#b8252d',
    eye: '#2b090c',
  },
  // 1. Tierra: verde oliva y ocre dorado
  earth: {
    bareChest: true,
    skin: '#d9a176',
    tunic: '#556630',
    tunicDark: '#3d4a22',
    ochre: '#c8942c',
    ochreDark: '#7d5516',
    pants: '#475428',
    boots: '#3b2b1d',
    wraps: '#d4be94',
    hair: '#241811',
    band: '#3c5224',
    eye: '#1a120c',
  },
  earth_rival: {
    bareChest: false,
    skin: '#cfa07e',
    tunic: '#292e24',
    tunicDark: '#1b2017',
    ochre: '#d49b35',
    ochreDark: '#8c6218',
    pants: '#252b20',
    boots: '#181c14',
    wraps: '#a88952',
    hair: '#181410',
    band: '#c8942c',
    eye: '#1a120c',
  },
  // 2. Fuego: carmesí oscuro, dorado imperial y carbón
  fire: {
    bareChest: true,
    skin: '#deaa82',
    tunic: '#7a1c1c',
    tunicDark: '#4d1010',
    ochre: '#e5a93c',
    ochreDark: '#9e2424',
    pants: '#5c1919',
    boots: '#241515',
    wraps: '#332222',
    hair: '#1a1111',
    band: '#b82525',
    eye: '#2b090c',
  },
  fire_rival: {
    bareChest: false,
    skin: '#cfa07e',
    tunic: '#2b2022',
    tunicDark: '#1a1214',
    ochre: '#e03c31',
    ochreDark: '#8f1d18',
    pants: '#24181a',
    boots: '#140d0e',
    wraps: '#b82828',
    hair: '#141012',
    band: '#e03c31',
    eye: '#2b090c',
  },
  // 3. Agua: azul marino, celeste ártico y vendas blancas
  water: {
    bareChest: true,
    skin: '#c9936b',
    tunic: '#1e4878',
    tunicDark: '#132f52',
    ochre: '#5ce1ff',
    ochreDark: '#26689e',
    pants: '#1c3f6e',
    boots: '#162840',
    wraps: '#e8f4fa',
    hair: '#1c1614',
    band: '#2b7ec2',
    eye: '#122030',
  },
  water_rival: {
    bareChest: false,
    skin: '#bfa08a',
    tunic: '#16283d',
    tunicDark: '#0e1a29',
    ochre: '#48c8f0',
    ochreDark: '#1d648a',
    pants: '#132236',
    boots: '#0d1624',
    wraps: '#96d8f0',
    hair: '#121820',
    band: '#3bb4e0',
    eye: '#101c2b',
  },
  // 4. Aire: naranja azafrán, amarillo monje y tierra cálida
  air: {
    bareChest: true,
    skin: '#e0af86',
    tunic: '#d96b27',
    tunicDark: '#9e4714',
    ochre: '#f5be42',
    ochreDark: '#c95b1e',
    pants: '#d46524',
    boots: '#4a321e',
    wraps: '#f2dfb3',
    hair: '#291d14',
    band: '#e89c31',
    eye: '#1f1610',
  },
  air_rival: {
    bareChest: false,
    skin: '#d4a37d',
    tunic: '#3b2c22',
    tunicDark: '#261b14',
    ochre: '#f08c2b',
    ochreDark: '#a85214',
    pants: '#523824',
    boots: '#241810',
    wraps: '#e0b86b',
    hair: '#1c1510',
    band: '#f08c2b',
    eye: '#1f1610',
  },
  // 5. Naturaleza / Planta: verde bosque profundo, esmeralda luminoso y corteza
  nature: {
    bareChest: false,
    skin: '#d9a47b',
    tunic: '#2d6a4f',
    tunicDark: '#1b4332',
    ochre: '#52b788',
    ochreDark: '#5c4033',
    pants: '#5c4033',
    boots: '#3d281f',
    wraps: '#95d5b2',
    hair: '#1b3124',
    band: '#52b788',
    eye: '#173d29',
  },
  nature_rival: {
    bareChest: false,
    skin: '#cfa07e',
    tunic: '#1e3a2f',
    tunicDark: '#12241d',
    ochre: '#4ade80',
    ochreDark: '#3d281f',
    pants: '#3b2920',
    boots: '#241812',
    wraps: '#74c69d',
    hair: '#142419',
    band: '#4ade80',
    eye: '#10301c',
  },
  // 6. Psíquico: índigo profundo, violeta real, magenta luminoso y plata
  psychic: {
    bareChest: false,
    skin: '#deb597',
    tunic: '#3b0764',
    tunicDark: '#240440',
    ochre: '#e879f9',
    ochreDark: '#7e22ce',
    pants: '#2e084d',
    boots: '#1c0530',
    wraps: '#f3e8ff',
    hair: '#1e1030',
    band: '#e879f9',
    eye: '#c026d3',
  },
  psychic_rival: {
    bareChest: false,
    skin: '#cfa389',
    tunic: '#23053b',
    tunicDark: '#160326',
    ochre: '#d946ef',
    ochreDark: '#581c87',
    pants: '#1b042e',
    boots: '#12021f',
    wraps: '#d8b4fe',
    hair: '#140921',
    band: '#d946ef',
    eye: '#e879f9',
  },
  // 7. Tormenta: gris tormenta/pizarra, azul eléctrico, rayo dorado y niebla plateada
  storm: {
    bareChest: false,
    skin: '#d9b59a',
    tunic: '#1e293b',
    tunicDark: '#0f172a',
    ochre: '#fde047',
    ochreDark: '#38bdf8',
    pants: '#1a2333',
    boots: '#0f172a',
    wraps: '#e2e8f0',
    hair: '#1c2430',
    band: '#38bdf8',
    eye: '#38bdf8',
  },
  storm_rival: {
    bareChest: false,
    skin: '#cc9f84',
    tunic: '#0f172a',
    tunicDark: '#090e1a',
    ochre: '#facc15',
    ochreDark: '#0284c7',
    pants: '#111827',
    boots: '#060a12',
    wraps: '#cbd5e1',
    hair: '#0f172a',
    band: '#fde047',
    eye: '#fde047',
  },
  // 8. Luz / Prisma: blanco perlado, marfil cálido, dorado solar, cian prismático y ámbar
  light: {
    bareChest: false,
    skin: '#f0cbb0',
    tunic: '#f8fafc',
    tunicDark: '#fef9c3',
    ochre: '#facc15',
    ochreDark: '#d97706',
    pants: '#f1f5f9',
    boots: '#d97706',
    wraps: '#38bdf8',
    hair: '#f3d98b',
    band: '#facc15',
    eye: '#f59e0b',
  },
  light_rival: {
    bareChest: false,
    skin: '#e2bda3',
    tunic: '#e2e8f0',
    tunicDark: '#cbd5e1',
    ochre: '#fb7185',
    ochreDark: '#be123c',
    pants: '#cbd5e1',
    boots: '#9f1239',
    wraps: '#22d3ee',
    hair: '#475569',
    band: '#fb7185',
    eye: '#22d3ee',
  },
  // 9. Sombra: negro obsidiana, índigo nocturno, violeta abisal y carmesí neón
  shadow: {
    bareChest: false,
    skin: '#e8c8b5',
    tunic: '#09090b',
    tunicDark: '#1e1b4b',
    ochre: '#f43f5e',
    ochreDark: '#6d28d9',
    pants: '#111118',
    boots: '#09090b',
    wraps: '#4c1d95',
    hair: '#0c0a14',
    band: '#f43f5e',
    eye: '#f43f5e',
  },
  shadow_rival: {
    bareChest: false,
    skin: '#dcbaa6',
    tunic: '#18181b',
    tunicDark: '#3b0764',
    ochre: '#e11d48',
    ochreDark: '#581c87',
    pants: '#181420',
    boots: '#09090b',
    wraps: '#6d28d9',
    hair: '#14101a',
    band: '#e11d48',
    eye: '#e11d48',
  },
};

const COLORS = FIGHTER_THEMES.player;

/**
 * Canales animables: [nombreArticulación, propiedad].
 */
const CHANNELS = [
  ['hips', 'py'], ['hips', 'rx'], ['hips', 'ry'], ['hips', 'rz'],
  ['spine', 'rx'], ['spine', 'ry'], ['spine', 'rz'],
  ['chest', 'rx'], ['chest', 'ry'], ['chest', 'rz'],
  ['head', 'rx'], ['head', 'ry'], ['head', 'rz'],
  ['shoulderL', 'rx'], ['shoulderL', 'ry'], ['shoulderL', 'rz'],
  ['shoulderR', 'rx'], ['shoulderR', 'ry'], ['shoulderR', 'rz'],
  ['elbowL', 'rx'], ['elbowR', 'rx'],
  ['wristL', 'rx'], ['wristL', 'rz'], ['wristR', 'rx'], ['wristR', 'rz'],
  ['hipL', 'rx'], ['hipL', 'ry'], ['hipL', 'rz'],
  ['hipR', 'rx'], ['hipR', 'ry'], ['hipR', 'rz'],
  ['kneeL', 'rx'], ['kneeR', 'rx'],
  ['ankleL', 'rx'], ['ankleL', 'rz'], ['ankleR', 'rx'], ['ankleR', 'rz'],
];
const CHANNEL_KEYS = CHANNELS.map(([j, p]) => `${j}.${p}`);

const STATES = ['idle', 'run', 'jump', 'dash'];

export class FighterMesh {
  /**
   * @param {string | Partial<typeof COLORS>} [theme='player'] nombre de tema ('player' | 'rival') u objeto de colores
   */
  constructor(theme = 'player') {
    this.root = new THREE.Group();
    this.root.name = 'Fighter';

    const baseTheme = typeof theme === 'string' ? (FIGHTER_THEMES[theme] || COLORS) : { ...COLORS, ...theme };
    this.colors = baseTheme;
    const resolved = resolveElementFromTheme(typeof theme === 'string' ? theme : 'earth');
    this._builtElement = null;
    this._builtRival = null;

    /** @type {Record<string, THREE.Object3D>} */
    this.joints = {};
    /** Materiales propios (para efectos como el destello de reaparición o impacto) */
    this.materials = [];
    this._extraMaterials = [];
    this._appearanceNodes = [];
    this._secondary = { ponytail: null, flaps: [], scarves: [], clothMeshes: [], runeHalo: null, prismWings: [] };

    this._buildMaterials();
    this._buildJointHierarchy();
    this._rebuildAppearance(resolved.element, resolved.isRival);

    // Cristal de hielo facetado para el estado alterado Congelado (oculto por defecto)
    this._isFrozen = false;
    this._buildFreezeCrystal();

    // Llamas adheridas al torso/hombros para el estado alterado Quemadura
    this._isBurning = false;
    this._burnFlames = [];
    this._buildBurnFlames();

    // Lianas espinosas abrazando las piernas (Enredado) y esporas ascendentes (Veneno)
    this._isRooted = false;
    this._rootGroup = null;
    this._buildRootRing();

    this._isPoisoned = false;
    this._poisonGroup = null;
    this._poisonSpores = [];
    this._buildPoisonSpores();

    // Espiral hipnótica magenta sobre la cabeza para Confusión / Pavor
    this._isConfused = false;
    this._confusedGroup = null;
    this._buildConfusedSpiral();

    // Estrellitas solares giratorias sobre la cabeza para Aturdido / Cegado
    this._isStunned = false;
    this._stunGroup = null;
    this._buildStunStars();

    // Rocas orbitales flotantes (1..3 golpes de Disco Roca) y prisión de roca de medio cuerpo (3.0s)
    this._earthOrbitCount = 0;
    this._earthOrbitData = createEarthOrbitRocksGroup(1.0);
    this._earthOrbitData.group.visible = false;
    this.root.add(this._earthOrbitData.group);

    this._isEarthTrapped = false;
    this._earthTrapData = createEarthRockTrapGroup(1.0);
    this._earthTrapData.group.visible = false;
    this.root.add(this._earthTrapData.group);

    // Nube de niebla translúcida y arcos eléctricos para Forma de Niebla (Tormenta)
    this._isMistForm = false;
    this._mistGroup = null;
    this._mistData = null;
    this._buildMistForm();

    // Camuflaje de penumbra y volutas oscuras para Velo de Eclipse / Paso Sombrío
    this._isShadowVeil = false;
    this._shadowVeilGroup = null;
    this._shadowVeilPuffs = [];
    this._buildShadowVeil();

    // Aro luminoso a ras del suelo para identificación de equipos (2v2)
    this._teamRole = null;
    this._buildTeamRing();

    // Aura Elemental definitiva del Modo Supervivencia (Tecla R)
    this._auraGroup = null;
    this._auraElement = null;
    this._auraActive = false;
    this._auraRadiusScale = 1;
    this._auraSpinGroup = null;
    this._auraParts = [];
    this._auraDisposables = [];

    // --- Estado del controlador de animación ---
    this.time = 0;
    this.runPhase = 0;
    this._prevRootYaw = 0;
    this._turnSwing = 0;
    this.currentState = 'idle';
    this.weights = { idle: 1, run: 0, jump: 0, dash: 0 };
    this._poseBuffer = new Float32Array(CHANNELS.length);
    this._tmpPose = new Float32Array(CHANNELS.length);
    this._actionPose = new Float32Array(CHANNELS.length);
    this._flash = 0;
    this._flashColor = '#ffcf80';
    this._hitFlash = 0;

    // --- Capa de acciones (golpes / técnicas) ---
    /** @type {{name:string, def:object, time:number, duration:number} | null} */
    this.action = null;
    this._legBlend = 1;
  }

  /**
   * Reproduce una acción marcial sobre la locomoción.
   * @param {string} actionName punch_right | punch_left | guard_wall | stomp_seismic | heavy_throw | hit_react
   * @param {number} [duration]
   */
  playAction(actionName, duration) {
    const def = ACTIONS[actionName];
    if (!def) {
      console.warn(`FighterMesh: acción desconocida "${actionName}"`);
      return;
    }
    this.action = { name: actionName, def, time: 0, duration: duration ?? def.duration };
  }

  get currentAction() {
    return this.action ? this.action.name : null;
  }

  /**
   * Actualiza la paleta de colores y reconstruye el atuendo y peinado si cambia
   * el elemento o rol (jugador / rival) manteniendo intactas todas las articulaciones.
   * @param {string | Partial<typeof COLORS>} theme
   */
  setTheme(theme) {
    const next = typeof theme === 'string' ? (FIGHTER_THEMES[theme] || COLORS) : { ...COLORS, ...theme };
    this.colors = next;
    const M = this.mat;
    M.skin.color.set(next.skin);
    M.tunic.color.set(next.tunic);
    M.tunicDark.color.set(next.tunicDark);
    M.ochre.color.set(next.ochre);
    M.ochreDark.color.set(next.ochreDark);
    M.pants.color.set(next.pants);
    M.boots.color.set(next.boots);
    M.wraps.color.set(next.wraps || next.ochre);
    M.hair.color.set(next.hair);
    M.band.color.set(next.band);
    M.eye.color.set(next.eye);

    if (typeof theme === 'string') {
      const resolved = resolveElementFromTheme(theme);
      if (resolved.element !== this._builtElement || resolved.isRival !== this._builtRival) {
        this._rebuildAppearance(resolved.element, resolved.isRival);
      }
    }
  }

  /**
   * Construye el bloque/cristal de hielo facetado semitransparente que envuelve
   * piernas y torso cuando el luchador está congelado (`applyFreeze`).
   */
  _buildFreezeCrystal() {
    const group = new THREE.Group();
    group.name = 'FreezeCrystal';
    group.visible = false;

    const iceMainMat = createToonMaterial('#5ce1ff', {
      flatShading: true,
      transparent: true,
      opacity: 0.62,
      emissive: '#22a8e6',
      emissiveIntensity: 0.25,
    });
    const iceLightMat = createToonMaterial('#b0f5ff', {
      flatShading: true,
      transparent: true,
      opacity: 0.68,
      emissive: '#6ce6ff',
      emissiveIntensity: 0.3,
    });

    // Bloque central facetado envolviendo piernas y cintura
    const coreGeo = createStoneSlab(0.76, 1.32, 0.68, 404);
    const coreMesh = new THREE.Mesh(coreGeo, iceMainMat);
    coreMesh.position.y = -0.02;
    group.add(coreMesh);

    // 4 agujas/cristales laterales angulados emergiendo de la base
    const shardAngles = [0.4, 2.0, 3.6, 5.1];
    shardAngles.forEach((a, i) => {
      const h = 0.95 + (i % 2) * 0.28;
      const sGeo = createJaggedStalagmite(h, 0.26, 700 + i * 31);
      const sMesh = new THREE.Mesh(sGeo, i % 2 === 0 ? iceLightMat : iceMainMat);
      sMesh.position.set(Math.cos(a) * 0.28, -0.02, Math.sin(a) * 0.26);
      sMesh.rotation.z = -Math.cos(a) * 0.26;
      sMesh.rotation.x = Math.sin(a) * 0.26;
      group.add(sMesh);
    });

    addOutline(group, 0.012, 0x0b2a42);
    this.root.add(group);
    this._freezeGroup = group;
  }

  /**
   * Activa o desactiva el estado visual de congelamiento (muestra el cristal
   * de hielo facetado y tiñe la paleta del luchador a tonos gélidos).
   * @param {boolean} frozen
   */
  setFrozen(frozen) {
    const next = !!frozen;
    if (this._isFrozen === next) return;
    this._isFrozen = next;
    if (this._freezeGroup) {
      this._freezeGroup.visible = next;
    }
    if (!next && this._hitFlash <= 0 && this._flash <= 0 && !this._isBurning) {
      for (const m of this.materials) {
        m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Construye pequeñas lenguas de fuego Cel-Shaded adheridas al torso y hombros
   * para el estado alterado Quemadura (`applyBurn`).
   */
  _buildBurnFlames() {
    const anchors = [
      { parent: this.joints.chest, pos: [0, 0.22, 0.13], r: 0.085, h: 0.28, seed: 1.1 },
      { parent: this.joints.chest, pos: [0, 0.24, -0.13], r: 0.09, h: 0.30, seed: 2.4 },
      { parent: this.joints.shoulderL, pos: [0.04, 0.04, 0.0], r: 0.075, h: 0.25, seed: 3.7 },
      { parent: this.joints.shoulderR, pos: [-0.04, 0.04, 0.0], r: 0.075, h: 0.25, seed: 5.0 },
    ];
    for (const a of anchors) {
      if (!a.parent) continue;
      const flame = createLayeredFlame(a.r, a.h, a.seed, 0.2, 0.008);
      flame.group.position.set(a.pos[0], a.pos[1], a.pos[2]);
      flame.group.visible = false;
      a.parent.add(flame.group);
      this._burnFlames.push({ group: flame.group, phase: a.seed });
    }
  }

  /**
   * Activa o desactiva el estado visual de quemadura en torso y hombros.
   * @param {boolean} burning
   */
  setBurning(burning) {
    const next = !!burning;
    if (this._isBurning === next) return;
    this._isBurning = next;
    for (const bf of this._burnFlames) {
      bf.group.visible = next;
    }
    if (!next && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen && !this._isPoisoned) {
      for (const m of this.materials) {
        m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Construye el anillo de lianas y raíces espinosas abrazando las piernas (`applyRoot`).
   */
  _buildRootRing() {
    const group = new THREE.Group();
    group.name = 'RootTrap';
    group.visible = false;

    const vineMat = createToonMaterial(NATURE_PALETTE.deepForest, {
      emissive: '#1b4332',
      emissiveIntensity: 0.25,
    });
    const barkMat = createToonMaterial(NATURE_PALETTE.bark, { flatShading: true });

    // Aros de lianas entrelazados alrededor de tobillos y rodillas
    for (const [y, r, tiltX, tiltZ] of [
      [0.24, 0.34, 0.16, -0.12],
      [0.44, 0.31, -0.18, 0.14],
      [0.62, 0.28, 0.12, 0.18],
    ]) {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.042, 6, 18), vineMat);
      torus.position.y = y;
      torus.rotation.set(Math.PI * 0.5 + tiltX, 0, tiltZ);
      addOutline(torus, 0.011, 0x152018);
      group.add(torus);
    }

    // 4 cúmulos de raíces espinosas rodeando las piernas desde el suelo
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.35;
      const cluster = createRootClusterGroup(0.68, 0.2, i + 1);
      cluster.group.position.set(Math.cos(ang) * 0.26, 0, Math.sin(ang) * 0.26);
      cluster.group.rotation.y = -ang;
      cluster.group.rotation.x = 0.14;
      group.add(cluster.group);
    }

    // Base sutil de corteza agarrada al suelo
    const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.08, 10), barkMat);
    baseRing.position.y = 0.04;
    addOutline(baseRing, 0.011, 0x152018);
    group.add(baseRing);

    this.root.add(group);
    this._rootGroup = group;
  }

  /**
   * Activa o desactiva las lianas abrazando las piernas (`applyRoot`).
   * @param {boolean} rooted
   */
  setRooted(rooted) {
    const next = !!rooted;
    if (this._isRooted === next) return;
    this._isRooted = next;
    if (this._rootGroup) {
      this._rootGroup.visible = next;
      if (next) this._rootGroup.scale.set(1, 0.85, 1);
    }
  }

  /**
   * Construye burbujas/esporas verde esmeralda ascendentes sobre el luchador (`applyPoison`).
   */
  _buildPoisonSpores() {
    const group = new THREE.Group();
    group.name = 'PoisonSpores';
    group.visible = false;

    const sporeMat = createEnergyVFXMaterial({
      coreColor: '#f0fdf4',
      rimColor: NATURE_PALETTE.spore,
      opacity: 0.9,
      additive: true,
      softEdge: true,
      depthWrite: false,
    });
    const sporeGeo = new THREE.SphereGeometry(0.068, 12, 10);

    for (let i = 0; i < 9; i++) {
      const mesh = new THREE.Mesh(sporeGeo, sporeMat);
      mesh.userData.noOutline = true;
      group.add(mesh);
      this._poisonSpores.push({
        mesh,
        phase: (i / 9) * Math.PI * 2,
        speed: 1.05 + (i % 3) * 0.32,
        radius: 0.34 + (i % 4) * 0.11,
        yOffset: (i / 9) * 1.45,
      });
    }

    this.root.add(group);
    this._poisonGroup = group;
  }

  /**
   * Activa o desactiva las esporas de veneno ascendentes (`applyPoison`).
   * @param {boolean} poisoned
   */
  setPoisoned(poisoned) {
    const next = !!poisoned;
    if (this._isPoisoned === next) return;
    this._isPoisoned = next;
    if (this._poisonGroup) {
      this._poisonGroup.visible = next;
    }
    if (!next && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen && !this._isBurning && !this._isConfused) {
      for (const m of this.materials) {
        m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Construye la espiral/anillo hipnótico magenta orbitando sobre la cabeza (`applyConfusion`).
   */
  _buildConfusedSpiral() {
    const spiral = createHypnoticSpiralGroup();
    spiral.group.position.set(0, 2.02, 0);
    spiral.group.visible = false;
    this.root.add(spiral.group);
    this._confusedGroup = spiral.group;
  }

  /**
   * Activa o desactiva la espiral hipnótica magenta sobre la cabeza del luchador o monstruo.
   * @param {boolean} confused
   */
  setConfused(confused) {
    const next = !!confused;
    if (this._isConfused === next) return;
    this._isConfused = next;
    if (this._confusedGroup) {
      this._confusedGroup.visible = next;
    }
    if (!next && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen && !this._isBurning && !this._isPoisoned && !this._isMistForm && !this._isStunned) {
      for (const m of this.materials) {
        m.emissiveIntensity = 0;
      }
    }
  }

  _buildStunStars() {
    const st = createLightStunStarsGroup(0.36);
    st.group.position.set(0, 2.04, 0);
    st.group.visible = false;
    this.root.add(st.group);
    this._stunGroup = st.group;
  }

  /**
   * Activa o desactiva la corona solar de aturdimiento sobre la cabeza (`applyStun`).
   * @param {boolean} stunned
   */
  setStunned(stunned) {
    const next = !!stunned;
    if (this._isStunned === next) return;
    this._isStunned = next;
    if (this._stunGroup) {
      this._stunGroup.visible = next;
    }
  }

  /** Muestra 0..3 rocas flotando alrededor del personaje por golpes de Disco Roca */
  setEarthOrbitRocks(count) {
    const next = Math.max(0, Math.min(3, Math.round(count || 0)));
    if (this._earthOrbitCount === next) return;
    this._earthOrbitCount = next;
    if (this._earthOrbitData) {
      this._earthOrbitData.setCount(next);
    }
  }

  /** Activa o desactiva las rocas atrapando la mitad del cuerpo (inmovilización 3.0s) */
  setEarthTrapped(trapped) {
    const next = !!trapped;
    if (this._isEarthTrapped === next) return;
    this._isEarthTrapped = next;
    if (this._earthTrapData && this._earthTrapData.group) {
      this._earthTrapData.group.visible = next;
      if (next) this._earthTrapData.group.scale.set(1, 0.92, 1);
    }
  }

  /**
   * Construye la silueta vaporosa translúcida y arcos eléctricos para Forma de Niebla (`setMistForm`).
   */
  _buildMistForm() {
    const cluster = createMistClusterGroup(1.0);
    cluster.group.position.set(0, 0.92, 0);
    cluster.group.visible = false;

    const arcGeoA = createZigzagBoltGeometry(
      new THREE.Vector3(-0.55, 0.25, 0.25),
      new THREE.Vector3(0.55, -0.35, -0.25),
      { segments: 6, jitter: 0.14, radius: 0.022, seed: 41 }
    );
    const arcGeoB = createZigzagBoltGeometry(
      new THREE.Vector3(0.45, -0.2, 0.35),
      new THREE.Vector3(-0.45, 0.45, -0.2),
      { segments: 6, jitter: 0.14, radius: 0.02, seed: 73 }
    );
    const arcMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: STORM_PALETTE.electricBlue,
      opacity: 0.92,
      additive: true,
      depthWrite: false,
    });
    const arcA = new THREE.Mesh(arcGeoA, arcMat);
    const arcB = new THREE.Mesh(arcGeoB, arcMat);
    arcA.userData.noOutline = true;
    arcB.userData.noOutline = true;
    cluster.group.add(arcA, arcB);

    this.root.add(cluster.group);
    this._mistGroup = cluster.group;
    this._mistData = { cluster, arcs: [arcA, arcB], arcMat };
  }

  /**
   * Activa o desactiva la Forma de Niebla (cuerpo semitransparente vaporoso + arcos eléctricos).
   * @param {boolean} active
   */
  setMistForm(active) {
    const next = !!active;
    if (this._isMistForm === next) return;
    this._isMistForm = next;
    if (this._mistGroup) {
      this._mistGroup.visible = next;
    }

    const allMats = this.materials.concat(this._extraMaterials);
    const translucent = next || this._isShadowVeil;
    for (const m of allMats) {
      m.transparent = translucent;
      m.opacity = next ? 0.24 : this._isShadowVeil ? 0.28 : 1.0;
      m.needsUpdate = true;
    }

    if (!next && !this._isShadowVeil && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen && !this._isBurning && !this._isPoisoned && !this._isConfused) {
      for (const m of allMats) {
        m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Construye el halo sutil de volutas oscuras para el estado de camuflaje (`setShadowVeil`).
   */
  _buildShadowVeil() {
    const group = new THREE.Group();
    group.name = 'ShadowVeilFX';
    group.visible = false;

    const wispGeo = new THREE.SphereGeometry(0.16, 12, 10);
    const wispMat = createEnergyVFXMaterial({
      coreColor: SHADOW_PALETTE.obsidian,
      rimColor: SHADOW_PALETTE.abyssViolet,
      opacity: 0.72,
      softEdge: true,
      depthWrite: false,
    });
    const crimsonMat = createEnergyVFXMaterial({
      coreColor: SHADOW_PALETTE.abyssViolet,
      rimColor: SHADOW_PALETTE.crimsonNeon,
      opacity: 0.64,
      additive: true,
      softEdge: true,
      depthWrite: false,
    });

    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const puff = new THREE.Mesh(wispGeo, i % 3 === 0 ? crimsonMat : wispMat);
      puff.position.set(Math.cos(ang) * 0.42, 0.55 + (i % 3) * 0.32, Math.sin(ang) * 0.42);
      puff.userData.noOutline = true;
      group.add(puff);
      this._shadowVeilPuffs.push({ mesh: puff, angle: ang, baseY: puff.position.y, phase: i * 1.05 });
    }

    this.root.add(group);
    this._shadowVeilGroup = group;
  }

  /**
   * Activa o desactiva el camuflaje semitransparente de Sombra (`opacity ~0.28` + volutas oscuras).
   * @param {boolean} active
   */
  setShadowVeil(active) {
    const next = !!active;
    if (this._isShadowVeil === next) return;
    this._isShadowVeil = next;
    if (this._shadowVeilGroup) {
      this._shadowVeilGroup.visible = next;
    }

    const allMats = this.materials.concat(this._extraMaterials);
    const translucent = next || this._isMistForm;
    for (const m of allMats) {
      m.transparent = translucent;
      m.opacity = this._isMistForm ? 0.24 : next ? 0.28 : 1.0;
      m.needsUpdate = true;
    }

    if (!next && !this._isMistForm && this._hitFlash <= 0 && this._flash <= 0 && !this._isFrozen && !this._isBurning && !this._isPoisoned && !this._isConfused) {
      for (const m of allMats) {
        m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Aro luminoso bajo los pies del luchador para distinguir aliado (celeste)
   * y rivales (carmesí) en modo Batalla por Equipos 2v2.
   */
  _buildTeamRing() {
    const group = new THREE.Group();
    group.name = 'TeamRing';
    group.position.y = 0.045;
    group.visible = false;

    const outerGeo = new THREE.RingGeometry(0.56, 0.72, 32);
    outerGeo.rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: '#38d6ff',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.userData.noOutline = true;

    const innerGeo = new THREE.RingGeometry(0.42, 0.54, 32);
    innerGeo.rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: '#a8f0ff',
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.userData.noOutline = true;

    group.add(outerMesh, innerMesh);
    this.root.add(group);
    this._teamRing = group;
    this._teamRingOuterMat = outerMat;
    this._teamRingInnerMat = innerMat;
  }

  /**
   * @param {'ally' | 'enemy' | null} role
   */
  setTeamRing(role = null) {
    this._teamRole = role;
    if (!this._teamRing) return;
    if (!role) {
      this._teamRing.visible = false;
      return;
    }
    this._teamRing.visible = true;
    if (role === 'ally') {
      this._teamRingOuterMat.color.set('#38d6ff');
      this._teamRingInnerMat.color.set('#b4f4ff');
    } else {
      this._teamRingOuterMat.color.set('#ff3b4e');
      this._teamRingInnerMat.color.set('#ff99a4');
    }
  }

  // ============================================================
  //  Materiales y utilidades de jerarquía
  // ============================================================

  _buildMaterials() {
    const C = this.colors;
    const fabricMap = createFabricWeaveTexture({ repeatX: 4, repeatY: 4, contrast: 0.085 });
    const make = (color, extra = {}) => {
      const m = createToonMaterial(color, extra);
      this.materials.push(m);
      return m;
    };
    this.mat = {
      skin: make(C.skin),
      tunic: make(C.tunic, { map: fabricMap }),
      tunicDark: make(C.tunicDark, { side: THREE.DoubleSide, map: fabricMap }),
      ochre: make(C.ochre),
      ochreDark: make(C.ochreDark),
      pants: make(C.pants, { map: fabricMap }),
      boots: make(C.boots),
      wraps: make(C.wraps || C.ochre, { map: fabricMap }),
      hair: make(C.hair),
      band: make(C.band, { map: fabricMap }),
      eye: make(C.eye),
    };
  }

  _getOutlineThickness(node) {
    if (node.userData.outlineThickness !== undefined) {
      return node.userData.outlineThickness;
    }
    let p = node.parent;
    while (p && p !== this.root) {
      if (p === this.joints.head || p === this.joints.neck) {
        return HEAD_OUTLINE_THICKNESS;
      }
      if (p === this.joints.wristL || p === this.joints.wristR) {
        return DETAIL_OUTLINE_THICKNESS;
      }
      p = p.parent;
    }
    return CHARACTER_OUTLINE_THICKNESS;
  }

  _joint(name, parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    this.joints[name] = g;
    return g;
  }

  _mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // ============================================================
  //  Esqueleto Jerárquico + Construcción Modular de Vestimenta
  // ============================================================

  _buildJointHierarchy() {
    const hips = this._joint('hips', this.root, 0, HIP_HEIGHT, 0);
    const spine = this._joint('spine', hips, 0, 0.05, 0);
    const chest = this._joint('chest', spine, 0, 0.22, 0);
    const neck = this._joint('neck', chest, 0, 0.36, 0);
    this._joint('head', neck, 0, 0.085, 0);

    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const shoulder = this._joint(`shoulder${side}`, chest, s * 0.225, 0.255, 0);
      const elbow = this._joint(`elbow${side}`, shoulder, 0, -UPPER_ARM, 0);
      this._joint(`wrist${side}`, elbow, 0, -FOREARM, 0);

      const hip = this._joint(`hip${side}`, hips, s * 0.105, -0.03, 0);
      const knee = this._joint(`knee${side}`, hip, 0, -THIGH, 0);
      this._joint(`ankle${side}`, knee, 0, -CALF, 0);
    }
  }

  _rebuildAppearance(element = 'earth', isRival = false) {
    // Limpia mallas previas del traje/cuerpo sin tocar las articulaciones ni efectos
    for (const node of this._appearanceNodes) {
      if (node.parent) node.parent.remove(node);
    }
    this._appearanceNodes.length = 0;
    this._extraMaterials.length = 0;

    this._builtElement = element;
    this._builtRival = isRival;

    const fabricMap = this.mat?.tunic?.map || createFabricWeaveTexture({ repeatX: 4, repeatY: 4, contrast: 0.085 });

    buildCharacterAppearance({
      joints: this.joints,
      M: this.mat,
      element,
      isRival,
      tracker: this._appearanceNodes,
      secondaryParts: this._secondary,
      dims: { THIGH, CALF, FOOT_H, UPPER_ARM, FOREARM },
      extraMaterials: this._extraMaterials,
      fabricMap,
    });

    for (const node of this._appearanceNodes) {
      if (node.isMesh && !node.userData.isOutline) {
        addOutline(node, this._getOutlineThickness(node), CHARACTER_OUTLINE_COLOR);
      }
    }
  }

  // ============================================================
  //  Animación procedural
  // ============================================================

  update(dt, { state, speed = 0, verticalVelocity = 0 }) {
    if (!this._isFrozen) {
      this.time += dt;
      this.currentState = state;
      this.runPhase += dt * (4 + speed * 1.15);

      const rate = state === 'dash' ? 22 : 11;
      const k = 1 - Math.exp(-rate * dt);
      let total = 0;
      for (const s of STATES) {
        const target = s === state ? 1 : 0;
        this.weights[s] += (target - this.weights[s]) * k;
        total += this.weights[s];
      }

      const out = this._poseBuffer;
      out.fill(0);
      const ctx = { t: this.time, phase: this.runPhase, speed, vy: verticalVelocity };
      for (const s of STATES) {
        const w = this.weights[s] / total;
        if (w < 0.001) continue;
        const pose = POSES[s](ctx);
        this._toArray(pose, this._tmpPose);
        for (let i = 0; i < out.length; i++) out[i] += this._tmpPose[i] * w;
      }

      const fullBodyTarget = state === 'idle' && speed < 0.6 ? 1 : 0;
      this._legBlend += (fullBodyTarget - this._legBlend) * (1 - Math.exp(-10 * dt));
      if (this.action) this._applyActionLayer(dt, out);

      this._applyPose(out);

      // Movimiento secundario: inercia y oscilación de coleta de cabello y faldones/cintas
      const curYaw = this.root.rotation.y || 0;
      let rawTurn = curYaw - this._prevRootYaw;
      if (rawTurn > Math.PI) rawTurn -= Math.PI * 2;
      if (rawTurn < -Math.PI) rawTurn += Math.PI * 2;
      this._prevRootYaw = curYaw;
      const targetTurnSwing = dt > 1e-4 ? THREE.MathUtils.clamp(-rawTurn / Math.max(dt, 0.016) * 0.045, -0.45, 0.45) : 0;
      this._turnSwing += (targetTurnSwing - this._turnSwing) * (1 - Math.exp(-10 * dt));

      const speedFactor = Math.min(1.2, speed / 9);
      const sway = Math.sin(this.time * 8.5) * 0.09 * Math.min(1, speed / 5);
      const idleBreeze = Math.sin(this.time * 2.3) * 0.035;
      const jumpLift = this.weights.jump * (-Math.sign(verticalVelocity) * 0.25 + 0.16);

      if (this._secondary.ponytail) {
        const pt = this._secondary.ponytail;
        pt.rotation.x = THREE.MathUtils.clamp(0.08 + speedFactor * 0.55 + sway + jumpLift, -0.15, 0.95);
        pt.rotation.z = this._turnSwing + Math.sin(this.time * 3.1) * 0.05;
      }

      const legSwingMax = Math.max(
        Math.abs(this.joints.hipL.rotation.x),
        Math.abs(this.joints.hipR.rotation.x)
      );
      for (const fl of this._secondary.flaps) {
        const flare = fl.baseTilt + speedFactor * 0.24 + legSwingMax * 0.26 + Math.max(0, jumpLift) * 0.6 + Math.abs(sway) * 0.5 + idleBreeze;
        if (fl.axis === 'rx') {
          fl.pivot.rotation.x = fl.sign * THREE.MathUtils.clamp(flare, 0.05, 0.95);
          fl.pivot.rotation.z = this._turnSwing * 0.5;
        } else {
          fl.pivot.rotation.z = fl.sign * THREE.MathUtils.clamp(flare, 0.06, 0.85);
          fl.pivot.rotation.x = speedFactor * 0.18 + sway * 0.6;
        }
      }

      // Estola astral flotante (ondulación constante) y aro de runas levitando
      if (this._secondary.scarves) {
        for (const sc of this._secondary.scarves) {
          const wave = Math.sin(this.time * 4.2 + sc.phase) * 0.14;
          const drift = Math.cos(this.time * 2.8 + sc.phase) * 0.08;
          sc.pivot.rotation.x = 0.24 + speedFactor * 0.42 + wave;
          sc.pivot.rotation.z = this._turnSwing * 0.7 + drift;
        }
      }
      if (this._secondary.runeHalo) {
        const rh = this._secondary.runeHalo;
        rh.group.rotation.z += dt * 1.45;
        rh.group.position.y = rh.baseY + Math.sin(this.time * 3.1) * 0.032;
      }
      if (this._secondary.prismWings && this._secondary.prismWings.length > 0) {
        for (const pw of this._secondary.prismWings) {
          pw.group.position.y = pw.baseY + Math.sin(this.time * 3.4 + pw.phase) * 0.036;
          pw.group.rotation.y += dt * 1.75;
        }
      }

      // Ondulación suave de vértices en bufandas, capas y tiras subdivididas
      if (this._secondary.clothMeshes && this._secondary.clothMeshes.length > 0) {
        for (const cm of this._secondary.clothMeshes) {
          const pos = cm.mesh?.geometry?.attributes?.position;
          const base = cm.basePos;
          if (!pos || !base) continue;
          const amp = (0.008 + speedFactor * 0.018) * (cm.amp || 1);
          const freq = 5.4 + speedFactor * 3.2;
          for (let i = 0; i < pos.count; i++) {
            const idx = i * 3;
            const bx = base[idx];
            const by = base[idx + 1];
            const bz = base[idx + 2];
            // u = 0 en el anclaje superior, 1 en el extremo inferior libre
            const u = THREE.MathUtils.clamp(-by / Math.max(0.08, cm.length || 0.35), 0, 1);
            if (u <= 0.05) continue;
            const ripple = Math.sin(this.time * freq - u * 5.2 + cm.phase) * amp * Math.pow(u, 1.25);
            const sideFlutter = Math.cos(this.time * (freq * 0.7) - u * 3.6 + cm.phase) * amp * 0.45 * u;
            pos.setXYZ(i, bx + sideFlutter, by, bz + ripple);
          }
          pos.needsUpdate = true;
          cm.mesh.geometry.computeVertexNormals();
        }
      }
    }

    // Animación viva de las llamas adheridas cuando el luchador está quemándose
    if (this._isBurning) {
      const flickerT = this.time * 18;
      for (const bf of this._burnFlames) {
        const s = 0.85 + 0.32 * Math.sin(flickerT + bf.phase * 2.1);
        const w = 0.92 + 0.16 * Math.cos(flickerT * 0.8 + bf.phase);
        bf.group.scale.set(w, s, w);
        bf.group.rotation.z = Math.sin(flickerT * 0.5 + bf.phase) * 0.14;
      }
    }

    // Pulso orgánico de las lianas enredadas en las piernas
    if (this._isRooted && this._rootGroup) {
      const grow = 0.98 + 0.04 * Math.sin(this.time * 6.5);
      this._rootGroup.scale.set(grow, 1.0, grow);
    }

    // Burbujas / esporas verde esmeralda ascendentes sobre el personaje
    if (this._isPoisoned && this._poisonGroup) {
      for (const sp of this._poisonSpores) {
        const yCycle = ((this.time * sp.speed + sp.yOffset) % 1.65);
        const ang = sp.phase + this.time * 1.9;
        sp.mesh.position.set(
          Math.cos(ang) * sp.radius,
          0.38 + yCycle,
          Math.sin(ang) * sp.radius
        );
        const s = 0.65 + 0.45 * Math.sin((yCycle / 1.65) * Math.PI);
        sp.mesh.scale.setScalar(s);
        sp.mesh.rotation.y += dt * 3.5;
      }
    }

    // Espiral hipnótica magenta girando sobre la cabeza (Confusión)
    if (this._isConfused && this._confusedGroup) {
      this._confusedGroup.rotation.y += dt * 5.6;
      const pulse = 0.94 + 0.1 * Math.sin(this.time * 9);
      this._confusedGroup.scale.setScalar(pulse);
    }

    // Estrellitas solares de aturdimiento/ceguera girando sobre la cabeza
    if (this._isStunned && this._stunGroup) {
      this._stunGroup.rotation.y -= dt * 6.5;
    }

    // Rocas orbitales flotantes (cargas de Disco Roca) y prisión tectónica
    if (this._earthOrbitCount > 0 && this._earthOrbitData) {
      this._earthOrbitData.update(dt, this.time);
    }
    if (this._isEarthTrapped && this._earthTrapData && this._earthTrapData.group) {
      const sY = THREE.MathUtils.lerp(this._earthTrapData.group.scale.y, 1.0, Math.min(1, dt * 16));
      this._earthTrapData.group.scale.set(1, sY, 1);
    }

    // Nubes vaporosas y arcos eléctricos chispeantes en Forma de Niebla
    if (this._isMistForm && this._mistData) {
      this._mistGroup.rotation.y += dt * 2.4;
      this._mistGroup.position.y = 0.92 + Math.sin(this.time * 4.5) * 0.08;
      for (const pf of this._mistData.cluster.puffs) {
        pf.mesh.position.y = pf.baseY + Math.sin(this.time * 5.2 + pf.phase) * 0.09;
        pf.mesh.rotation.y += dt * 1.8;
      }
      const flick = Math.sin(this.time * 38) > -0.2 ? 0.92 : 0.25;
      this._mistData.arcMat.opacity = flick;
      this._mistData.arcs[0].rotation.z += dt * 5.2;
      this._mistData.arcs[1].rotation.x -= dt * 4.8;
    }

    // Volutas oscuras flotando en estado de camuflaje (Velo de Eclipse / Paso Sombrío)
    if (this._isShadowVeil && this._shadowVeilGroup) {
      this._shadowVeilGroup.rotation.y -= dt * 2.1;
      for (const sp of this._shadowVeilPuffs) {
        sp.mesh.position.y = sp.baseY + Math.sin(this.time * 4.2 + sp.phase) * 0.14;
        const sc = 0.82 + 0.28 * Math.sin(this.time * 5.5 + sp.phase);
        sp.mesh.scale.setScalar(sc);
      }
    }

    // Pulso luminoso del aro de equipo (2v2)
    if (this._teamRing && this._teamRing.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.5);
      const s = 0.96 + pulse * 0.08;
      this._teamRing.scale.set(s, 1, s);
      this._teamRingOuterMat.opacity = 0.72 + pulse * 0.22;
      this._teamRingInnerMat.opacity = 0.24 + pulse * 0.18;
    }

    // Animación del Aura Elemental (Supervivencia Tecla R)
    if (this._auraActive && this._auraGroup) {
      this._updateElementalAura(dt);
    }

    // Destello de impacto, reaparición, congelamiento o quemadura
    const allMats = this.materials.concat(this._extraMaterials);
    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - dt * 4.5);
      const t = this._hitFlash;
      const intensity = t * 3.2;
      for (const m of allMats) {
        m.emissive.setRGB(1.0, 0.2 + 0.75 * t, 0.15 + 0.75 * t);
        m.emissiveIntensity = intensity;
      }
    } else if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 1.6);
      const intensity = this._flash * this._flash * 2.5;
      for (const m of allMats) {
        m.emissive.set(this._flashColor || '#ffcf80');
        m.emissiveIntensity = intensity;
      }
    } else if (this._isFrozen) {
      for (const m of allMats) {
        m.emissive.set('#4de2ff');
        m.emissiveIntensity = 0.48;
      }
    } else if (this._isBurning) {
      for (const m of allMats) {
        m.emissive.set('#ff6a00');
        m.emissiveIntensity = 0.2 + 0.1 * Math.sin(this.time * 16);
      }
    } else if (this._isPoisoned) {
      for (const m of allMats) {
        m.emissive.set('#22c55e');
        m.emissiveIntensity = 0.16 + 0.08 * Math.sin(this.time * 10);
      }
    } else if (this._isConfused) {
      for (const m of allMats) {
        m.emissive.set('#d946ef');
        m.emissiveIntensity = 0.15 + 0.09 * Math.sin(this.time * 12);
      }
    } else if (this._isMistForm) {
      for (const m of allMats) {
        m.emissive.set('#38bdf8');
        m.emissiveIntensity = 0.26 + 0.12 * Math.sin(this.time * 10);
      }
    } else if (this._isShadowVeil) {
      for (const m of allMats) {
        m.emissive.set('#6d28d9');
        m.emissiveIntensity = 0.24 + 0.12 * Math.sin(this.time * 8);
      }
    } else {
      for (const m of this._extraMaterials) {
        if (m.emissiveIntensity !== 0) m.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Activa o desactiva el Aura Elemental visual en estilo Cel-Shaded alrededor
   * del luchador (exclusiva del Modo Supervivencia, Tecla R).
   * @param {'fire'|'earth'|'water'|'air'} element
   * @param {boolean} active
   * @param {number} [radiusScale=1]
   */
  setElementalAura(element, active, radiusScale = 1) {
    this._auraActive = !!active;
    this._auraRadiusScale = Math.max(0.5, radiusScale || 1);

    if (!this._auraActive) {
      if (this._auraGroup) this._auraGroup.visible = false;
      return;
    }

    if (!this._auraGroup || this._auraElement !== element) {
      this._rebuildElementalAura(element);
    }
    this._auraGroup.visible = true;
    this._auraGroup.scale.set(this._auraRadiusScale, 1, this._auraRadiusScale);
  }

  _clearElementalAura() {
    if (this._auraGroup && this._auraGroup.parent) {
      this._auraGroup.parent.remove(this._auraGroup);
    }
    for (const d of this._auraDisposables) {
      if (d && d.dispose) d.dispose();
    }
    this._auraDisposables.length = 0;
    this._auraParts.length = 0;
    this._auraSpinGroup = null;
    this._auraGroup = null;
    this._auraElement = null;
  }

  _rebuildElementalAura(element) {
    this._clearElementalAura();
    this._auraElement = element;
    const group = new THREE.Group();
    group.name = `ElementalAura_${element}`;

    const spinGroup = new THREE.Group();
    group.add(spinGroup);
    this._auraSpinGroup = spinGroup;

    const ringColorMap = {
      fire: FIRE_PALETTE.mid,
      earth: ROCK_PALETTE.accent || '#e0a94f',
      water: WATER_PALETTE.turquoise,
      air: AIR_PALETTE.turquoise,
      nature: NATURE_PALETTE.spore,
      psychic: PSYCHIC_PALETTE.magenta,
      storm: STORM_PALETTE.electricBlue,
      light: LIGHT_PALETTE.solarGold,
      shadow: SHADOW_PALETTE.crimsonNeon,
    };

    const ringGeo = new THREE.RingGeometry(1.75, 2.08, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = createEnergyVFXMaterial({
      coreColor: ringColorMap[element] || '#ffd166',
      rimColor: '#ffffff',
      opacity: 0.65,
      additive: true,
      softEdge: true,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.07;
    ringMesh.userData.noOutline = true;
    group.add(ringMesh);
    this._auraDisposables.push(ringGeo, ringMat);
    this._auraParts.push({ kind: 'ring', mesh: ringMesh, mat: ringMat });

    if (element === 'fire') {
      const count = 8;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const flame = createLayeredFlame(0.24, 0.98, i * 1.9 + 0.5, 0.16);
        flame.group.position.set(Math.cos(ang) * 1.95, 0.08, Math.sin(ang) * 1.95);
        flame.group.rotation.y = -ang;
        spinGroup.add(flame.group);
        this._auraDisposables.push(flame);
        this._auraParts.push({ kind: 'flame', obj: flame.group, flame, phase: i * 0.85, baseY: 0.08 });
      }
    } else if (element === 'earth') {
      const rockMat = createToonMaterial(ROCK_PALETTE.mid, {
        flatShading: true,
        emissive: '#d98c2b',
        emissiveIntensity: 0.22,
      });
      this._auraDisposables.push(rockMat);
      const count = 5;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const slabGeo = createStoneSlab(0.46, 0.76, 0.2, i * 17 + 3, 0.2);
        const slab = new THREE.Mesh(slabGeo, rockMat);
        slab.position.set(Math.cos(ang) * 1.48, 0.72, Math.sin(ang) * 1.48);
        slab.rotation.y = -ang + Math.PI * 0.5;
        slab.rotation.z = 0.14;
        addOutline(slab, 0.014, CHARACTER_OUTLINE_COLOR);
        spinGroup.add(slab);
        this._auraDisposables.push(slabGeo);
        this._auraParts.push({ kind: 'rock', obj: slab, phase: i * 1.25, baseY: 0.72 });
      }
    } else if (element === 'water') {
      const waterMat = createEnergyVFXMaterial({
        coreColor: WATER_PALETTE.turquoise,
        rimColor: WATER_PALETTE.foam,
        opacity: 0.78,
        fresnelPower: 1.7,
        rimIntensity: 1.25,
        fadeEnds: true,
        depthWrite: false,
      });
      const dropMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: '#38d6ff',
        opacity: 0.88,
        fresnelPower: 1.5,
        depthWrite: false,
      });
      const dropGeo = new THREE.SphereGeometry(0.16, 14, 12);
      dropGeo.scale(0.85, 1.32, 0.85);
      this._auraDisposables.push(waterMat, dropMat, dropGeo);

      for (let i = 0; i < 2; i++) {
        const ribGeo = createWindRibbonTube(1.48, 1.24, 1.8, 1.35, 28, 0.055);
        const rib = new THREE.Mesh(ribGeo, waterMat);
        rib.rotation.x = -Math.PI * 0.5;
        rib.rotation.z = i * Math.PI;
        rib.position.y = 0.25;
        rib.userData.noOutline = true;
        spinGroup.add(rib);
        this._auraDisposables.push(ribGeo);
      }
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const drop = new THREE.Mesh(dropGeo, dropMat);
        drop.position.set(Math.cos(ang) * 1.65, 0.95, Math.sin(ang) * 1.65);
        drop.userData.noOutline = true;
        spinGroup.add(drop);
        this._auraParts.push({ kind: 'drop', obj: drop, phase: i * 1.5, baseY: 0.95 });
      }
    } else if (element === 'nature') {
      const vineMat = createToonMaterial(NATURE_PALETTE.deepForest, {
        emissive: '#2d6a4f',
        emissiveIntensity: 0.35,
      });
      const leafMat = createToonMaterial(NATURE_PALETTE.emerald, {
        emissive: '#22c55e',
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
      });
      const sporeMat = createEnergyVFXMaterial({
        coreColor: '#f0fdf4',
        rimColor: NATURE_PALETTE.spore,
        opacity: 0.9,
        additive: true,
        softEdge: true,
        depthWrite: false,
      });

      // Liana orgánica entrelazada continua alrededor del luchador (grosor decreciente + contorno)
      const vinePts = [];
      for (let i = 0; i <= 18; i++) {
        const s = i / 18;
        const a = s * Math.PI * 2;
        const r = 1.72 + Math.sin(a * 3) * 0.14;
        vinePts.push(new THREE.Vector3(Math.cos(a) * r, 0.38 + Math.sin(a * 4) * 0.12, Math.sin(a) * r));
      }
      const vineCurve = new THREE.CatmullRomCurve3(vinePts);
      const vineRingGeo = createOrganicVineTubeGeometry(vineCurve, 34, 0.068, 0.018, 7);
      const vineRing = new THREE.Mesh(vineRingGeo, vineMat);
      addOutline(vineRing, 0.011, 0x132218);
      spinGroup.add(vineRing);

      const leafGeo = createLeafBladeGeometry(0.62, 0.28, 0.036);
      const sporeGeo = new THREE.SphereGeometry(0.085, 10, 8);
      this._auraDisposables.push(vineMat, leafMat, sporeMat, vineRingGeo, leafGeo, sporeGeo);

      const leafCount = 8;
      for (let i = 0; i < leafCount; i++) {
        const ang = (i / leafCount) * Math.PI * 2;
        const leaf = new THREE.Mesh(leafGeo, i % 2 === 0 ? leafMat : vineMat);
        leaf.position.set(Math.cos(ang) * 1.88, 0.55 + (i % 2) * 0.32, Math.sin(ang) * 1.88);
        leaf.rotation.set(0.25, -ang + Math.PI * 0.2, 0.35);
        addOutline(leaf, 0.01, 0x132218);
        spinGroup.add(leaf);
        this._auraParts.push({ kind: 'drop', obj: leaf, phase: i * 0.9, baseY: leaf.position.y });
      }
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.3;
        const sp = new THREE.Mesh(sporeGeo, sporeMat);
        sp.position.set(Math.cos(ang) * 1.62, 1.02 + (i % 2) * 0.25, Math.sin(ang) * 1.62);
        sp.userData.noOutline = true;
        spinGroup.add(sp);
        this._auraParts.push({ kind: 'drop', obj: sp, phase: i * 1.15, baseY: sp.position.y });
      }
    } else if (element === 'psychic') {
      const psyRingMat = createEnergyVFXMaterial({
        coreColor: PSYCHIC_PALETTE.magenta,
        rimColor: PSYCHIC_PALETTE.lavender,
        opacity: 0.78,
        additive: true,
        depthWrite: false,
      });
      const runeMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: PSYCHIC_PALETTE.magenta,
        opacity: 0.92,
        additive: true,
        depthWrite: false,
      });
      const ringGeoA = new THREE.TorusGeometry(1.85, 0.044, 10, 42);
      ringGeoA.rotateX(Math.PI * 0.5);
      const ringA = new THREE.Mesh(ringGeoA, psyRingMat);
      ringA.position.y = 0.44;
      ringA.rotation.z = 0.16;
      ringA.userData.noOutline = true;
      spinGroup.add(ringA);

      const runeHalo = createRuneHaloGroup(1.55, 8, 1.35);
      runeHalo.group.rotation.x = Math.PI * 0.5;
      runeHalo.group.position.y = 0.92;
      spinGroup.add(runeHalo.group);
      this._auraDisposables.push(psyRingMat, runeMat, ringGeoA, runeHalo);

      const prismGeo = new THREE.SphereGeometry(0.11, 12, 10);
      prismGeo.scale(0.65, 1.55, 0.65);
      this._auraDisposables.push(prismGeo);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const prism = new THREE.Mesh(prismGeo, i % 2 === 0 ? runeMat : psyRingMat);
        prism.position.set(Math.cos(ang) * 1.92, 0.85, Math.sin(ang) * 1.92);
        prism.userData.noOutline = true;
        spinGroup.add(prism);
        this._auraParts.push({ kind: 'drop', obj: prism, phase: i * 1.05, baseY: 0.85 });
      }
    } else if (element === 'storm') {
      const stormRingMat = createEnergyVFXMaterial({
        coreColor: '#bae6fd',
        rimColor: STORM_PALETTE.electricBlue,
        opacity: 0.78,
        additive: true,
        depthWrite: false,
      });
      const boltMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: STORM_PALETTE.boltGold,
        opacity: 0.95,
        additive: true,
        depthWrite: false,
      });
      const mistMat = createEnergyVFXMaterial({
        coreColor: STORM_PALETTE.mistSilver,
        rimColor: STORM_PALETTE.electricBlue,
        opacity: 0.34,
        softEdge: true,
        depthWrite: false,
      });

      const stormRingGeo = new THREE.TorusGeometry(1.9, 0.042, 10, 42);
      stormRingGeo.rotateX(Math.PI * 0.5);
      const stormRing = new THREE.Mesh(stormRingGeo, stormRingMat);
      stormRing.position.y = 0.34;
      stormRing.userData.noOutline = true;
      spinGroup.add(stormRing);

      const arcGeo = createZigzagBoltGeometry(
        new THREE.Vector3(1.85, 0.25, 0),
        new THREE.Vector3(1.55, 1.45, 0.65),
        { segments: 5, radius: 0.032, jitter: 0.14, seed: 5.3 }
      );
      const sparkGeo = new THREE.SphereGeometry(0.11, 10, 8);
      sparkGeo.scale(0.55, 1.8, 0.55);
      const puffGeo = new THREE.SphereGeometry(0.32, 14, 10);
      this._auraDisposables.push(stormRingMat, boltMat, mistMat, stormRingGeo, arcGeo, sparkGeo, puffGeo);

      for (let i = 0; i < 3; i++) {
        const arc = new THREE.Mesh(arcGeo, boltMat);
        arc.rotation.y = (i / 3) * Math.PI * 2;
        arc.userData.noOutline = true;
        spinGroup.add(arc);
      }
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const r = i % 2 === 0 ? 1.94 : 1.62;
        const spark = new THREE.Mesh(sparkGeo, i % 2 === 0 ? boltMat : stormRingMat);
        spark.position.set(Math.cos(ang) * r, 0.72 + (i % 2) * 0.28, Math.sin(ang) * r);
        spark.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.3;
        spark.userData.noOutline = true;
        spinGroup.add(spark);
        this._auraParts.push({ kind: 'drop', obj: spark, phase: i * 1.1, baseY: spark.position.y });
      }
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + 0.4;
        const puff = new THREE.Mesh(puffGeo, mistMat);
        puff.position.set(Math.cos(ang) * 1.52, 0.28, Math.sin(ang) * 1.52);
        puff.scale.set(1.35, 0.65, 1.35);
        puff.userData.noOutline = true;
        spinGroup.add(puff);
      }
    } else if (element === 'light') {
      const solarRingMat = createEnergyVFXMaterial({
        coreColor: LIGHT_PALETTE.ivory,
        rimColor: LIGHT_PALETTE.solarGold,
        opacity: 0.86,
        additive: true,
        depthWrite: false,
      });
      const prismCyanMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: LIGHT_PALETTE.cyan,
        opacity: 0.82,
        additive: true,
        depthWrite: false,
      });
      const solarRingGeo = new THREE.TorusGeometry(1.9, 0.038, 10, 44);
      solarRingGeo.rotateX(Math.PI * 0.5);
      const solarRing = new THREE.Mesh(solarRingGeo, solarRingMat);
      solarRing.position.y = 0.48;
      solarRing.rotation.z = 0.14;
      solarRing.userData.noOutline = true;
      spinGroup.add(solarRing);

      const haloRingGeo = new THREE.TorusGeometry(1.52, 0.028, 10, 40);
      haloRingGeo.rotateX(Math.PI * 0.5);
      const haloRing = new THREE.Mesh(haloRingGeo, prismCyanMat);
      haloRing.position.y = 1.15;
      haloRing.rotation.x = -0.18;
      haloRing.userData.noOutline = true;
      spinGroup.add(haloRing);

      const orbGeo = new THREE.SphereGeometry(0.085, 12, 10);
      this._auraDisposables.push(solarRingMat, prismCyanMat, solarRingGeo, haloRingGeo, orbGeo);

      // 4 micro-prismas cristalinos orbitales
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const prismRig = createRefractionPrismGroup(0.45, false);
        prismRig.group.position.set(Math.cos(ang) * 1.82, 0.92, Math.sin(ang) * 1.82);
        spinGroup.add(prismRig.group);
        this._auraDisposables.push(prismRig);
        this._auraParts.push({ kind: 'drop', obj: prismRig.group, phase: i * 1.35, baseY: 0.92 });
      }
      // 4 esferas luminosas adicionales intercaladas
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        const orb = new THREE.Mesh(orbGeo, i % 2 === 0 ? solarRingMat : prismCyanMat);
        orb.position.set(Math.cos(ang) * 1.56, 0.68, Math.sin(ang) * 1.56);
        orb.userData.noOutline = true;
        spinGroup.add(orb);
        this._auraParts.push({ kind: 'drop', obj: orb, phase: i * 1.6 + 0.5, baseY: 0.68 });
      }
    } else if (element === 'shadow') {
      const shadowMistMat = createEnergyVFXMaterial({
        coreColor: SHADOW_PALETTE.obsidian,
        rimColor: SHADOW_PALETTE.abyssViolet,
        opacity: 0.72,
        softEdge: true,
        depthWrite: false,
      });
      const scytheMat = createEnergyVFXMaterial({
        coreColor: SHADOW_PALETTE.abyssViolet,
        rimColor: SHADOW_PALETTE.crimsonNeon,
        opacity: 0.92,
        fresnelPower: 1.45,
        rimIntensity: 1.4,
        additive: true,
        depthWrite: false,
      });
      const soulMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: SHADOW_PALETTE.crimsonNeon,
        opacity: 0.9,
        additive: true,
        softEdge: true,
        depthWrite: false,
      });

      const mistRingGeo = new THREE.TorusGeometry(1.88, 0.048, 10, 44);
      mistRingGeo.rotateX(Math.PI * 0.5);
      const mistRing = new THREE.Mesh(mistRingGeo, scytheMat);
      mistRing.position.y = 0.34;
      mistRing.userData.noOutline = true;
      spinGroup.add(mistRing);

      const scytheGeo = createShadowScytheGeo(0.58, 0.14);
      const puffGeo = new THREE.SphereGeometry(0.28, 12, 10);
      const soulGeo = new THREE.SphereGeometry(0.095, 10, 8);
      this._auraDisposables.push(shadowMistMat, scytheMat, soulMat, mistRingGeo, scytheGeo, puffGeo, soulGeo);

      // 4 guadañas orbitales de sombra (sin borde negro)
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const scythe = new THREE.Mesh(scytheGeo, scytheMat);
        scythe.position.set(Math.cos(ang) * 1.9, 0.88, Math.sin(ang) * 1.9);
        scythe.rotation.set(Math.PI * 0.42, -ang + Math.PI * 0.5, 0.2);
        scythe.userData.noOutline = true;
        spinGroup.add(scythe);
        this._auraParts.push({ kind: 'drop', obj: scythe, phase: i * 1.3, baseY: 0.88 });
      }
      // Volutas de bruma oscura a ras del suelo + 4 orbes carmesí
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.35;
        const puff = new THREE.Mesh(puffGeo, shadowMistMat);
        puff.position.set(Math.cos(ang) * 1.62, 0.3, Math.sin(ang) * 1.62);
        puff.scale.set(1.3, 0.62, 1.3);
        puff.userData.noOutline = true;
        spinGroup.add(puff);
      }
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        const soul = new THREE.Mesh(soulGeo, soulMat);
        soul.position.set(Math.cos(ang) * 1.54, 0.72, Math.sin(ang) * 1.54);
        soul.userData.noOutline = true;
        spinGroup.add(soul);
        this._auraParts.push({ kind: 'drop', obj: soul, phase: i * 1.5 + 0.6, baseY: 0.72 });
      }
    } else {
      const windMat = createEnergyVFXMaterial({
        coreColor: '#ffffff',
        rimColor: AIR_PALETTE.turquoise,
        opacity: 0.72,
        fresnelPower: 1.55,
        fadeEnds: true,
        depthWrite: false,
      });
      const haloMat = createEnergyVFXMaterial({
        coreColor: '#f7fcff',
        rimColor: '#8cf0ff',
        opacity: 0.56,
        softEdge: true,
        additive: true,
        depthWrite: false,
      });
      this._auraDisposables.push(windMat, haloMat);
      for (let i = 0; i < 3; i++) {
        const ribGeo = createWindRibbonTube(1.25, 1.68, 2.05, 1.6, 28, 0.052);
        const rib = new THREE.Mesh(ribGeo, windMat);
        rib.rotation.x = -Math.PI * 0.5;
        rib.rotation.z = (i / 3) * Math.PI * 2;
        rib.position.y = 0.2;
        rib.userData.noOutline = true;
        spinGroup.add(rib);
        this._auraDisposables.push(ribGeo);
      }
      const haloGeo = new THREE.TorusGeometry(1.55, 0.045, 10, 36);
      haloGeo.rotateX(Math.PI * 0.5);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.y = 1.25;
      halo.userData.noOutline = true;
      group.add(halo);
      this._auraDisposables.push(haloGeo);
      this._auraParts.push({ kind: 'halo', obj: halo, baseY: 1.25 });
    }

    this.root.add(group);
    this._auraGroup = group;
  }

  _updateElementalAura(dt) {
    const t = this.time;
    if (this._auraSpinGroup) {
      const spinSpeed =
        this._auraElement === 'air'
          ? 5.2
          : this._auraElement === 'storm'
            ? 4.8
            : this._auraElement === 'light'
              ? 4.4
              : this._auraElement === 'shadow'
                ? -4.5
                : this._auraElement === 'psychic'
              ? -4.2
              : this._auraElement === 'water'
                ? -3.4
                : this._auraElement === 'nature'
                  ? 3.1
                  : this._auraElement === 'fire'
                    ? 2.6
                    : 1.7;
      this._auraSpinGroup.rotation.y += dt * spinSpeed;
    }
    for (const p of this._auraParts) {
      if (p.kind === 'ring') {
        const s = 0.96 + Math.sin(t * 7) * 0.05;
        p.mesh.scale.set(s, 1, s);
        p.mat.opacity = 0.55 + 0.25 * Math.sin(t * 8);
      } else if (p.kind === 'flame') {
        const sy = 0.85 + 0.32 * Math.sin(t * 14 + p.phase);
        p.obj.scale.set(1, sy, 1);
        if (p.flame && p.flame.update) p.flame.update(t, p.phase);
      } else if (p.kind === 'rock') {
        p.obj.position.y = p.baseY + Math.sin(t * 3.8 + p.phase) * 0.14;
        p.obj.rotation.x = Math.sin(t * 2.2 + p.phase) * 0.12;
      } else if (p.kind === 'drop') {
        p.obj.position.y = p.baseY + Math.sin(t * 4.8 + p.phase) * 0.22;
        p.obj.rotation.y += dt * 3;
      } else if (p.kind === 'halo') {
        p.obj.position.y = p.baseY + Math.sin(t * 5.2) * 0.18;
        const hs = 0.94 + Math.cos(t * 6) * 0.07;
        p.obj.scale.set(hs, 1, hs);
      }
    }
  }

  flash(color = '#ffcf80') {
    this._flashColor = color;
    this._flash = 1;
  }

  flashHit() {
    this._hitFlash = 1;
  }

  _applyActionLayer(dt, out) {
    const a = this.action;
    a.time += dt;
    const u = a.time / a.duration;
    if (u >= 1) {
      this.action = null;
      return;
    }
    const fadeIn = Math.min(1, a.time / (a.def.fadeIn ?? 0.06));
    const fadeOut = Math.min(1, (1 - u) / (a.def.fadeOut ?? 0.3));
    const w = smoothstep(Math.min(fadeIn, fadeOut));

    sampleAction(a.def, u, this._actionPose);
    const act = this._actionPose;
    for (let i = 0; i < out.length; i++) {
      const v = act[i];
      if (Number.isNaN(v)) continue;
      const wi = UPPER_MASK[i] ? w : w * this._legBlend;
      out[i] += (v - out[i]) * wi;
    }
  }

  _toArray(pose, arr) {
    for (let i = 0; i < CHANNEL_KEYS.length; i++) arr[i] = pose[CHANNEL_KEYS[i]] || 0;
  }

  _applyPose(arr) {
    for (let i = 0; i < CHANNELS.length; i++) {
      const [jointName, prop] = CHANNELS[i];
      const j = this.joints[jointName];
      const v = arr[i];
      switch (prop) {
        case 'rx': j.rotation.x = v; break;
        case 'ry': j.rotation.y = v; break;
        case 'rz': j.rotation.z = v; break;
        case 'py': j.position.y = HIP_HEIGHT + v; break;
      }
    }
  }
}

// ==================================================================
//  Definición de poses procedurales
// ==================================================================

function footFlat(hipRx, kneeRx) {
  return -(hipRx + kneeRx);
}

const POSES = {
  /**
   * Guardia marcial (postura del Maestro Tierra): piernas abiertas y
   * escalonadas, rodillas flexionadas, puño adelantado, respiración.
   */
  idle({ t }) {
    const breath = Math.sin(t * 2.1);
    const sway = Math.sin(t * 1.05);
    const hipLx = -0.5;
    const kneeL = 0.68;
    const hipRx = 0.18;
    const kneeR = 0.52;
    return {
      'hips.py': -0.095 + breath * 0.006,
      'hips.ry': 0.32 + sway * 0.02,
      'spine.rx': 0.06,
      'spine.ry': -0.12,
      'chest.rx': 0.04 + breath * 0.025,
      'chest.ry': -0.18 + sway * 0.015,
      'head.rx': -0.08 - breath * 0.015,
      'head.ry': -0.02,
      // Brazo adelantado (izquierdo) en guardia
      'shoulderL.rx': -1.05 + breath * 0.03,
      'shoulderL.ry': 0.1,
      'shoulderL.rz': 0.26,
      'elbowL.rx': -1.15,
      'wristL.rx': 0.1,
      // Brazo trasero (derecho) cubriendo el mentón
      'shoulderR.rx': -0.55 + breath * 0.03,
      'shoulderR.ry': 0.15,
      'shoulderR.rz': -0.36,
      'elbowR.rx': -1.95,
      'wristR.rx': 0.15,
      // Piernas: izquierda adelante, derecha atrás
      'hipL.rx': hipLx,
      'hipL.rz': 0.17,
      'hipL.ry': 0.15,
      'kneeL.rx': kneeL,
      'ankleL.rx': footFlat(hipLx, kneeL),
      'ankleL.rz': -0.17,
      'hipR.rx': hipRx,
      'hipR.rz': -0.2,
      'hipR.ry': -0.3,
      'kneeR.rx': kneeR,
      'ankleR.rx': footFlat(hipRx, kneeR),
      'ankleR.rz': 0.2,
    };
  },

  /** Carrera atlética inclinada hacia adelante con braceo opuesto */
  run({ phase, speed }) {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const intensity = Math.min(1, speed / 7);
    const stride = 0.55 + 0.4 * intensity;
    const hipLx = -s * stride - 0.12;
    const hipRx = s * stride - 0.12;
    const kneeL = 0.3 + Math.max(0, c) * 1.45 * intensity;
    const kneeR = 0.3 + Math.max(0, -c) * 1.45 * intensity;
    return {
      'hips.py': -0.05 + Math.abs(s) * 0.07 * intensity,
      'hips.rx': 0.08,
      'hips.ry': s * 0.14,
      'spine.rx': 0.22 + 0.15 * intensity,
      'chest.ry': -s * 0.26,
      'chest.rx': 0.04,
      'head.rx': -0.25 * intensity,
      'head.ry': s * 0.1,
      'shoulderL.rx': s * 0.95 * intensity,
      'shoulderL.rz': 0.16,
      'elbowL.rx': -1.45,
      'shoulderR.rx': -s * 0.95 * intensity,
      'shoulderR.rz': -0.16,
      'elbowR.rx': -1.45,
      'hipL.rx': hipLx,
      'hipL.rz': 0.04,
      'kneeL.rx': kneeL,
      'ankleL.rx': -0.15 + Math.max(0, -s) * 0.35,
      'hipR.rx': hipRx,
      'hipR.rz': -0.04,
      'kneeR.rx': kneeR,
      'ankleR.rx': -0.15 + Math.max(0, s) * 0.35,
    };
  },

  /** Pose aérea */
  jump({ vy, t }) {
    const fall = THREE.MathUtils.clamp(-vy / 9, 0, 1);
    const mix = (a, b) => a + (b - a) * fall;
    const flutter = Math.sin(t * 10) * 0.03;
    return {
      'hips.py': mix(0.05, -0.02),
      'hips.rx': mix(-0.08, 0.02),
      'spine.rx': mix(0.18, 0.08),
      'chest.rx': 0.05,
      'head.rx': mix(-0.15, 0.1),
      'shoulderL.rx': mix(-0.7, -0.35),
      'shoulderL.rz': mix(0.85, 1.1) + flutter,
      'elbowL.rx': mix(-0.9, -0.5),
      'shoulderR.rx': mix(-0.25, -0.35),
      'shoulderR.rz': mix(-1.0, -1.1) - flutter,
      'elbowR.rx': mix(-0.6, -0.5),
      'hipL.rx': mix(-1.15, -0.55),
      'hipL.rz': 0.08,
      'kneeL.rx': mix(1.65, 0.75),
      'ankleL.rx': mix(0.3, -0.1),
      'hipR.rx': mix(-0.25, 0.05),
      'hipR.rz': -0.08,
      'kneeR.rx': mix(1.25, 0.55),
      'ankleR.rx': mix(0.4, 0.0),
    };
  },

  /** Impulso rasante */
  dash() {
    return {
      'hips.py': -0.22,
      'hips.rx': 0.22,
      'spine.rx': 0.62,
      'chest.rx': 0.12,
      'head.rx': -0.6,
      'shoulderL.rx': 1.15,
      'shoulderL.rz': 0.35,
      'elbowL.rx': -0.25,
      'wristL.rx': 0.3,
      'shoulderR.rx': 1.15,
      'shoulderR.rz': -0.35,
      'elbowR.rx': -0.25,
      'wristR.rx': 0.3,
      'hipL.rx': -1.25,
      'hipL.rz': 0.1,
      'kneeL.rx': 1.55,
      'ankleL.rx': -0.1,
      'hipR.rx': 0.55,
      'hipR.rz': -0.06,
      'kneeR.rx': 0.35,
      'ankleR.rx': 0.45,
    };
  },
};

// ==================================================================
//  Acciones marciales (Hung Gar)
// ==================================================================

const UPPER_JOINTS = new Set([
  'spine', 'chest', 'head',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR',
]);
const UPPER_MASK = CHANNELS.map(([j]) => UPPER_JOINTS.has(j));

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

const EASES = {
  linear: (x) => x,
  smooth: smoothstep,
  out: (x) => 1 - (1 - x) * (1 - x) * (1 - x),
  in: (x) => x * x * x,
};

function mirrorPose(pose) {
  const out = {};
  for (const [key, value] of Object.entries(pose)) {
    const [joint, prop] = key.split('.');
    let mj = joint;
    if (/L$/.test(joint)) mj = joint.slice(0, -1) + 'R';
    else if (/R$/.test(joint)) mj = joint.slice(0, -1) + 'L';
    out[`${mj}.${prop}`] = prop === 'ry' || prop === 'rz' ? -value : value;
  }
  return out;
}

function mirrorAction(def) {
  return { ...def, keys: def.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })) };
}

function compileAction(def) {
  const arrays = def.keys.map((k) => {
    const arr = new Float32Array(CHANNELS.length).fill(NaN);
    CHANNEL_KEYS.forEach((key, i) => {
      if (key in k.pose) arr[i] = k.pose[key];
    });
    return arr;
  });
  for (let i = 0; i < CHANNELS.length; i++) {
    const firstDefined = arrays.findIndex((a) => !Number.isNaN(a[i]));
    if (firstDefined < 0) continue;
    for (let k = 0; k < arrays.length; k++) {
      if (!Number.isNaN(arrays[k][i])) continue;
      arrays[k][i] = k < firstDefined ? arrays[firstDefined][i] : arrays[k - 1][i];
    }
  }
  def._arrays = arrays;
  return def;
}

function sampleAction(def, u, out) {
  const keys = def.keys;
  const arrays = def._arrays;
  if (u <= keys[0].t) return out.set(arrays[0]);
  const last = keys.length - 1;
  if (u >= keys[last].t) return out.set(arrays[last]);
  let k = 0;
  while (k < last - 1 && u >= keys[k + 1].t) k++;
  const span = keys[k + 1].t - keys[k].t;
  const ease = EASES[keys[k + 1].ease || 'smooth'];
  const f = ease(span > 0 ? (u - keys[k].t) / span : 1);
  const a = arrays[k];
  const b = arrays[k + 1];
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * f;
  return out;
}

const ff = footFlat;

const PUNCH_RIGHT = {
  duration: 0.34,
  fadeIn: 0.04,
  fadeOut: 0.35,
  keys: [
    {
      t: 0,
      pose: {
        'hips.ry': -0.15,
        'spine.ry': -0.1,
        'chest.ry': -0.3,
        'chest.rx': 0.05,
        'head.ry': 0.2,
        'shoulderR.rx': -0.55, 'shoulderR.ry': 0.1, 'shoulderR.rz': -0.4, 'elbowR.rx': -2.05, 'wristR.rx': 0.1,
        'shoulderL.rx': -1.1, 'shoulderL.ry': 0, 'shoulderL.rz': 0.25, 'elbowL.rx': -1.2, 'wristL.rx': 0,
      },
    },
    {
      t: 0.3,
      ease: 'out',
      pose: {
        'hips.ry': 0.15,
        'spine.ry': 0.15,
        'chest.ry': 0.35,
        'chest.rx': 0.1,
        'head.ry': -0.3,
        'shoulderR.rx': -1.55, 'shoulderR.ry': -0.1, 'shoulderR.rz': -0.05, 'elbowR.rx': -0.05, 'wristR.rx': 0,
        'shoulderL.rx': 0.35, 'shoulderL.ry': 0, 'shoulderL.rz': 0.3, 'elbowL.rx': -1.9, 'wristL.rx': 0.2,
      },
    },
    {
      t: 0.6,
      pose: {
        'hips.ry': 0.12,
        'spine.ry': 0.12,
        'chest.ry': 0.3,
        'chest.rx': 0.08,
        'head.ry': -0.25,
        'shoulderR.rx': -1.45, 'shoulderR.ry': -0.08, 'shoulderR.rz': -0.08, 'elbowR.rx': -0.2, 'wristR.rx': 0,
        'shoulderL.rx': 0.3, 'shoulderL.ry': 0, 'shoulderL.rz': 0.3, 'elbowL.rx': -1.9, 'wristL.rx': 0.2,
      },
    },
    {
      t: 1,
      pose: {
        'hips.ry': 0.05,
        'spine.ry': 0,
        'chest.ry': 0,
        'chest.rx': 0.05,
        'head.ry': 0,
        'shoulderR.rx': -0.9, 'shoulderR.ry': 0.1, 'shoulderR.rz': -0.3, 'elbowR.rx': -1.5, 'wristR.rx': 0.1,
        'shoulderL.rx': -0.6, 'shoulderL.ry': 0, 'shoulderL.rz': 0.3, 'elbowL.rx': -1.6, 'wristL.rx': 0.1,
      },
    },
  ],
};

const GUARD_WALL = {
  duration: 0.65,
  fadeIn: 0.05,
  fadeOut: 0.3,
  keys: [
    {
      t: 0,
      pose: {
        'hips.py': -0.22, 'hips.ry': 0, 'hips.rx': 0.12,
        'spine.rx': 0.38, 'spine.ry': 0, 'chest.rx': 0.18, 'chest.ry': 0, 'head.rx': -0.35,
        'shoulderL.rx': -0.35, 'shoulderL.ry': 0, 'shoulderL.rz': 0.35, 'elbowL.rx': -0.5, 'wristL.rx': 0.6,
        'shoulderR.rx': -0.35, 'shoulderR.ry': 0, 'shoulderR.rz': -0.35, 'elbowR.rx': -0.5, 'wristR.rx': 0.6,
        'hipL.rx': -0.65, 'hipL.ry': 0.12, 'hipL.rz': 0.42, 'kneeL.rx': 1.15, 'ankleL.rx': ff(-0.65, 1.15), 'ankleL.rz': -0.42,
        'hipR.rx': -0.65, 'hipR.ry': -0.12, 'hipR.rz': -0.42, 'kneeR.rx': 1.15, 'ankleR.rx': ff(-0.65, 1.15), 'ankleR.rz': 0.42,
      },
    },
    {
      t: 0.32,
      ease: 'out',
      pose: {
        'hips.py': -0.34, 'hips.ry': 0, 'hips.rx': 0.04,
        'spine.rx': -0.04, 'spine.ry': 0, 'chest.rx': -0.06, 'chest.ry': 0, 'head.rx': 0.04,
        'shoulderL.rx': -1.35, 'shoulderL.ry': -0.22, 'shoulderL.rz': 0.24, 'elbowL.rx': -1.85, 'wristL.rx': 0,
        'shoulderR.rx': -1.35, 'shoulderR.ry': 0.22, 'shoulderR.rz': -0.24, 'elbowR.rx': -1.85, 'wristR.rx': 0,
        'hipL.rx': -0.78, 'hipL.ry': 0.15, 'hipL.rz': 0.52, 'kneeL.rx': 1.38, 'ankleL.rx': ff(-0.78, 1.38), 'ankleL.rz': -0.52,
        'hipR.rx': -0.78, 'hipR.ry': -0.15, 'hipR.rz': -0.52, 'kneeR.rx': 1.38, 'ankleR.rx': ff(-0.78, 1.38), 'ankleR.rz': 0.52,
      },
    },
    { t: 1, pose: {} },
  ],
};

const STOMP_SEISMIC = {
  duration: 0.68,
  fadeIn: 0.06,
  fadeOut: 0.3,
  keys: [
    {
      t: 0,
      pose: {
        'hips.py': 0.03, 'hips.ry': 0.12, 'hips.rx': -0.06,
        'spine.rx': -0.1, 'spine.ry': 0, 'chest.rx': -0.06, 'chest.ry': -0.12, 'head.rx': 0.12,
        'shoulderR.rx': -2.65, 'shoulderR.ry': 0, 'shoulderR.rz': -0.35, 'elbowR.rx': -0.6, 'wristR.rx': 0,
        'shoulderL.rx': -0.7, 'shoulderL.ry': 0, 'shoulderL.rz': 0.65, 'elbowL.rx': -1.1, 'wristL.rx': 0,
        'hipR.rx': -1.55, 'hipR.ry': 0, 'hipR.rz': -0.12, 'kneeR.rx': 1.85, 'ankleR.rx': 0.4, 'ankleR.rz': 0,
        'hipL.rx': -0.18, 'hipL.ry': 0, 'hipL.rz': 0.12, 'kneeL.rx': 0.38, 'ankleL.rx': ff(-0.18, 0.38), 'ankleL.rz': -0.12,
      },
    },
    {
      t: 0.36,
      ease: 'in',
      pose: {
        'hips.py': -0.36, 'hips.ry': 0.06, 'hips.rx': 0.18,
        'spine.rx': 0.58, 'spine.ry': 0, 'chest.rx': 0.28, 'chest.ry': 0.18, 'head.rx': -0.42,
        'shoulderR.rx': -0.82, 'shoulderR.ry': 0, 'shoulderR.rz': -0.12, 'elbowR.rx': -0.08, 'wristR.rx': 0.25,
        'shoulderL.rx': 0.75, 'shoulderL.ry': 0, 'shoulderL.rz': 0.72, 'elbowL.rx': -0.45, 'wristL.rx': 0,
        'hipR.rx': -0.92, 'hipR.ry': 0, 'hipR.rz': -0.42, 'kneeR.rx': 1.42, 'ankleR.rx': ff(-0.92, 1.42), 'ankleR.rz': 0.42,
        'hipL.rx': 0.28, 'hipL.ry': 0, 'hipL.rz': 0.38, 'kneeL.rx': 1.05, 'ankleL.rx': ff(0.28, 1.05), 'ankleL.rz': -0.38,
      },
    },
    { t: 1, pose: {} },
  ],
};

const HEAVY_THROW = {
  duration: 0.8,
  fadeIn: 0.08,
  fadeOut: 0.3,
  keys: [
    {
      t: 0,
      pose: {
        'hips.py': -0.12, 'hips.ry': -0.2, 'hips.rx': 0,
        'spine.rx': 0.05, 'spine.ry': -0.25, 'chest.rx': 0, 'chest.ry': -0.3, 'head.ry': 0.3,
        'shoulderL.rx': -0.8, 'shoulderL.ry': -0.3, 'shoulderL.rz': 0.2, 'elbowL.rx': -1.4, 'wristL.rx': 0,
        'shoulderR.rx': -0.2, 'shoulderR.ry': 0.2, 'shoulderR.rz': -0.5, 'elbowR.rx': -1.4, 'wristR.rx': 0,
        'hipL.rx': -0.55, 'hipL.ry': 0, 'hipL.rz': 0.25, 'kneeL.rx': 0.8, 'ankleL.rx': ff(-0.55, 0.8), 'ankleL.rz': -0.25,
        'hipR.rx': 0.3, 'hipR.ry': 0, 'hipR.rz': -0.25, 'kneeR.rx': 0.45, 'ankleR.rx': ff(0.3, 0.45), 'ankleR.rz': 0.25,
      },
    },
    {
      t: 0.31,
      pose: {
        'hips.py': -0.16, 'hips.ry': -0.35, 'hips.rx': 0,
        'spine.rx': -0.05, 'spine.ry': -0.45, 'chest.rx': -0.08, 'chest.ry': -0.45, 'head.ry': 0.55,
        'shoulderL.rx': 0.2, 'shoulderL.ry': -0.2, 'shoulderL.rz': 0.45, 'elbowL.rx': -2.0, 'wristL.rx': 0.3,
        'shoulderR.rx': 0.45, 'shoulderR.ry': 0.2, 'shoulderR.rz': -0.45, 'elbowR.rx': -2.1, 'wristR.rx': 0.3,
        'hipL.rx': -0.5, 'hipL.ry': 0, 'hipL.rz': 0.28, 'kneeL.rx': 0.9, 'ankleL.rx': ff(-0.5, 0.9), 'ankleL.rz': -0.28,
        'hipR.rx': 0.25, 'hipR.ry': 0, 'hipR.rz': -0.28, 'kneeR.rx': 0.6, 'ankleR.rx': ff(0.25, 0.6), 'ankleR.rz': 0.28,
      },
    },
    {
      t: 0.46,
      ease: 'out',
      pose: {
        'hips.py': -0.2, 'hips.ry': 0.2, 'hips.rx': 0.1,
        'spine.rx': 0.3, 'spine.ry': 0.15, 'chest.rx': 0.1, 'chest.ry': 0.1, 'head.ry': -0.2,
        'shoulderL.rx': -1.45, 'shoulderL.ry': -0.15, 'shoulderL.rz': 0.14, 'elbowL.rx': -0.1, 'wristL.rx': -0.7,
        'shoulderR.rx': -1.45, 'shoulderR.ry': 0.15, 'shoulderR.rz': -0.14, 'elbowR.rx': -0.1, 'wristR.rx': -0.7,
        'hipL.rx': -0.85, 'hipL.ry': 0, 'hipL.rz': 0.22, 'kneeL.rx': 1.05, 'ankleL.rx': ff(-0.85, 1.05), 'ankleL.rz': -0.22,
        'hipR.rx': 0.5, 'hipR.ry': 0, 'hipR.rz': -0.22, 'kneeR.rx': 0.25, 'ankleR.rx': ff(0.5, 0.25), 'ankleR.rz': 0.22,
      },
    },
    { t: 1, pose: {} },
  ],
};

const HIT_REACT = {
  duration: 0.25,
  fadeIn: 0.02,
  fadeOut: 0.45,
  keys: [
    {
      t: 0,
      pose: {
        'hips.py': -0.14,
        'spine.rx': -0.15,
        'chest.rx': -0.25,
        'head.rx': -0.35,
        'shoulderL.rx': -0.3, 'shoulderL.rz': 0.55, 'elbowL.rx': -1.1,
        'shoulderR.rx': -0.3, 'shoulderR.rz': -0.55, 'elbowR.rx': -1.1,
      },
    },
    {
      t: 0.35,
      ease: 'out',
      pose: {
        'hips.py': -0.18,
        'spine.rx': -0.38,
        'spine.ry': 0.14,
        'chest.rx': -0.45,
        'chest.ry': 0.18,
        'head.rx': -0.55,
        'head.ry': -0.2,
        'shoulderL.rx': 0.25, 'shoulderL.rz': 0.85, 'elbowL.rx': -0.75,
        'shoulderR.rx': 0.25, 'shoulderR.rz': -0.85, 'elbowR.rx': -0.75,
      },
    },
    { t: 1, pose: {} },
  ],
};

/** Patada circular en arco para lanzar la medialuna de fuego (golpe 3 de combo) */
const CRESCENT_KICK = {
  duration: 0.44,
  fadeIn: 0.04,
  fadeOut: 0.35,
  keys: [
    {
      t: 0,
      pose: {
        'hips.py': -0.08, 'hips.ry': -0.45,
        'spine.ry': -0.25, 'chest.ry': -0.3, 'head.ry': 0.55,
        'shoulderL.rx': -0.8, 'shoulderL.rz': 0.55, 'elbowL.rx': -1.2,
        'shoulderR.rx': -0.4, 'shoulderR.rz': -0.55, 'elbowR.rx': -1.3,
        'hipR.rx': -0.45, 'hipR.rz': -0.25, 'kneeR.rx': 0.9,
      },
    },
    {
      t: 0.38,
      ease: 'out',
      pose: {
        'hips.py': -0.05, 'hips.ry': 0.65, 'hips.rz': 0.18,
        'spine.rx': -0.1, 'spine.ry': 0.28, 'chest.ry': 0.35, 'head.ry': -0.55,
        'shoulderL.rx': -0.6, 'shoulderL.rz': 0.95, 'elbowL.rx': -0.5,
        'shoulderR.rx': -1.25, 'shoulderR.rz': -0.45, 'elbowR.rx': -0.4,
        'hipR.rx': -1.35, 'hipR.ry': 0.25, 'hipR.rz': -0.55, 'kneeR.rx': 0.15, 'ankleR.rx': 0.2,
        'hipL.rx': -0.15, 'kneeL.rx': 0.32, 'ankleL.rx': ff(-0.15, 0.32),
      },
    },
    { t: 1, pose: {} },
  ],
};

const ACTIONS = {
  punch_right: compileAction(PUNCH_RIGHT),
  punch_left: compileAction(mirrorAction(PUNCH_RIGHT)),
  guard_wall: compileAction(GUARD_WALL),
  stomp_seismic: compileAction(STOMP_SEISMIC),
  heavy_throw: compileAction(HEAVY_THROW),
  hit_react: compileAction(HIT_REACT),
  crescent_kick: compileAction(CRESCENT_KICK),
};

export const ACTION_DURATIONS = Object.fromEntries(
  Object.entries(ACTIONS).map(([k, v]) => [k, v.duration])
);
