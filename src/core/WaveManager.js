import * as THREE from 'three';
import { ELEMENT_KEYS } from '../combat/ElementFactory.js';
import { FIGHTER_CONFIG } from '../entities/BaseFighter.js';
import { MonsterEntity } from '../entities/MonsterEntity.js';
import { createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import { createWindRibbonTube } from '../utils/AirGeometry.js';

const STORAGE_KEY = 'elemental_arena_survival_best';
const MAX_CONCURRENT_MONSTERS = 6;

export const SURVIVAL_UPGRADES = [
  {
    id: 'damage',
    icon: '🔥',
    title: 'Poder Elemental',
    desc: '+15% Daño en todas tus habilidades y ataques básicos',
  },
  {
    id: 'cooldown',
    icon: '⚡',
    title: 'Flujo Rápido',
    desc: '-14% Tiempo de Recarga (Cooldowns)',
  },
  {
    id: 'maxhp',
    icon: '💚',
    title: 'Vitalidad del Maestro',
    desc: '+25 HP Máx y +25 HP Curación inmediata',
  },
  {
    id: 'speed',
    icon: '🌪️',
    title: 'Paso Ligero',
    desc: '+12% Velocidad de Movimiento y +8% Altura de Salto',
  },
  {
    id: 'knockback',
    icon: '⛰️',
    title: 'Impacto Sísmico',
    desc: '+22% Fuerza de Empuje contra monstruos',
  },
  {
    id: 'lifesteal',
    icon: '🩸',
    title: 'Vampirismo Espiritual',
    desc: '+12% Robo de Vida al infligir daño a monstruos',
  },
  {
    id: 'armor',
    icon: '🛡️',
    title: 'Coraza Elemental',
    desc: '-12% Daño Recibido de ataques y proyectiles enemigos',
  },
  {
    id: 'status_mastery',
    icon: '❄️',
    title: 'Maestría de Estados',
    desc: '+35% Duración de Quemadura/Hielo y +25% Daño de Quemadura',
  },
  {
    id: 'dash_boost',
    icon: '💨',
    title: 'Aliento del Dash',
    desc: '-25% Cooldown de Dash y +1 Carga Extra de Dash',
  },
  {
    id: 'regen',
    icon: '🌿',
    title: 'Regeneración Chi',
    desc: '+2.5 HP/seg de regeneración continua en combate',
  },
  {
    id: 'crit',
    icon: '⭐',
    title: 'Golpe Crítico',
    desc: '+20% Probabilidad de Crítico (×1.75 Daño dorado)',
  },
  {
    id: 'area',
    icon: '💥',
    title: 'Alcance Expandido',
    desc: '+18% Radio de Explosiones, Ondas y Látigo',
  },
];

export const AURA_DEFS = {
  fire: {
    name: 'Llama Solar',
    icon: '🔥',
    color: '#ff6a1a',
    desc: 'Anillo de fuego (radio 4.5 u) que inflige 10 DPS y aplica Quemadura durante 5s.',
  },
  earth: {
    name: 'Armadura Tectónica',
    icon: '⛰️',
    color: '#e0a94f',
    desc: 'Placas de roca que reducen un 45% el daño recibido y dan resistencia al empuje (5s).',
  },
  water: {
    name: 'Marea Curativa',
    icon: '💧',
    color: '#38d6ff',
    desc: 'Corrientes luminosas que regeneran +8 HP/s mientras el aura está activa (5s).',
  },
  air: {
    name: 'Paso del Viento',
    icon: '🌪️',
    color: '#8af2ff',
    desc: 'Corrientes ascendentes que otorgan +1 salto extra en el aire durante 5s.',
  },
  nature: {
    name: 'Bosque Vivo',
    icon: '🌿',
    color: '#4ade80',
    desc: 'Anillo de lianas y hojas (radio 4.8 u) que regenera +6 HP/s e inflige 8 DPS + ralentización (5s).',
  },
  psychic: {
    name: 'Mente Trascendente',
    icon: '🔮',
    color: '#e879f9',
    desc: 'Anillos rúnicos (radio 5.0 u) que aceleran 35% la recarga básica, +20% velocidad e infligen 7 DPS (5s).',
  },
  storm: {
    name: 'Ojo del Huracán',
    icon: '⛈️',
    color: '#38bdf8',
    desc: 'Vórtice tormentoso (radio 5.0 u) que otorga +25% velocidad y descarga relámpagos cada 0.8s (10 daño + micro-aturdimiento, 5s).',
  },
  light: {
    name: 'Halo Radiante',
    icon: '✨',
    color: '#facc15',
    desc: 'Anillos solares (radio 5.0 u) que aumentan +30% la cadencia de ataque e infligen 9 DPS de quemadura solar durante 5s.',
  },
  shadow: {
    name: 'Segador Nocturno',
    icon: '🌑',
    color: '#f43f5e',
    desc: 'Guadañas orbitales y bruma sombría (radio 5.0 u) que infligen 9 DPS y curan un 25% del daño causado durante 5s.',
  },
};

export const AURA_UPGRADES = {
  fire: [
    { id: 'fire_inferno', icon: '🌋', title: 'Infierno Expansivo', desc: '+45% radio del aura y +40% daño por segundo.' },
    { id: 'fire_fury', icon: '🔱', title: 'Furia Incandescente', desc: 'Con aura activa, ataques infligen +30% daño y aplican Quemadura.' },
    { id: 'fire_eternal', icon: '⏳', title: 'Llama Eterna', desc: '+2.5s duración y -2.5s cooldown de Llama Solar.' },
    { id: 'fire_nova', icon: '☄️', title: 'Nova de Activación', desc: 'Al activar y terminar el aura, detona una onda ígnea que empuja.' },
  ],
  earth: [
    { id: 'earth_bastion', icon: '🏰', title: 'Bastión Inquebrantable', desc: 'Aumenta reducción de daño al 70% e inmunidad total al empuje.' },
    { id: 'earth_thorns', icon: '🪨', title: 'Espinas Tectónicas', desc: 'Devuelve 45% del daño bloqueado y daña enemigos al contacto.' },
    { id: 'earth_perpetual', icon: '⏳', title: 'Placas Perpetuas', desc: '+2.5s duración y -2.5s cooldown de Armadura Tectónica.' },
    { id: 'earth_resonance', icon: '⚒️', title: 'Resonancia Sísmica', desc: 'Con aura activa, tus habilidades ganan +30% daño y empuje.' },
  ],
  water: [
    { id: 'water_spring', icon: '🌊', title: 'Manantial Vital', desc: 'Duplica curación (+16 HP/s) y limpia estados negativos al activar.' },
    { id: 'water_frost', icon: '🧊', title: 'Escarcha Protectora', desc: 'Congela brevemente (1.0s) a monstruos cercanos mientras dura el aura.' },
    { id: 'water_eternal', icon: '⏳', title: 'Corriente Eterna', desc: '+2.5s duración y -2.5s cooldown de Marea Curativa.' },
    { id: 'water_revitalize', icon: '💠', title: 'Marea Revitalizante', desc: '-25% cooldowns básicos y escudo hasta +30 HP al curar lleno.' },
  ],
  air: [
    { id: 'air_acrobat', icon: '🕊️', title: 'Vendaval Acrobático', desc: '+2 saltos extra en el aire y +1 carga de Dash con aura activa.' },
    { id: 'air_cyclone', icon: '🌀', title: 'Ciclón Repulsor', desc: 'Repele monstruos cercanos y destruye proyectiles enemigos al contacto.' },
    { id: 'air_eternal', icon: '⏳', title: 'Aliento Infinito', desc: '+2.5s duración y -2.5s cooldown de Paso del Viento.' },
    { id: 'air_zephyr', icon: '⚡', title: 'Velocidad del Céfiro', desc: 'Con aura activa, +30% velocidad y +25% recarga de habilidades.' },
  ],
  nature: [
    { id: 'nature_thorns', icon: '🥀', title: 'Zarzas Voraces', desc: '+45% radio y daño del aura Bosque Vivo.' },
    { id: 'nature_sap', icon: '💚', title: 'Savia Vital', desc: 'Duplica regeneración (+12 HP/s) y cura al golpear enemigos enredados.' },
    { id: 'nature_eternal', icon: '⏳', title: 'Bosque Eterno', desc: '+2.5s duración y -2.5s cooldown de Bosque Vivo.' },
    { id: 'nature_roots', icon: '🌱', title: 'Esporas Paralizantes', desc: 'Enraíza brevemente (1.2s) a los monstruos que entran al aura.' },
  ],
  psychic: [
    { id: 'psychic_dome', icon: '🛡️', title: 'Domo Telequinético', desc: 'Destruye proyectiles enemigos al tocar el aura y +45% radio/DPS.' },
    { id: 'psychic_hysteria', icon: '😵', title: 'Histeria Colectiva', desc: 'Aplica Pavor por 1.5s periódicamente a los monstruos cercanos.' },
    { id: 'psychic_eternal', icon: '⏳', title: 'Trascendencia Eterna', desc: '+2.5s duración y -2.5s cooldown de Mente Trascendente.' },
    { id: 'psychic_overload', icon: '🔮', title: 'Sobrecarga Mental', desc: 'Con aura activa, Click Izq dispara doble orbe con +30% daño.' },
  ],
  storm: [
    { id: 'storm_unleashed', icon: '⚡', title: 'Tormenta Desatada', desc: '+45% radio y mayor frecuencia de relámpagos en Ojo del Huracán.' },
    { id: 'storm_mist_step', icon: '🌫️', title: 'Paso Espectral', desc: 'Reduce un 35% el cooldown de Forma de Niebla y al salir libera una descarga eléctrica en área.' },
    { id: 'storm_eternal', icon: '⏳', title: 'Frente Eterno', desc: '+2.5s duración y -2.5s cooldown de Ojo del Huracán.' },
    { id: 'storm_overload', icon: '🌩️', title: 'Sobrecarga Voltaica', desc: 'Con aura activa, Descarga Voltaica lanza doble rayo y Nube de Trueno pega un 25% más fuerte.' },
  ],
  light: [
    { id: 'light_supernova', icon: '☀️', title: 'Supernova Cegadora', desc: '+45% radio/DPS del aura y emite un Destello Solar automático cada 2.0s.' },
    { id: 'light_infinite_refract', icon: '💎', title: 'Refracción Infinita', desc: 'Con aura activa, Click Izq dispara 3 haces en abanico y los prismas rebotan 1 rayo adicional.' },
    { id: 'light_eternal', icon: '⏳', title: 'Corona Eterna', desc: '+2.5s duración y -2.5s cooldown de Halo Radiante.' },
    { id: 'light_explosive_mirage', icon: '✨', title: 'Espejismos Explosivos', desc: '-35% cooldown de Espejismo y duplica el radio y daño de su estallido.' },
  ],
  shadow: [
    { id: 'shadow_voracious_eclipse', icon: '🌘', title: 'Eclipse Voraz', desc: '+45% radio y DPS del aura, y duplica el robo de vida al 50% del daño.' },
    { id: 'shadow_phantom_assassin', icon: '🗡️', title: 'Asesino Fantasma', desc: '-35% cooldown de Paso Sombrío y reinicia su cooldown al eliminar un monstruo durante el aura.' },
    { id: 'shadow_eternal', icon: '⏳', title: 'Noche Eterna', desc: '+2.5s duración y -2.5s cooldown de Segador Nocturno.' },
    { id: 'shadow_soul_harvest', icon: '🩸', title: 'Cosecha de Almas', desc: 'Con aura activa, Lanza Umbría atraviesa enemigos y cura +3 HP por impacto.' },
  ],
};

/**
 * WaveManager
 * ------------------------------------------------------------
 * Gestiona las oleadas progresivas del Modo Supervivencia (PvE),
 * la invocación con pilares de luz, el tope de 6 monstruos simultáneos,
 * las cartas de mejora acumulables entre rondas y el récord en `localStorage`.
 */
export class WaveManager {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('../combat/CombatManager.js').CombatManager} o.combat
   * @param {import('../entities/Player.js').Player} o.player
   * @param {import('../audio/SoundManager.js').SoundManager} [o.sound]
   */
  constructor({ scene, combat, player, sound = null }) {
    this.scene = scene;
    this.combat = combat;
    this.player = player;
    this.sound = sound;
    this.arena = combat ? combat.arena : null;

    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.difficulty = 'master';
    this.remainingInWave = 0;

    /** @type {MonsterEntity[]} */
    this.activeMonsters = [];
    /** @type {Array<{type: string, element: string}>} */
    this._pendingQueue = [];
    /** @type {Array<{mesh: THREE.Mesh, geo: THREE.BufferGeometry, mat: THREE.Material, age: number, life: number}>} */
    this._spawnPillars = [];

    this._idCounter = 0;
    this._spawnPointIndex = 0;
    this.currentChoices = [];
    this.appliedUpgrades = [];
    this.upgradeLevels = {};

    this.aura = this._createDefaultAuraState('earth');

    this.onMonsterDamaged = null;
    this.onMonsterDefeated = null;
  }

  _createDefaultAuraState(element = 'earth') {
    return {
      unlocked: false,
      element,
      baseDuration: 5.0,
      baseCooldown: 14.0,
      activeTimer: 0,
      cooldownTimer: 0,
      tickAccum: 0,
      lightNovaTimer: 0,
      targetIcd: new Map(),
      upgrades: {},
    };
  }

  setArena(arena) {
    this.arena = arena;
  }

  /** Lee de forma segura el récord histórico guardado en `localStorage` */
  getRecord() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { maxWave: 0, highScore: 0 };
      const parsed = JSON.parse(raw);
      return {
        maxWave: Math.max(0, Number(parsed.maxWave) || 0),
        highScore: Math.max(0, Number(parsed.highScore) || 0),
      };
    } catch {
      return { maxWave: 0, highScore: 0 };
    }
  }

  /** Actualiza `localStorage` si la partida actual superó oleada máxima o puntuación */
  saveRecordIfBeaten(wave = this.wave, score = this.score) {
    const prev = this.getRecord();
    const isNewRecord = wave > prev.maxWave || score > prev.highScore;
    const next = {
      maxWave: Math.max(prev.maxWave, wave),
      highScore: Math.max(prev.highScore, score),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignora si el navegador bloquea storage
    }
    return { isNewRecord, ...next };
  }

  /** Genera la lista de monstruos de la oleada `waveNum` */
  buildWaveQueue(waveNum) {
    const pickElem = (idx) => ELEMENT_KEYS[(idx + waveNum) % ELEMENT_KEYS.length];
    const items = [];

    if (waveNum === 1) {
      items.push({ type: 'spirit', element: pickElem(0) });
      items.push({ type: 'spirit', element: pickElem(1) });
      return items;
    }
    if (waveNum === 2) {
      items.push({ type: 'spirit', element: pickElem(0) });
      items.push({ type: 'spirit', element: pickElem(2) });
      items.push({ type: 'golem', element: 'earth' });
      return items;
    }
    if (waveNum === 3) {
      items.push({ type: 'colossus', element: pickElem(1) });
      items.push({ type: 'spirit', element: pickElem(0) });
      items.push({ type: 'spirit', element: pickElem(2) });
      return items;
    }

    const spiritCount = Math.min(6, 2 + Math.floor(waveNum / 2));
    const golemCount = Math.min(4, Math.floor((waveNum + 1) / 2));
    if (waveNum % 3 === 0) {
      items.push({ type: 'colossus', element: pickElem(waveNum) });
    }
    for (let i = 0; i < spiritCount; i++) {
      items.push({ type: 'spirit', element: pickElem(i) });
    }
    for (let i = 0; i < golemCount; i++) {
      items.push({ type: 'golem', element: 'earth' });
    }
    return items;
  }

  /** Reinicia mejoras, monstruos y prepara el inicio de Supervivencia */
  resetRun({ difficulty = 'master', arena = this.arena, onDamaged = null, onDefeated = null } = {}) {
    this.clear();
    this.arena = arena || this.arena;
    this.difficulty = difficulty;
    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.remainingInWave = 0;
    this.currentChoices = [];
    this.appliedUpgrades = [];
    this.upgradeLevels = {};
    this.aura = this._createDefaultAuraState(this.player.element || 'earth');
    this.onMonsterDamaged = onDamaged;
    this.onMonsterDefeated = onDefeated;

    // Inicializa modificadores acumulables de Supervivencia en el jugador
    this.player.maxHp = 100;
    this.player.hp = 100;
    this.player.config.runSpeed = FIGHTER_CONFIG.runSpeed;
    this.player.survivalMods = {
      damageMult: 1,
      cooldownMult: 1,
      speedMult: 1,
      jumpMult: 1,
      knockbackMult: 1,
      lifesteal: 0,
      damageTakenMult: 1,
      statusDurationMult: 1,
      burnDamageMult: 1,
      dashCooldownMult: 1,
      extraDashCharges: 0,
      extraAirJumps: 0,
      hpRegen: 0,
      critChance: 0,
      areaMult: 1,
      // Dinámicos del Aura Elemental activa
      auraDamageMult: 1,
      auraKnockbackMult: 1,
      auraDamageTakenMult: 1,
      auraKnockbackTakenMult: 1,
      auraCooldownMult: 1,
      auraSpeedMult: 1,
      auraAirJumps: 0,
      auraDashCharges: 0,
      auraFireFury: false,
      auraThornsRatio: 0,
      auraShieldHp: 0,
    };
    this.player._dashCharges = 1;
    this.player._airJumpsUsed = 0;
    if (this.player.mesh && this.player.mesh.setElementalAura) {
      this.player.mesh.setElementalAura(this.aura.element, false);
    }
  }

  /** Limpia todos los monstruos activos, cola y pilares visuales */
  clear() {
    for (const m of this.activeMonsters) {
      if (this.combat) this.combat.removeFighter(m);
      m.dispose();
    }
    this.activeMonsters.length = 0;
    this._pendingQueue.length = 0;

    for (const p of this._spawnPillars) {
      if (p.dispose) p.dispose();
    }
    this._spawnPillars.length = 0;

    if (this.player && this.player.mesh && this.player.mesh.setElementalAura) {
      this.player.mesh.setElementalAura(this.aura ? this.aura.element : 'earth', false);
    }
  }

  /** Arranca la oleada indicada e invoca hasta 6 monstruos iniciales */
  startWave(waveNum = 1) {
    this.wave = waveNum;
    this._pendingQueue = this.buildWaveQueue(waveNum);
    this.remainingInWave = this._pendingQueue.length;
    this._spawnPointIndex = 0;

    const initialCount = Math.min(MAX_CONCURRENT_MONSTERS, this._pendingQueue.length);
    for (let i = 0; i < initialCount; i++) {
      this._spawnNextFromQueue();
    }
  }

  _pickMonsterSpawnPos() {
    const arena = this.arena;
    const pts = arena && arena.getSpawnPoints ? arena.getSpawnPoints(7) : [new THREE.Vector3(0, 0, -14)];
    // Evita el índice 0 si está muy cerca del jugador; rota por puntos lejanos
    const candidates = pts.length > 1 ? pts.slice(1) : pts;
    const sorted = [...candidates].sort((a, b) => {
      const da = a.distanceToSquared(this.player.position);
      const db = b.distanceToSquared(this.player.position);
      return db - da;
    });
    const base = sorted[this._spawnPointIndex % sorted.length].clone();
    this._spawnPointIndex++;
    // Desplazamiento leve para que invocaciones cercanas no se apilen exactas
    const jitterAng = (this._spawnPointIndex * 2.1) % (Math.PI * 2);
    base.x += Math.cos(jitterAng) * 1.4;
    base.z += Math.sin(jitterAng) * 1.4;
    return base;
  }

  _spawnLightPillar(pos, element, isBoss = false) {
    const colorMap = {
      fire: '#ff6a1a',
      water: '#38d6ff',
      earth: '#f2b138',
      air: '#c4f7ff',
      nature: '#52b788',
      psychic: '#e879f9',
      storm: '#38bdf8',
      light: '#fef08a',
      shadow: '#f43f5e',
    };
    const baseColor = colorMap[element] || '#ffe399';
    const radius = isBoss ? 1.55 : 0.88;
    const height = isBoss ? 13 : 9.5;

    const group = new THREE.Group();
    group.name = 'SummonPortalVortex';
    group.position.copy(pos);

    const outerGeo = new THREE.CylinderGeometry(radius * 1.38, radius * 0.52, height, 26, 12, true);
    outerGeo.translate(0, height * 0.5, 0);
    const outerMat = createEnergyVFXMaterial({
      coreColor: baseColor,
      rimColor: '#ffffff',
      opacity: 0.58,
      softEdge: true,
      fadeEndsY: true,
      additive: true,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.userData.noOutline = true;

    const coreGeo = new THREE.CylinderGeometry(radius * 0.3, radius * 0.62, height * 0.9, 18, 8, true);
    coreGeo.translate(0, height * 0.45, 0);
    const coreMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: baseColor,
      opacity: 0.78,
      fadeEndsY: true,
      additive: true,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.userData.noOutline = true;

    const ribbonGeo = createWindRibbonTube(radius * 1.25, radius * 0.5, height * 0.6, 2.2, 26, isBoss ? 0.1 : 0.065);
    const ribbonMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: baseColor,
      opacity: 0.85,
      fadeEnds: true,
      additive: true,
      depthWrite: false,
    });
    const ribA = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribA.userData.noOutline = true;
    const ribB = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribB.rotation.y = Math.PI;
    ribB.userData.noOutline = true;

    const ringGeo = new THREE.RingGeometry(radius * 0.68, radius * 1.45, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: baseColor,
      opacity: 0.88,
      softEdge: true,
      additive: true,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.06;
    ringMesh.userData.noOutline = true;

    group.add(outerMesh, coreMesh, ribA, ribB, ringMesh);
    this.scene.add(group);

    const mats = [
      { mat: outerMat, baseOpacity: 0.58 },
      { mat: coreMat, baseOpacity: 0.78 },
      { mat: ribbonMat, baseOpacity: 0.85 },
      { mat: ringMat, baseOpacity: 0.88 },
    ];
    const geos = [outerGeo, coreGeo, ribbonGeo, ringGeo];

    this._spawnPillars.push({
      group,
      ringMesh,
      mats,
      age: 0,
      life: 0.92,
      dispose: () => {
        if (group.parent) this.scene.remove(group);
        for (const g of geos) g.dispose();
        for (const m of mats) m.mat.dispose();
      },
    });

    if (this.combat && this.combat.vfx) {
      this.combat.vfx.spawnShockwave(pos, isBoss ? 4.2 : 2.6, 0.42, baseColor);
      this.combat.vfx.spawnDust(pos, { count: isBoss ? 14 : 8, size: 0.75, speed: 3.0, ring: true });
    }
    if (this.sound && this.sound.playMonsterSpawn) {
      this.sound.playMonsterSpawn(isBoss);
    }
  }

  _spawnNextFromQueue() {
    if (this._pendingQueue.length === 0) return null;
    if (this.activeMonsters.length >= MAX_CONCURRENT_MONSTERS) return null;

    const spec = this._pendingQueue.shift();
    const spawnPos = this._pickMonsterSpawnPos();
    const yaw = Math.atan2(this.player.position.x - spawnPos.x, this.player.position.z - spawnPos.z);

    const monster = new MonsterEntity({
      id: `monster_${++this._idCounter}`,
      monsterType: spec.type,
      element: spec.element,
      scene: this.scene,
      arena: this.arena,
      combat: this.combat,
    });

    monster.setDifficulty(this.difficulty);
    monster.resetFighter(spawnPos, yaw, false);
    monster.combatEnabled = true;

    if (this.onMonsterDamaged) monster.onDamaged = this.onMonsterDamaged;
    if (this.onMonsterDefeated) monster.onDefeated = this.onMonsterDefeated;

    if (this.combat) this.combat.registerFighter(monster);
    this.activeMonsters.push(monster);

    this._spawnLightPillar(spawnPos, spec.element, spec.type === 'colossus');
    return monster;
  }

  /** Procesa la eliminación de un monstruo por KO o Ring-Out */
  handleMonsterDefeated(monster, reason = 'KO') {
    const idx = this.activeMonsters.indexOf(monster);
    if (idx === -1) return { waveCleared: false, pointsEarned: 0 };

    this.activeMonsters.splice(idx, 1);
    if (this.combat) this.combat.removeFighter(monster);

    // Asesino Fantasma (Sombra): reinicia cooldown de Paso Sombrío al eliminar un monstruo con el aura activa
    if (
      this.aura?.unlocked &&
      this.aura.activeTimer > 0 &&
      this.aura.element === 'shadow' &&
      this.aura.upgrades?.shadow_phantom_assassin &&
      monster.lastAttackerId === 'player' &&
      this.player?.elementController?.cooldowns
    ) {
      this.player.elementController.cooldowns.shadowstep = 0;
      if (this.player.mesh && this.player.mesh.flash) {
        this.player.mesh.flash('#f43f5e');
      }
    }

    const ringOutBonus = reason === 'RING_OUT' ? 50 : 0;
    const pointsEarned = (monster.scoreValue || 100) + ringOutBonus;
    this.score += pointsEarned;
    this.kills += 1;
    this.remainingInWave = Math.max(0, this.remainingInWave - 1);

    if (this.combat && this.combat.vfx) {
      const p = monster.position.clone().setY(Math.max(0.5, monster.position.y + 0.9));
      this.combat.vfx.spawnHitSparks(p, new THREE.Vector3(0, 1, 0), monster.monsterType === 'colossus' ? 2.2 : 1.4);
      this.combat.vfx.spawnShockwave(monster.position.clone().setY(Math.max(0.1, monster.position.y)), 2.5, 0.35);
    }

    monster.dispose();

    // Invoca refuerzo si quedaban monstruos en la cola de la oleada
    if (this._pendingQueue.length > 0 && this.activeMonsters.length < MAX_CONCURRENT_MONSTERS) {
      this._spawnNextFromQueue();
    }

    const waveCleared = this.remainingInWave <= 0 && this.activeMonsters.length === 0;
    return { waveCleared, pointsEarned };
  }

  /** Cura +25 HP a jugador y aliado al limpiar oleada y suma bonus */
  rewardWaveClear(allyFighter = null) {
    this.score += this.wave * 100;
    if (this.player && this.player.isAlive) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
      if (this.player.mesh && this.player.mesh.flash) this.player.mesh.flash('#8cff7a');
    }
    if (allyFighter && allyFighter.isAlive) {
      allyFighter.hp = Math.min(allyFighter.maxHp, allyFighter.hp + 25);
      if (allyFighter.mesh && allyFighter.mesh.flash) allyFighter.mesh.flash('#6be6ff');
    }
    if (this.sound && this.sound.playWaveClear) {
      this.sound.playWaveClear();
    }
  }

  /**
   * Selecciona 3 cartas aleatorias del pool general (+ carta especial de Aura cada 2 oleadas:
   * Oleada 2 desbloqueo y Oleadas 4, 6, 8... mejoras; + carta de Rescate si el aliado IA murió).
   * @param {number} [clearedWave=this.wave]
   * @param {import('../entities/BaseFighter.js').BaseFighter | null} [allyFighter=null]
   */
  rollUpgradeChoices(clearedWave = this.wave, allyFighter = null) {
    const mods = this.player?.survivalMods;
    const pool = SURVIVAL_UPGRADES.filter((u) => !(u.id === 'crit' && mods && mods.critChance >= 1));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const choices = pool.slice(0, 3).map((u) => {
      const nextLv = (this.upgradeLevels[u.id] || 0) + 1;
      return {
        ...u,
        level: nextLv,
        badge: `Nv. ${nextLv}`,
        isAuraCard: false,
      };
    });

    const elem = this.player?.element || this.aura.element || 'earth';
    this.aura.element = elem;
    const auraDef = AURA_DEFS[elem] || AURA_DEFS.earth;

    if (clearedWave >= 2 && clearedWave % 2 === 0 && !this.aura.unlocked) {
      choices.push({
        id: 'aura_unlock',
        isAuraCard: true,
        auraAction: 'unlock',
        element: elem,
        icon: auraDef.icon,
        title: `DESBLOQUEAR AURA: ${auraDef.name.toUpperCase()}`,
        desc: auraDef.desc,
        badge: 'HABILIDAD ESPECIAL [R]',
        accentColor: auraDef.color,
      });
    } else if (clearedWave >= 4 && clearedWave % 2 === 0 && this.aura.unlocked) {
      const elemPool = AURA_UPGRADES[elem] || [];
      const available = elemPool.filter((u) => !this.aura.upgrades[u.id]);
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        choices.push({
          ...pick,
          isAuraCard: true,
          auraAction: 'upgrade',
          element: elem,
          badge: 'MEJORA DE AURA [R]',
          accentColor: auraDef.color,
        });
      }
    }

    if (allyFighter && !allyFighter.isAlive) {
      choices.push({
        id: 'revive_ally',
        isAuraCard: true,
        isReviveCard: true,
        icon: '🪽',
        title: 'REVIVIR ALIADO IA',
        desc: 'Revive a tu compañero con 50% de vida y regeneración de +1 HP cada 2s.',
        badge: 'RESCATE 2v2',
        accentColor: '#5ce6ff',
      });
    }

    this.currentChoices = choices;
    return this.currentChoices;
  }

  /** Aplica la carta de mejora general, Aura Elemental o Rescate de Aliado elegida */
  applyUpgrade(upgradeId, allyFighter = null) {
    const mods = this.player.survivalMods;
    const elem = this.player?.element || this.aura.element || 'earth';
    this.aura.element = elem;

    if (upgradeId === 'revive_ally') {
      if (allyFighter) {
        const spawn = this.player.position.clone();
        spawn.x += 2.2;
        if (this.arena && this.arena.getGroundHeightAt) {
          const gy = this.arena.getGroundHeightAt(spawn.x, 4, spawn.z);
          spawn.y = Number.isFinite(gy) ? gy : Math.max(0, this.player.position.y);
        }
        allyFighter.resetFighter(spawn, this.player.yaw, true);
        allyFighter.hp = Math.max(1, Math.round(allyFighter.maxHp * 0.5));
        allyFighter.isAlive = true;
        allyFighter.combatEnabled = false;
        allyFighter.allyRegenAmount = 1;
        allyFighter.allyRegenInterval = 2.0;
        allyFighter._allyRegenTimer = 2.0;
        if (allyFighter.mesh && allyFighter.mesh.root) {
          allyFighter.mesh.root.visible = true;
          if (allyFighter.mesh.setTeamRing) allyFighter.mesh.setTeamRing('ally');
          if (allyFighter.mesh.flash) allyFighter.mesh.flash('#6be6ff');
        }
        if (this.combat) {
          this.combat.registerFighter(allyFighter, allyFighter.elementController);
          if (this.combat.vfx) {
            this.combat.vfx.spawnShockwave(spawn, 3.2, 0.4, '#6be6ff');
          }
        }
      }
    } else if (upgradeId === 'aura_unlock') {
      this.aura.unlocked = true;
      this.aura.activeTimer = 0;
      this.aura.cooldownTimer = 0;
    } else if ((AURA_UPGRADES[elem] || []).some((u) => u.id === upgradeId)) {
      this.aura.upgrades[upgradeId] = true;
      this._syncAuraMods(this.aura.activeTimer > 0);
    } else {
      this.upgradeLevels[upgradeId] = (this.upgradeLevels[upgradeId] || 0) + 1;
      if (upgradeId === 'damage') {
        mods.damageMult = Number((mods.damageMult * 1.15).toFixed(3));
      } else if (upgradeId === 'cooldown') {
        mods.cooldownMult = Number((mods.cooldownMult * 0.86).toFixed(3));
      } else if (upgradeId === 'maxhp') {
        this.player.maxHp += 25;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
        if (allyFighter && allyFighter.isAlive) {
          allyFighter.maxHp += 25;
          allyFighter.hp = Math.min(allyFighter.maxHp, allyFighter.hp + 25);
        }
      } else if (upgradeId === 'speed') {
        mods.speedMult = Number((mods.speedMult * 1.12).toFixed(3));
        mods.jumpMult = Number((mods.jumpMult * 1.08).toFixed(3));
        this.player.config.runSpeed = FIGHTER_CONFIG.runSpeed * mods.speedMult * (mods.auraSpeedMult || 1);
      } else if (upgradeId === 'knockback') {
        mods.knockbackMult = Number((mods.knockbackMult * 1.22).toFixed(3));
      } else if (upgradeId === 'lifesteal') {
        mods.lifesteal = Number((mods.lifesteal + 0.12).toFixed(3));
      } else if (upgradeId === 'armor') {
        mods.damageTakenMult = Number((mods.damageTakenMult * 0.88).toFixed(3));
      } else if (upgradeId === 'status_mastery') {
        mods.statusDurationMult = Number((mods.statusDurationMult * 1.35).toFixed(3));
        mods.burnDamageMult = Number((mods.burnDamageMult * 1.25).toFixed(3));
      } else if (upgradeId === 'dash_boost') {
        mods.dashCooldownMult = Number((mods.dashCooldownMult * 0.75).toFixed(3));
        mods.extraDashCharges += 1;
        this.player._dashCharges = Math.min(this.player.getMaxDashCharges(), this.player._dashCharges + 1);
      } else if (upgradeId === 'regen') {
        mods.hpRegen = Number((mods.hpRegen + 2.5).toFixed(2));
      } else if (upgradeId === 'crit') {
        mods.critChance = Math.min(1, Number((mods.critChance + 0.2).toFixed(2)));
      } else if (upgradeId === 'area') {
        mods.areaMult = Number((mods.areaMult * 1.18).toFixed(3));
      }
    }

    this.appliedUpgrades.push(upgradeId);
    if (this.sound && this.sound.playUpgradePick) {
      this.sound.playUpgradePick();
    }
    if (this.player.mesh && this.player.mesh.flash) {
      this.player.mesh.flash('#ffd86b');
    }
  }

  _hasEternalUpgrade() {
    const u = this.aura.upgrades;
    return !!(
      u.fire_eternal ||
      u.earth_perpetual ||
      u.water_eternal ||
      u.air_eternal ||
      u.nature_eternal ||
      u.psychic_eternal ||
      u.storm_eternal ||
      u.light_eternal ||
      u.shadow_eternal
    );
  }

  getAuraDuration() {
    return this.aura.baseDuration + (this._hasEternalUpgrade() ? 2.5 : 0);
  }

  getAuraCooldown() {
    return Math.max(4.0, this.aura.baseCooldown - (this._hasEternalUpgrade() ? 2.5 : 0));
  }

  _getAuraRadiusScale() {
    const areaScale = this.player?.survivalMods?.areaMult || 1;
    const infernoScale = this.aura.element === 'fire' && this.aura.upgrades.fire_inferno ? 1.45 : 1;
    const thornsScale = this.aura.element === 'nature' && this.aura.upgrades.nature_thorns ? 1.45 : 1;
    const psyScale = this.aura.element === 'psychic' && this.aura.upgrades.psychic_dome ? 1.45 : 1;
    const stormScale = this.aura.element === 'storm' && this.aura.upgrades.storm_unleashed ? 1.45 : 1;
    const lightScale = this.aura.element === 'light' && this.aura.upgrades.light_supernova ? 1.45 : 1;
    const shadowScale = this.aura.element === 'shadow' && this.aura.upgrades.shadow_voracious_eclipse ? 1.45 : 1;
    return areaScale * infernoScale * thornsScale * psyScale * stormScale * lightScale * shadowScale;
  }

  _syncAuraMods(active) {
    const mods = this.player?.survivalMods;
    if (!mods) return;

    mods.auraDamageMult = 1;
    mods.auraKnockbackMult = 1;
    mods.auraDamageTakenMult = 1;
    mods.auraKnockbackTakenMult = 1;
    mods.auraCooldownMult = 1;
    mods.auraSpeedMult = 1;
    mods.auraAirJumps = 0;
    mods.auraDashCharges = 0;
    mods.auraFireFury = false;
    mods.auraThornsRatio = 0;
    mods.auraNatureSap = false;
    mods.auraPsychicOverload = false;
    mods.auraStormOverload = false;
    mods.auraLightInfiniteRefract = false;
    mods.auraLightExplosiveMirage = this.aura.element === 'light' && !!this.aura.upgrades.light_explosive_mirage;
    mods.lightMirageCdMult = this.aura.element === 'light' && this.aura.upgrades.light_explosive_mirage ? 0.65 : 1;
    mods.auraShadowHarvest = false;
    mods.shadowStepCdMult = this.aura.element === 'shadow' && this.aura.upgrades.shadow_phantom_assassin ? 0.65 : 1;
    mods.mistCooldownMult = this.aura.element === 'storm' && this.aura.upgrades.storm_mist_step ? 0.65 : 1;
    mods.mistExitDischarge = this.aura.element === 'storm' && !!this.aura.upgrades.storm_mist_step;
    if (!active) mods.auraShieldHp = 0;

    if (active) {
      const elem = this.aura.element;
      const up = this.aura.upgrades;
      if (elem === 'fire') {
        if (up.fire_fury) {
          mods.auraDamageMult = 1.3;
          mods.auraFireFury = true;
        }
      } else if (elem === 'earth') {
        mods.auraDamageTakenMult = up.earth_bastion ? 0.3 : 0.55;
        mods.auraKnockbackTakenMult = up.earth_bastion ? 0 : 0.35;
        if (up.earth_thorns) mods.auraThornsRatio = 0.45;
        if (up.earth_resonance) {
          mods.auraDamageMult = 1.3;
          mods.auraKnockbackMult = 1.3;
        }
      } else if (elem === 'water') {
        if (up.water_revitalize) mods.auraCooldownMult = 0.75;
      } else if (elem === 'air') {
        mods.auraAirJumps = up.air_acrobat ? 2 : 1;
        if (up.air_acrobat) mods.auraDashCharges = 1;
        if (up.air_zephyr) {
          mods.auraSpeedMult = 1.3;
          mods.auraCooldownMult = 0.75;
        }
      } else if (elem === 'nature') {
        mods.auraNatureSap = !!up.nature_sap;
      } else if (elem === 'psychic') {
        mods.auraCooldownMult = 0.65;
        mods.auraSpeedMult = 1.2;
        mods.auraPsychicOverload = !!up.psychic_overload;
      } else if (elem === 'storm') {
        mods.auraSpeedMult = 1.25;
        mods.auraStormOverload = !!up.storm_overload;
      } else if (elem === 'light') {
        mods.auraCooldownMult = 0.7;
        mods.auraLightInfiniteRefract = !!up.light_infinite_refract;
      } else if (elem === 'shadow') {
        mods.auraShadowHarvest = !!up.shadow_soul_harvest;
      }
    }

    this.player.config.runSpeed = FIGHTER_CONFIG.runSpeed * mods.speedMult * mods.auraSpeedMult;
  }

  /** Activa el Aura Elemental del jugador (Tecla R) si está desbloqueada y lista */
  activateAura() {
    if (!this.aura.unlocked || !this.player || !this.player.isAlive || this.player.isFrozen) return false;
    if (this.aura.activeTimer > 0 || this.aura.cooldownTimer > 0) return false;

    const elem = this.player.element || this.aura.element || 'earth';
    this.aura.element = elem;
    const dur = this.getAuraDuration();
    const cd = this.getAuraCooldown();

    this.aura.activeTimer = dur;
    this.aura.cooldownTimer = cd;
    this.aura.tickAccum = 0.12;
    this.aura.lightNovaTimer = 2.0;
    this.aura.targetIcd.clear();

    this._syncAuraMods(true);

    if (elem === 'water' && this.aura.upgrades.water_spring) {
      this.player.clearStatuses();
    }
    if (elem === 'air' && this.aura.upgrades.air_acrobat) {
      this.player._dashCharges = Math.min(this.player.getMaxDashCharges(), this.player._dashCharges + 1);
    }
    if (elem === 'fire' && this.aura.upgrades.fire_nova) {
      this._triggerFireNova();
    }

    const radiusScale = this._getAuraRadiusScale();
    if (this.player.mesh && this.player.mesh.setElementalAura) {
      this.player.mesh.setElementalAura(elem, true, radiusScale);
      this.player.mesh.flash((AURA_DEFS[elem] || AURA_DEFS.earth).color);
    }
    if (this.sound && this.sound.playAuraActivate) {
      this.sound.playAuraActivate(elem);
    }
    if (this.combat && this.combat.vfx) {
      const def = AURA_DEFS[elem] || AURA_DEFS.earth;
      this.combat.vfx.spawnShockwave(this.player.position, 3.8 * radiusScale, 0.42, def.color);
    }
    return true;
  }

  _triggerFireNova() {
    if (!this.player || !this.combat) return;
    const novaRadius = 5.4 * (this.player.survivalMods?.areaMult || 1);
    if (this.combat.vfx) {
      this.combat.vfx.spawnShockwave(this.player.position, novaRadius, 0.45, '#ff6a1a');
      this.combat.vfx.spawnFireSparks(this.player.position.clone().setY(1.0), new THREE.Vector3(0, 1, 0), 1.8);
    }
    if (this.sound && this.sound.playMeteorImpact) {
      this.sound.playMeteorImpact();
    }
    for (const m of this.activeMonsters) {
      if (!m || !m.isAlive) continue;
      const dx = m.position.x - this.player.position.x;
      const dz = m.position.z - this.player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= novaRadius) {
        const dir = new THREE.Vector3(dx, 0.3, dz).normalize();
        m.takeDamage(18, dir, 12.5, 'player');
        m.applyBurn(2.2, 4.5, 'player');
      }
    }
  }

  /** Estado actual del Aura para la 5.ª ranura del HUD `[R]` */
  getAuraHudState() {
    const elem = this.player?.element || this.aura.element || 'earth';
    const def = AURA_DEFS[elem] || AURA_DEFS.earth;
    const dur = this.getAuraDuration();
    const cd = this.getAuraCooldown();
    return {
      unlocked: this.aura.unlocked,
      element: elem,
      name: def.name,
      color: def.color,
      active: this.aura.activeTimer > 0,
      activeRemaining: this.aura.activeTimer,
      activeRatio: dur > 0 ? Math.max(0, Math.min(1, this.aura.activeTimer / dur)) : 0,
      cooldownRemaining: this.aura.activeTimer > 0 ? 0 : this.aura.cooldownTimer,
      cooldownTotal: cd,
      ready: this.aura.unlocked && this.aura.activeTimer <= 0 && this.aura.cooldownTimer <= 0,
    };
  }

  _updateAuraTick(dt) {
    if (!this.aura.unlocked) return;

    if (!this.player || !this.player.isAlive) {
      if (this.aura.activeTimer > 0) {
        this.aura.activeTimer = 0;
        this._syncAuraMods(false);
        if (this.player?.mesh?.setElementalAura) {
          this.player.mesh.setElementalAura(this.aura.element, false);
        }
      }
      return;
    }

    if (this.aura.activeTimer > 0) {
      this.aura.activeTimer -= dt;
      const elem = this.aura.element;
      const up = this.aura.upgrades;
      const pPos = this.player.position;
      const areaScale = this.player.survivalMods?.areaMult || 1;

      for (const [fid, rem] of this.aura.targetIcd.entries()) {
        if (rem - dt <= 0) this.aura.targetIcd.delete(fid);
        else this.aura.targetIcd.set(fid, rem - dt);
      }

      if (elem === 'water') {
        const healRate = up.water_spring ? 16 : 8;
        const healAmt = healRate * dt;
        const prevHp = this.player.hp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmt);
        const overflow = Math.max(0, healAmt - (this.player.hp - prevHp));
        if (up.water_revitalize && overflow > 0 && this.player.survivalMods) {
          this.player.survivalMods.auraShieldHp = Math.min(30, (this.player.survivalMods.auraShieldHp || 0) + overflow);
        }
      } else if (elem === 'nature') {
        const natHealRate = up.nature_sap ? 12 : 6;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + natHealRate * dt);
      }

      if (((elem === 'air' && up.air_cyclone) || (elem === 'psychic' && up.psychic_dome)) && this.combat) {
        const cycRadius = (elem === 'psychic' ? 5.0 * this._getAuraRadiusScale() : 4.2 * areaScale);
        for (const proj of this.combat.projectiles) {
          if (!proj.alive || this.combat.isSameTeamIds('player', proj.ownerId)) continue;
          if (proj.position.distanceTo(pPos.clone().setY(pPos.y + 1.0)) <= cycRadius) {
            proj.alive = false;
            if (proj.onExpire) proj.onExpire(proj);
            if (this.combat.vfx) {
              if (elem === 'psychic') this.combat.vfx.spawnHitSparks(proj.position, new THREE.Vector3(0, 1, 0), 0.9, '#e879f9');
              else this.combat.vfx.spawnWindSwirl(proj.position, 1.4);
            }
          }
        }
      }

      if (elem === 'light' && up.light_supernova) {
        this.aura.lightNovaTimer -= dt;
        if (this.aura.lightNovaTimer <= 0) {
          this.aura.lightNovaTimer = 2.0;
          const novaRadius = 5.0 * this._getAuraRadiusScale();
          if (this.sound && this.sound.playLightFlash) this.sound.playLightFlash();
          if (this.combat?.vfx) {
            this.combat.vfx.spawnShockwave(pPos, novaRadius * 1.1, 0.34, '#facc15');
            this.combat.vfx.spawnShockwave(pPos, novaRadius * 0.7, 0.24, '#ffffff');
          }
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= novaRadius + m.config.radius) {
              const push = dist > 0.15 ? new THREE.Vector3(dx / dist, 0.25, dz / dist).normalize() : new THREE.Vector3(0, 0.5, 1).normalize();
              m.takeDamage(12, push, 6.2, 'player');
              if (m.applyStun) m.applyStun(1.1, 'player');
            }
          }
        }
      }

      this.aura.tickAccum -= dt;
      if (this.aura.tickAccum <= 0) {
        this.aura.tickAccum = elem === 'storm' ? (up.storm_unleashed ? 0.55 : 0.8) : 0.5;
        if (elem === 'fire') {
          const r = 4.5 * this._getAuraRadiusScale();
          const tickDmg = 5 * (up.fire_inferno ? 1.4 : 1);
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              const push = new THREE.Vector3(dx, 0.12, dz).normalize();
              m.takeDamage(tickDmg, push, 1.8, 'player');
              m.applyBurn(2.2, 4.5, 'player');
            }
          }
        } else if (elem === 'earth' && up.earth_thorns) {
          const r = 2.8 * areaScale;
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive || this.aura.targetIcd.has(m.id)) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              this.aura.targetIcd.set(m.id, 0.85);
              m.takeDamage(6, new THREE.Vector3(dx, 0.2, dz).normalize(), 4.5, 'player');
            }
          }
        } else if (elem === 'water' && up.water_frost) {
          const r = 3.8 * areaScale;
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive || this.aura.targetIcd.has(m.id)) continue;
            if (Math.hypot(m.position.x - pPos.x, m.position.z - pPos.z) <= r + m.config.radius) {
              this.aura.targetIcd.set(m.id, 2.4);
              m.applyFreeze(1.0, 'player');
            }
          }
        } else if (elem === 'air' && up.air_cyclone) {
          const r = 4.4 * areaScale;
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive || this.aura.targetIcd.has(m.id)) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              this.aura.targetIcd.set(m.id, 0.65);
              const dir = new THREE.Vector3(dx, 0.22, dz).normalize();
              m.takeDamage(3, dir, 6.5, 'player');
            }
          }
        } else if (elem === 'nature') {
          const r = 4.8 * this._getAuraRadiusScale();
          const tickDmg = 4 * (up.nature_thorns ? 1.45 : 1);
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              const push = new THREE.Vector3(dx, 0.08, dz).normalize();
              m.takeDamage(tickDmg, push, 1.2, 'player');
              // Ralentización suave sobre monstruos dentro de Bosque Vivo
              m.velocity.x *= 0.45;
              m.velocity.z *= 0.45;
              if (up.nature_roots && !this.aura.targetIcd.has(m.id)) {
                this.aura.targetIcd.set(m.id, 2.6);
                if (m.applyRoot) m.applyRoot(1.2, 'player');
              }
            }
          }
        } else if (elem === 'psychic') {
          const r = 5.0 * this._getAuraRadiusScale();
          const tickDmg = 3.5 * (up.psychic_dome ? 1.45 : 1);
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              const push = new THREE.Vector3(dx, 0.12, dz).normalize();
              m.takeDamage(tickDmg, push, 1.6, 'player');
              if (up.psychic_hysteria && !this.aura.targetIcd.has(m.id)) {
                this.aura.targetIcd.set(m.id, 3.0);
                if (m.applyConfusion) m.applyConfusion(1.5, 'player');
              }
            }
          }
        } else if (elem === 'storm') {
          const r = 5.0 * this._getAuraRadiusScale();
          const maxHits = up.storm_overload ? 4 : 3;
          let struck = 0;
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive || struck >= maxHits) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              struck++;
              const push = new THREE.Vector3(dx, 0.2, dz).normalize();
              m.takeDamage(10, push, 4.2, 'player');
              m._hitstunTimer = Math.max(m._hitstunTimer || 0, 0.25);
              if (this.combat?.vfx) {
                this.combat.vfx.spawnHitSparks(
                  m.position.clone().setY(m.position.y + 1.05),
                  push,
                  1.0,
                  '#fde047'
                );
              }
            }
          }
          if (struck > 0 && this.sound && this.sound.playStormChain) {
            this.sound.playStormChain();
          }
        } else if (elem === 'light') {
          const r = 5.0 * this._getAuraRadiusScale();
          const tickDmg = 4.5 * (up.light_supernova ? 1.45 : 1);
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              const push = new THREE.Vector3(dx, 0.12, dz).normalize();
              m.takeDamage(tickDmg, push, 1.4, 'player');
              if (this.combat?.vfx) {
                this.combat.vfx.spawnHitSparks(
                  m.position.clone().setY(m.position.y + 1.0),
                  push,
                  0.8,
                  '#facc15'
                );
              }
            }
          }
        } else if (elem === 'shadow') {
          const r = 5.0 * this._getAuraRadiusScale();
          const tickDmg = 4.5 * (up.shadow_voracious_eclipse ? 1.45 : 1);
          const leechRatio = up.shadow_voracious_eclipse ? 0.5 : 0.25;
          let totalDamageDealt = 0;
          for (const m of this.activeMonsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - pPos.x;
            const dz = m.position.z - pPos.z;
            if (Math.hypot(dx, dz) <= r + m.config.radius) {
              const hpBefore = m.hp;
              const push = new THREE.Vector3(dx, 0.12, dz).normalize();
              m.takeDamage(tickDmg, push, 1.4, 'player');
              totalDamageDealt += Math.max(0, hpBefore - Math.max(0, m.hp)) || tickDmg;
              if (this.combat?.vfx) {
                this.combat.vfx.spawnHitSparks(
                  m.position.clone().setY(m.position.y + 1.0),
                  push,
                  0.8,
                  '#f43f5e'
                );
              }
            }
          }
          if (totalDamageDealt > 0 && this.player.isAlive) {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + totalDamageDealt * leechRatio);
          }
        }
      }

      if (this.aura.activeTimer <= 0) {
        this.aura.activeTimer = 0;
        this._syncAuraMods(false);
        if (elem === 'fire' && up.fire_nova) {
          this._triggerFireNova();
        }
        if (this.player.mesh && this.player.mesh.setElementalAura) {
          this.player.mesh.setElementalAura(elem, false);
        }
      }
    } else if (this.aura.cooldownTimer > 0) {
      this.aura.cooldownTimer = Math.max(0, this.aura.cooldownTimer - dt);
    }
  }

  /** Devuelve el Coloso Elemental activo (si hay jefe en la oleada actual) */
  getActiveBoss() {
    return this.activeMonsters.find((m) => m.isAlive && m.monsterType === 'colossus') || null;
  }

  /** Actualiza todos los monstruos activos, el Aura Elemental y pilares luminosos */
  update(dt) {
    this._updateAuraTick(dt);

    for (let i = 0; i < this.activeMonsters.length; i++) {
      const m = this.activeMonsters[i];
      if (m) m.update(dt);
    }

    for (let i = this._spawnPillars.length - 1; i >= 0; i--) {
      const p = this._spawnPillars[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.dispose();
        this._spawnPillars.splice(i, 1);
      } else {
        const fade = Math.pow(1 - t, 1.35);
        for (const item of p.mats) {
          item.mat.opacity = item.baseOpacity * fade;
        }
        p.group.rotation.y += dt * 4.8;
        const s = 1 - t * 0.45;
        p.group.scale.set(s, 1 + t * 0.28, s);
        if (p.ringMesh) {
          p.ringMesh.scale.setScalar(1 + t * 0.45);
        }
      }
    }
  }
}
