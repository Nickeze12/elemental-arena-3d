import './style.css';
import * as THREE from 'three';
import { InputManager } from './core/InputManager.js';
import { ThirdPersonCamera } from './core/ThirdPersonCamera.js';
import { Arena } from './world/Arena.js';
import { ElementalMap } from './world/ElementalMap.js';
import { Player } from './entities/Player.js';
import { EnemyFighter } from './entities/EnemyFighter.js';
import { EnemyAI } from './ai/EnemyAI.js';
import { HUD } from './ui/HUD.js';
import { VFXManager } from './combat/VFXManager.js';
import { CombatManager } from './combat/CombatManager.js';
import { MatchManager } from './core/MatchManager.js';
import { SoundManager } from './audio/SoundManager.js';

/**
 * Punto de entrada: crea renderer, escena y sistemas, y ejecuta el bucle.
 */

const MAX_DELTA = 0.05; // Evita saltos de física tras pestañas inactivas

// ---------------- Renderer ----------------
const container = document.getElementById('game-container');
const initialTouchCap =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
const getTargetPixelRatio = (isTouch) => Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(getTargetPixelRatio(initialTouchCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
// Nota: desde Three.js r18x `PCFSoftShadowMap` fue eliminado (emite un aviso y
// cae a PCFShadowMap). En las versiones actuales `PCFShadowMap` ya aplica el
// filtrado suave (respeta `shadow.radius`), así que se usa directamente para
// obtener sombras suaves sin advertencias en consola.
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

// ---------------- Escena y cámara ----------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

// ---------------- Sistemas ----------------
const input = new InputManager(renderer.domElement);
const sound = new SoundManager();
const arena = new Arena(scene);
const elementalMap = new ElementalMap(scene);
const player = new Player(scene, arena, input);
const tpCamera = new ThirdPersonCamera(camera, player, arena);
const vfx = new VFXManager(scene, arena);
const combat = new CombatManager({ scene, arena, player, camera: tpCamera, vfx, sound });
const enemy = new EnemyFighter({ id: 'bot_1', theme: 'rival', scene, arena, combat, cooldownBonus: 0.95 });
const enemyAI = new EnemyAI({ enemy, player, arena, combat });
const hud = new HUD(document.getElementById('hud-root'));

// Números de daño flotantes sobre cualquier luchador golpeado + telemetría Dojo
const handleDamaged = (fighter, amount, isHeavy, kind = 'normal') => {
  const worldPos = fighter.position.clone();
  worldPos.y += 1.45;
  hud.spawnDamageNumber(worldPos, amount, isHeavy, fighter.id, kind);
  if (match) match.recordFighterDamage(fighter, amount);
};

const match = new MatchManager({
  player,
  enemy,
  enemyAI,
  combat,
  arena,
  elementalMap,
  camera: tpCamera,
  input,
  hud,
  sound,
  onFighterDamaged: handleDamaged,
});

player.setCombatManager(combat);
player.onDashStart = () => tpCamera.triggerFovBoost(5);
player.onSolarBlind = (duration = 2.0) => hud.triggerSolarBlind(duration);
tpCamera.extraAimTargets = () => combat.getAimTargets();
combat.onAbilityUsed = (abilityId) => hud.pulseCrosshair(abilityId);

// --- Hitstop (congelamiento breve de impacto para ataques pesados) ---
let hitstopTimer = 0;

/**
 * Congela o ralentiza drásticamente la simulación durante `duration` segundos
 * manteniendo el renderizado y la vibración de cámara activos.
 * @param {number} [duration=0.045]
 */
export function triggerHitstop(duration = 0.045) {
  hitstopTimer = Math.max(hitstopTimer, duration);
}

combat.onHitstop = (duration) => triggerHitstop(duration);

player.onDamaged = handleDamaged;
enemy.onDamaged = handleDamaged;

// Control de silencio (botón en HUD y tecla M)
hud.setSoundManager(sound);
hud.onToggleMute = () => sound.toggleMute();
sound.onMuteChange = (muted) => hud.setMuted(muted);

// Modo Táctil (auto-detectado + toggle manual + pausa táctil)
hud.setTouchInput(input);
hud.setTouchMode(input.isTouchMode);
hud.onToggleTouchMode = () => input.setTouchMode(!input.isTouchMode);
hud.onTouchPause = () => input.releaseLock();
hud.onTouchResume = () => input.requestLock();
input.onTouchModeChange = (enabled) => {
  renderer.setPixelRatio(getTargetPixelRatio(enabled));
  hud.setTouchMode(enabled);
};

input.onLockChange = (locked) => hud.setLocked(locked);
const onPlayerRespawnFx = () => {
  hud.clearSolarBlind();
  hud.flash();
  tpCamera.snap();
};
player.onRespawn = onPlayerRespawnFx;
player.onAbyssRespawn = onPlayerRespawnFx;

// ---------------- Redimensionado ----------------
const handleViewportResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(getTargetPixelRatio(input.isTouchMode));
  renderer.setSize(window.innerWidth, window.innerHeight);
  hud.updateOrientationNotice();
};
window.addEventListener('resize', handleViewportResize);
window.addEventListener('orientationchange', handleViewportResize);

// ---------------- Bucle principal ----------------
let lastTime = null;

function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime === null) lastTime = now;
  const dt = Math.min(Math.max(0, (now - lastTime) / 1000), MAX_DELTA);
  lastTime = now;

  // Atajo con tecla M para silenciar/activar audio y F1-F3 para Dojo en cualquier momento
  if (input.justPressed('KeyM')) {
    sound.toggleMute();
  }
  match.handleDojoHotkeys();

  // ¿Está el juego en pausa? (Cuando el usuario sale con Escape / sin PointerLock durante COUNTDOWN o FIGHTING)
  // En Online P2P o durante el breve COUNTDOWN de Supervivencia, la simulación no se congela
  const isOnlineMatch = match.isOnline;
  const isPaused =
    !isOnlineMatch &&
    !input.isLocked &&
    match.state !== 'GAME_OVER' &&
    match.state !== 'SELECT' &&
    match.state !== 'UPGRADE' &&
    !(match.format === 'survival' && match.state === 'COUNTDOWN');

  if (match.state === 'SELECT') {
    // Mientras se elige Maestro Elemental, la arena y las posturas en guardia respiran al fondo
    player.mesh.update(dt, { state: 'idle', speed: 0, verticalVelocity: 0 });
    for (const entry of match.enemies) {
      entry.fighter.mesh.update(dt, { state: 'idle', speed: 0, verticalVelocity: 0 });
    }
    hud.updateWorldBars(match.enemies, camera, true);
    hud.updateDirectionalIndicators(match.enemies, camera, true);
    if (match.arena) match.arena.update(dt, camera.position);
  } else if (match.state === 'UPGRADE') {
    match.update(dt);
    if (match.arena) match.arena.update(dt, camera.position);
    hud.updateDamageNumbers(dt, camera);
    hud.updateWorldBars([], camera, true);
    hud.updateDirectionalIndicators([], camera, true);
  } else if (!isPaused) {
    // Cámara lee el mouse cuando hay PointerLock activo para no perder sensibilidad durante hitstop
    if (input.isLocked) {
      tpCamera.handleInput(input);
    }

    // Durante el hitstop la física de combate se ralentiza drásticamente (5%)
    let simDt = dt;
    if (hitstopTimer > 0) {
      hitstopTimer = Math.max(0, hitstopTimer - dt);
      simDt = dt * 0.05;
    }

    match.update(simDt);
    player.update(simDt, tpCamera.yaw);
    match.updateCombatants(simDt);
    combat.update(simDt);
    tpCamera.update(dt);
    vfx.applyShake(tpCamera);
    if (match.arena) match.arena.update(dt, camera.position);
    hud.updateDamageNumbers(dt, camera);
    const worldActors =
      match.format === 'survival'
        ? [...match.enemies, ...match.getSurvivalMonstersForHud()]
        : match.enemies;
    hud.updateWorldBars(worldActors, camera, false);
    hud.updateDirectionalIndicators(worldActors, camera, false);
  } else if (match.state === 'GAME_OVER') {
    // Permite reiniciar con R o cambiar elemento con C desde la pantalla de fin de partida
    match.update(dt);
    if (match.arena) match.arena.update(dt, camera.position);
    hud.updateDamageNumbers(dt, camera);
    hud.updateWorldBars(match.enemies, camera, true);
    hud.updateDirectionalIndicators(match.enemies, camera, true);
  } else {
    hud.updateWorldBars(match.enemies, camera, true);
    hud.updateDirectionalIndicators(match.enemies, camera, true);
  }

  hud.setDashReadiness(player.dashReadiness);
  hud.setAbilities(combat.getAbilityStates());
  hud.setConfusedState(match.state === 'FIGHTING' && player.isAlive && player.isConfused);

  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);

// Acceso de depuración sólo en desarrollo
if (import.meta.env.DEV) {
  window.__game = {
    scene,
    camera,
    renderer,
    player,
    enemy,
    enemyAI,
    arena,
    elementalMap,
    input,
    tpCamera,
    vfx,
    combat,
    hud,
    match,
    sound,
    triggerHitstop,
    getHitstopTimer: () => hitstopTimer,
  };
}
