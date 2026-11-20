import * as THREE from 'three';
import { mulberry32 } from '../world/Arena.js';
import { Projectile } from './Projectile.js';
import { EarthWall } from './EarthWall.js';
import { addOutline } from '../utils/ToonMaterial.js';
import {
  ROCK_PALETTE,
  getRockMaterials,
  createStoneSlab,
  createTectonicShardCluster,
  createRuggedBoulder,
  createFloatingRockDisc,
} from '../utils/RockGeometry.js';

/**
 * EarthController
 * ------------------------------------------------------------
 * Implementa las 4 habilidades del Maestro Tierra con estilo Cel-Shaded / Anime
 * y construcciones compuestas de roca tectónica estratificada:
 *  1. Ataque básico — Laja Tectónica (Click Izq, 0.85 s, 12 daño): cráter en
 *     el suelo, laja fracturada con piedritas orbitales; cada impacto sobre un
 *     enemigo acumula 1 roca flotante por 5.5 s y al juntar 3 rocas atrapa medio
 *     cuerpo en roca dejando al enemigo inmóvil por 3.0 s.
 *  2. Defensa — Muro Tectónico Escalonado / Salto Montaña (Click Der):
 *     invoca un muro de tierra (4.5 s); mientras el muro siga activo el botón
 *     cambia a «Salto Montaña» para crear una plataforma bajo el jugador (3.0 s).
 *     Cuando el muro desaparece, inicia 3.0 s de cooldown y vuelve a Muro Tierra.
 *  3. Habilidad 1 — Onda Sísmica Dentada (Tecla Q, 4.5 s, 20 daño): fisura
 *     dentada y luminosa en el suelo + 6 racimos de agujas inclinadas hacia adelante.
 *  4. Habilidad 2 — Peñasco Colosal Tectónico (Tecla E, 7.0 s, 30 daño): cráter
 *     de invocación, núcleo poliédrico con estrías, vetas ámbar que se enfrían
 *     en vuelo y 4-6 fragmentos orbitales; doble onda expansiva y lluvia de esquirlas.
 */

const ABILITIES = [
  { id: 'rock', slot: 'primary', name: 'Disco Roca', key: 'Click Izq', cooldown: 0.85 },
  { id: 'wall', slot: 'secondary', name: 'Muro Tierra', key: 'Click Der', cooldown: 3.0 },
  { id: 'seismic', slot: 'skill1', name: 'Onda Sísmica', key: 'Q', cooldown: 4.5 },
  { id: 'boulder', slot: 'skill2', name: 'Peñasco', key: 'E', cooldown: 7.0 },
];

const SLOT_TO_ID = {
  primary: 'rock',
  secondary: 'wall',
  skill1: 'seismic',
  skill2: 'boulder',
};

export class EarthController {
  /**
   * @param {import('./CombatManager.js').CombatManager} manager
   * @param {import('../entities/BaseFighter.js').BaseFighter} [fighter]
   * @param {{getAimYaw: () => number, getAimPoint: (maxDist?: number) => THREE.Vector3}} [aimProvider]
   * @param {number} [cooldownBonus=0] tiempo extra de recarga (p. ej. +0.35s para la IA)
   */
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'earth';
    this.manager = manager;
    this.scene = manager.scene;
    this.arena = manager.arena;
    this.fighter = fighter;
    this.ownerId = fighter.id;
    this.vfx = manager.vfx;
    this.sound = manager.sound;
    this.cooldownBonus = cooldownBonus;

    this.aimProvider = aimProvider || {
      getAimYaw: () => manager.camera.yaw,
      getAimPoint: (maxDist = 80) => manager.camera.getAimPoint(maxDist),
    };

    this.cooldowns = {
      rock: 0,
      wall: 0,
      seismic: 0,
      boulder: 0,
    };

    /** Alterna puño derecho e izquierdo en el ataque básico */
    this._punchRight = true;

    /** Muro activo creado por este luchador para habilitar Salto Montaña */
    this._activeWall = null;
    this._mountainJumpUsed = false;

    /** Tareas diferidas (levantamiento de rocas, secuencias sísmicas, etc.) */
    this._tasks = [];
    /** Funciones de limpieza para abortar tareas en curso al reiniciar partida */
    this._cleanups = new Set();

    this._initMaterials();
  }

  _initMaterials() {
    // Paleta de granito/pizarra en 3 tonos (#495059 / #68717c / #8c96a3)
    const rock = getRockMaterials();
    this._shadowGraniteMat = rock.shadowMat;
    this._graniteMat = rock.midMat;
    this._highlightGraniteMat = rock.highlightMat;

    // Destello ámbar plano en la grieta del suelo al brotar
    this._groundGlowMat = new THREE.MeshBasicMaterial({
      color: '#ff9b26',
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // ============================================================
  //  Entrada y actualización
  // ============================================================

  /** @param {import('../core/InputManager.js').InputManager} input */
  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive) return;

    if (input.mouseJustPressed(0) || input.isMouseDown(0)) {
      this.tryPrimary();
    }
    if (input.mouseJustPressed(2)) {
      this.trySecondary();
    }
    if (input.justPressed('KeyQ')) {
      this.trySkill1();
    }
    if (input.justPressed('KeyE')) {
      this.trySkill2();
    }
  }

  /** Interfaz unificada para los 4 elementos */
  tryPrimary(aimPoint = null) {
    return this.castRockShot(aimPoint);
  }

  trySecondary(aimPointOrYaw = null) {
    if (this._activeWall && this._activeWall.alive) {
      return this.castMountainJump();
    }
    const yaw = typeof aimPointOrYaw === 'number'
      ? aimPointOrYaw
      : aimPointOrYaw && aimPointOrYaw.isVector3
      ? Math.atan2(aimPointOrYaw.x - this.fighter.position.x, aimPointOrYaw.z - this.fighter.position.z)
      : null;
    return this.castEarthWall(yaw);
  }

  trySkill1(aimPointOrYaw = null) {
    const yaw = typeof aimPointOrYaw === 'number'
      ? aimPointOrYaw
      : aimPointOrYaw && aimPointOrYaw.isVector3
      ? Math.atan2(aimPointOrYaw.x - this.fighter.position.x, aimPointOrYaw.z - this.fighter.position.z)
      : null;
    return this.castSeismicWave(yaw);
  }

  trySkill2(aimPoint = null) {
    return this.castColossalBoulder(aimPoint);
  }

  _syncActiveWallState() {
    if (this._activeWall && !this._activeWall.alive) {
      this._activeWall = null;
      this._mountainJumpUsed = false;
      this.cooldowns.wall = 3.0 + this.cooldownBonus;
    }
  }

  update(dt) {
    this._syncActiveWallState();

    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) {
        this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      }
    }

    for (let i = this._tasks.length - 1; i >= 0; i--) {
      const keep = this._tasks[i](dt);
      if (!keep) this._tasks.splice(i, 1);
    }
  }

  /** Reinicia todos los cooldowns y cancela tareas en curso */
  reset() {
    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] = 0;
    }
    this._activeWall = null;
    this._mountainJumpUsed = false;
    this._tasks.length = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  /** ¿La habilidad está lista para usarse? Acepta id ('rock') o slot ('primary') */
  isReady(idOrSlot) {
    if (idOrSlot === 'mountainjump') {
      return Boolean(this._activeWall && this._activeWall.alive && !this._mountainJumpUsed);
    }
    if (idOrSlot === 'secondary') {
      if (this._activeWall && this._activeWall.alive) {
        return !this._mountainJumpUsed;
      }
      return (this.cooldowns.wall ?? 0) <= 0;
    }
    if (idOrSlot === 'wall') {
      return !(this._activeWall && this._activeWall.alive) && (this.cooldowns.wall ?? 0) <= 0;
    }
    const key = SLOT_TO_ID[idOrSlot] || idOrSlot;
    return (this.cooldowns[key] ?? 0) <= 0;
  }

  /** Devuelve el estado de las 4 habilidades para el HUD */
  getAbilityStates() {
    this._syncActiveWallState();
    const hasWall = Boolean(this._activeWall && this._activeWall.alive);
    return ABILITIES.map((ab) => {
      if (ab.id === 'wall' && hasWall) {
        const canJump = !this._mountainJumpUsed;
        return {
          id: 'mountainjump',
          slot: ab.slot,
          name: 'Salto Montaña',
          key: ab.key,
          cooldown: 3.0,
          remaining: 0,
          readiness: canJump ? 1 : 0,
          ready: canJump,
        };
      }
      const totalCd = ab.cooldown + this.cooldownBonus;
      const rem = this.cooldowns[ab.id];
      return {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: totalCd,
        remaining: rem,
        readiness: 1 - Math.min(1, rem / totalCd),
        ready: rem <= 0,
      };
    });
  }

  // ============================================================
  //  1. Ataque Básico — Disco / Laja de Piedra Facetada (Click Izq, 0.85s)
  // ============================================================
  castRockShot(customAimPoint = null) {
    if (this.cooldowns.rock > 0 || !this.fighter.isAlive) return false;
    this.cooldowns.rock = 0.85 + this.cooldownBonus;
    const useRight = this._punchRight;
    this._punchRight = !this._punchRight;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.38);
    this.fighter.mesh.playAction(useRight ? 'punch_right' : 'punch_left', 0.34);
    this.manager.notifyAbilityUsed('rock', this.ownerId);

    const sideSign = useRight ? -1 : 1;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

    const groundOrigin = this.fighter.position
      .clone()
      .addScaledVector(right, -sideSign * 0.8)
      .addScaledVector(forward, 0.6);
    groundOrigin.y = Math.max(0, this.fighter.position.y);

    // Laja fracturada irregular de 9-11 lados con piedritas orbitales
    const floatingDisc = createFloatingRockDisc(0.55, 0.22, Math.random() * 1000);
    const discRoot = floatingDisc.group;

    discRoot.position.copy(groundOrigin);
    discRoot.position.y += 0.1;
    discRoot.scale.setScalar(0.25);
    this.scene.add(discRoot);

    this.vfx.spawnGroundCrater(groundOrigin, 1.0, 1.9);
    this.vfx.spawnDust(groundOrigin, { count: 8, size: 0.55, speed: 2.2, spread: 0.35, ring: true });
    this.vfx.spawnDebris(groundOrigin, {
      count: 7,
      speed: 4.5,
      size: 0.08,
      upBias: 1.5,
      spread: 0.25,
      angular: true,
      color: ROCK_PALETTE.mid,
    });
    if (this.sound) this.sound.playRockSummon();

    const cleanup = () => {
      this.scene.remove(discRoot);
      floatingDisc.dispose();
    };
    this._cleanups.add(cleanup);

    const riseDuration = 0.1;
    let elapsed = 0;
    const startPos = groundOrigin.clone();

    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      elapsed += dt;
      const t = Math.min(1, elapsed / riseDuration);
      const ease = 1 - (1 - t) * (1 - t);

      const launchPos = this.fighter.position
        .clone()
        .addScaledVector(right, -sideSign * 0.65)
        .addScaledVector(forward, 0.95);
      launchPos.y = this.fighter.position.y + 1.32;

      discRoot.position.lerpVectors(startPos, launchPos, ease);
      discRoot.scale.setScalar(0.25 + 0.75 * ease);
      floatingDisc.discMesh.rotation.z = (1 - ease) * 0.85 * sideSign;
      floatingDisc.discMesh.rotation.y += dt * 16;
      floatingDisc.orbitGroup.rotation.y -= dt * 14;

      if (t < 1) return true;

      this._cleanups.delete(cleanup);
      if (this.sound) this.sound.playRockThrow();
      const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
      const dir = aimPoint.sub(discRoot.position).normalize();
      const speed = 38;

      discRoot.rotation.set(-dir.y * 0.35, discRoot.rotation.y, 0.18 * sideSign);

      let age = 0;
      let trailTimer = 0;
      const proj = new Projectile({
        mesh: discRoot,
        velocity: dir.multiplyScalar(speed),
        radius: 0.42,
        gravity: 2.2,
        life: 2.4,
        damage: 12,
        knockback: 6.5,
        owner: this.fighter,
        ownerId: this.ownerId,
        tag: 'rock_basic',
        onUpdate: (pdt, p) => {
          age += pdt;
          floatingDisc.discMesh.rotation.y += pdt * 20;
          floatingDisc.orbitGroup.rotation.y -= pdt * 16;
          floatingDisc.orbitGroup.rotation.x = Math.sin(age * 9) * 0.3;
          discRoot.rotation.z = Math.sin(age * 6) * 0.16 * sideSign;

          trailTimer += pdt;
          if (trailTimer >= 0.028) {
            trailTimer = 0;
            this.vfx.spawnDust(p.position, { count: 2, size: 0.36, speed: 0.75, life: 0.35, alpha: 0.48 });
            this.vfx.spawnDebris(p.position, {
              count: 1,
              speed: 1.8,
              size: 0.05,
              upBias: 0.1,
              spread: 0.25,
              angular: true,
              life: 0.35,
              color: ROCK_PALETTE.shadow,
            });
          }
        },
        onImpact: (hit) => {
          if (hit.type === 'wall' && hit.wall) {
            hit.wall.takeDamage(25, hit.point);
          }
          if (hit.type === 'fighter' && hit.fighter && hit.fighter.applyEarthRockHit) {
            hit.fighter.applyEarthRockHit(this.ownerId);
          }
          this.vfx.rockImpact(hit.point, hit.normal, 1.05);
          this.vfx.spawnDebris(hit.point, {
            count: 6,
            speed: 7.4,
            size: 0.09,
            normal: hit.normal,
            spread: 0.22,
            angular: true,
            color: ROCK_PALETTE.highlight,
          });
          this.vfx.addTrauma(0.12);
          floatingDisc.dispose();
        },
        onExpire: () => floatingDisc.dispose(),
      });
      this.manager.addProjectile(proj);
      return false;
    });
    return true;
  }

  // ============================================================
  //  2. Defensa — Muro de Tierra (Click Derecho -> desbloquea Salto Montaña)
  // ============================================================
  castEarthWall(customYaw = null) {
    if ((this._activeWall && this._activeWall.alive) || this.cooldowns.wall > 0 || !this.fighter.isAlive) {
      return false;
    }
    this.cooldowns.wall = 0;
    const yaw = customYaw ?? this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.65);
    this.fighter.mesh.playAction('guard_wall', 0.65);
    this.manager.notifyAbilityUsed('wall', this.ownerId);

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const wallDist = 3.4;
    const pos = this.fighter.position.clone().addScaledVector(forward, wallDist);

    const arena = this.manager.arena || this.arena;
    if (arena.clampToPlayableArea) {
      arena.clampToPlayableArea(pos, 1.5);
    }

    const pillar = arena.getPillarAt(pos.x, pos.z, EarthWall.THICKNESS);
    if (pillar) {
      const dx = pos.x - pillar.x;
      const dz = pos.z - pillar.z;
      const d = Math.hypot(dx, dz) || 1;
      const minD = pillar.radius + EarthWall.THICKNESS + 0.3;
      pos.x = pillar.x + (dx / d) * minD;
      pos.z = pillar.z + (dz / d) * minD;
    }
    const wallGround = arena.getGroundHeightAt
      ? arena.getGroundHeightAt(pos.x, this.fighter.position.y + 1.0, pos.z)
      : 0;
    pos.y = Number.isFinite(wallGround) ? Math.max(0, wallGround) : 0;

    const wall = new EarthWall({
      scene: this.scene,
      arena,
      vfx: this.vfx,
      position: pos,
      yaw,
      lifetime: 4.5,
      health: 100,
      owner: this.fighter,
      ownerId: this.ownerId,
    });
    this.manager.addWall(wall);
    this._activeWall = wall;
    this._mountainJumpUsed = false;
    this.vfx.addTrauma(0.22);
    if (this.sound) this.sound.playWallRaise();
    return true;
  }

  /**
   * 2b. Salto Montaña (sólo disponible mientras haya un Muro de Tierra propio activo):
   * crea una plataforma de tierra bajo el jugador (tamaño ~2 jugadores, duración 3.0s).
   */
  castMountainJump() {
    if (
      !this._activeWall ||
      !this._activeWall.alive ||
      this._mountainJumpUsed ||
      !this.fighter.isAlive
    ) {
      return false;
    }

    this._mountainJumpUsed = true;
    this.fighter.mesh.playAction('stomp_seismic', 0.42);
    this.manager.notifyAbilityUsed('wall', this.ownerId);
    if (this.sound) this.sound.playWallRaise();

    const cx = this.fighter.position.x;
    const cz = this.fighter.position.z;
    const wasOnGround = !!this.fighter.onGround;
    const topY = wasOnGround
      ? Math.max(0.4, this.fighter.position.y + 3.45)
      : Math.max(0.3, this.fighter.position.y + 0.65);

    // Impulso / elevación táctica más alta sobre la plataforma
    this.fighter.position.y = topY + 0.06;
    this.fighter.velocity.y = Math.max(this.fighter.velocity.y, wasOnGround ? 7.2 : 6.0);
    this.fighter.onGround = false;

    const arena = this.manager.arena || this.arena;
    const halfSize = 1.1; // Ancho total 2.2 u (~2 jugadores de diámetro 0.90 u)
    const thickness = 0.56;
    const bottomY = topY - thickness;
    const duration = 3.0;
    const seed = Math.random() * 1000;
    const geos = [];

    const platGroup = new THREE.Group();
    platGroup.name = 'MountainJumpPlatform';
    platGroup.position.set(cx, bottomY, cz);

    // Losa tectónica principal tamaño 2 jugadores + contrafuertes inferiores
    const mainGeo = createStoneSlab(halfSize * 2, thickness, halfSize * 2, seed, 0.14);
    geos.push(mainGeo);
    const mainMesh = new THREE.Mesh(mainGeo, this._graniteMat);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    addOutline(mainMesh, 0.013, ROCK_PALETTE.outline);
    platGroup.add(mainMesh);

    const baseRimGeo = createStoneSlab(halfSize * 1.72, thickness * 0.65, halfSize * 1.72, seed + 19, -0.2);
    geos.push(baseRimGeo);
    const baseRim = new THREE.Mesh(baseRimGeo, this._shadowGraniteMat);
    baseRim.position.y = -thickness * 0.48;
    addOutline(baseRim, 0.011, ROCK_PALETTE.outline);
    platGroup.add(baseRim);

    // Pequeñas esquirlas de apoyo colgando bajo la losa flotante
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.45;
      const spurGeo = createStoneSlab(0.42, 0.36, 0.36, seed + 50 + i * 17, 0.35);
      geos.push(spurGeo);
      const spur = new THREE.Mesh(spurGeo, i % 2 === 0 ? this._highlightGraniteMat : this._shadowGraniteMat);
      spur.position.set(Math.cos(ang) * (halfSize * 0.72), -0.18, Math.sin(ang) * (halfSize * 0.72));
      spur.rotation.y = ang;
      addOutline(spur, 0.01, ROCK_PALETTE.outline);
      platGroup.add(spur);
    }

    platGroup.scale.set(0.35, 0.35, 0.35);
    this.scene.add(platGroup);

    const burstCenter = new THREE.Vector3(cx, topY - 0.1, cz);
    this.vfx.spawnShockwave(burstCenter, 2.4, 0.34, '#d9822b');
    this.vfx.spawnDust(burstCenter, { count: 12, size: 0.78, speed: 2.8, spread: 0.9, ring: true });
    this.vfx.spawnDebris(burstCenter, {
      count: 10,
      speed: 4.8,
      size: 0.09,
      upBias: 0.9,
      angular: true,
      color: ROCK_PALETTE.highlight,
    });
    this.vfx.addTrauma(0.2);

    const platformObstacle = {
      alive: true,
      isSolid: true,
      halfSize,
      topY,
      bottomY,
      position: new THREE.Vector3(cx, bottomY, cz),
      getTopAt(x, z, currentY) {
        if (!platformObstacle.alive) return -Infinity;
        if (currentY < topY - 0.55) return -Infinity;
        if (Math.abs(x - cx) <= halfSize + 0.26 && Math.abs(z - cz) <= halfSize + 0.26) {
          return topY;
        }
        return -Infinity;
      },
      resolveCylinder(pos, radius, vel, prevY) {
        if (!platformObstacle.alive) return;
        if (prevY >= topY - 0.35) return;
        if (pos.y + 1.65 <= bottomY || pos.y >= topY) return;

        const clampedX = THREE.MathUtils.clamp(pos.x, cx - halfSize, cx + halfSize);
        const clampedZ = THREE.MathUtils.clamp(pos.z, cz - halfSize, cz + halfSize);
        let dx = pos.x - clampedX;
        let dz = pos.z - clampedZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-6) {
          if (dist >= radius) return;
          const push = radius - dist;
          dx /= dist;
          dz /= dist;
          pos.x += dx * push;
          pos.z += dz * push;
          if (vel) {
            const vn = vel.x * dx + vel.z * dz;
            if (vn < 0) {
              vel.x -= vn * dx;
              vel.z -= vn * dz;
            }
          }
        }
      },
    };
    arena.addObstacle(platformObstacle);

    let age = 0;
    const platHazard = {
      alive: true,
      ownerId: this.ownerId,
      tag: 'earth_mountain_platform',
      obstacle: platformObstacle,
      position: platformObstacle.position,
      dispose: () => {
        if (!platHazard.alive) return;
        platHazard.alive = false;
        platformObstacle.alive = false;
        arena.removeObstacle(platformObstacle);
        this.scene.remove(platGroup);
        for (const g of geos) g.dispose();
      },
      update: (dt) => {
        age += dt;
        if (age >= duration) {
          const breakPt = new THREE.Vector3(cx, topY - 0.15, cz);
          this.vfx.spawnDebris(breakPt, {
            count: 14,
            speed: 4.5,
            size: 0.1,
            upBias: 0.7,
            spread: 1.0,
            angular: true,
            color: ROCK_PALETTE.mid,
          });
          this.vfx.spawnDust(breakPt, { count: 10, size: 0.75, speed: 2.2, spread: 0.8 });
          platHazard.dispose();
          return;
        }
        const grow = Math.min(1, age / 0.12);
        const ease = 1 - Math.pow(1 - grow, 3);
        const sXZ = 0.35 + 0.65 * ease;
        platGroup.scale.set(sXZ, sXZ, sXZ);
        if (duration - age < 0.45) {
          const jitter = (0.45 - (duration - age)) * 0.08;
          platGroup.position.x = cx + (Math.random() - 0.5) * jitter;
          platGroup.position.z = cz + (Math.random() - 0.5) * jitter;
        }
      },
      getHitbox: () => null,
    };

    this.manager.addHazard(platHazard);
    return true;
  }

  // ============================================================
  //  3. Habilidad 1 — Onda Sísmica: Estalagmitas Facetadas (Tecla Q, 4.5s)
  // ============================================================
  castSeismicWave(customYaw = null) {
    if (this.cooldowns.seismic > 0 || !this.fighter.isAlive) return false;
    this.cooldowns.seismic = 4.5 + this.cooldownBonus;
    const yaw = customYaw ?? this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.68);
    this.fighter.mesh.playAction('stomp_seismic', 0.68);
    this.manager.notifyAbilityUsed('seismic', this.ownerId);

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const origin = this.fighter.position.clone().addScaledVector(forward, 1.8);
    origin.y = 0;

    let stompTimer = 0.2;
    let stompDone = false;
    const totalSpikes = 6;
    const maxDist = 14;
    const stepDist = (maxDist - 1.8) / Math.max(1, totalSpikes - 1);
    const interval = 0.06;
    let nextIndex = 0;
    let waveTimer = 0;

    const hitTargets = new Set();

    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) return false;
      if (!stompDone) {
        stompTimer -= dt;
        if (stompTimer > 0) return true;
        stompDone = true;
        this.vfx.spawnGroundCrater(origin, 1.5, 1.8);
        this.vfx.spawnFissureLine(origin, forward, maxDist - 1.5, 1.85, 0.3);
        this.vfx.spawnDust(origin, { count: 12, size: 0.75, speed: 3.0, ring: true, spread: 0.35 });
        this.vfx.spawnShockwave(origin, 2.8, 0.42, '#ff9b26');
        this.vfx.addTrauma(0.28);
      }

      waveTimer -= dt;
      while (waveTimer <= 0 && nextIndex < totalSpikes) {
        const arena = this.manager.arena || this.arena;
        const pos = origin.clone().addScaledVector(forward, nextIndex * stepDist);
        const surfY = arena.getGroundHeightAt
          ? arena.getGroundHeightAt(pos.x, this.fighter.position.y + 1.2, pos.z)
          : 0;
        pos.y = Number.isFinite(surfY) ? Math.max(0, surfY) : 0;

        if (arena.isOutOfBounds && arena.isOutOfBounds(pos.x, pos.z, 0.6)) {
          return false;
        }

        const pillar = arena.getPillarAt(pos.x, pos.z, 0.45);
        if (pillar && pillar.top > pos.y + 0.5) {
          const hitNormal = new THREE.Vector3(pos.x - pillar.x, 0, pos.z - pillar.z).normalize();
          this.vfx.rockImpact(pos.clone().setY(pos.y + 0.8), hitNormal, 1.4);
          this.vfx.spawnShockwave(pos, 2.2, 0.35);
          this.vfx.addTrauma(0.32);
          return false;
        }

        for (const w of this.manager.getActiveWalls()) {
          if (w.containsPoint2D(pos.x, pos.z, 0.35)) {
            w.takeDamage(50, pos.clone().setY(0.8));
            this.vfx.rockImpact(pos.clone().setY(0.8), forward.clone().negate(), 1.2);
            return false;
          }
        }

        this._spawnSeismicSpike(pos, yaw, nextIndex, totalSpikes, hitTargets);

        nextIndex++;
        waveTimer += interval;
      }

      return nextIndex < totalSpikes;
    });
    return true;
  }

  _spawnSeismicSpike(position, yaw, index, totalSpikes, hitTargets) {
    const rng = mulberry32(Math.floor(Math.random() * 1e9));
    // Alturas variadas entre 1.9 y 2.7 unidades
    const progress = index / Math.max(1, totalSpikes - 1);
    const height = 1.9 + progress * 0.65 + (rng() - 0.5) * 0.25;
    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const baseRadius = (0.38 + progress * 0.1) * areaScale;

    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = yaw + (rng() - 0.5) * 0.28;

    const body = new THREE.Group();
    group.add(body);

    // Racimo de 3 a 4 agujas/lajas tectónicas entrelazadas inclinadas hacia adelante
    const cluster = createTectonicShardCluster(height, baseRadius, rng() * 1000 + index * 23);
    cluster.group.rotation.x = 0.2 + progress * 0.14;
    cluster.group.rotation.z = (rng() - 0.5) * 0.16;
    body.add(cluster.group);

    // Destello ámbar en la fractura del suelo al brotar
    const glowGeo = new THREE.RingGeometry(baseRadius * 0.45, baseRadius * 1.45, 16);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = this._groundGlowMat.clone();
    const glowRing = new THREE.Mesh(glowGeo, glowMat);
    glowRing.position.y = 0.04;
    glowRing.userData.noOutline = true;
    group.add(glowRing);

    body.position.y = -height;
    this.scene.add(group);

    this.vfx.spawnGroundCrater(position, baseRadius * 2.25, 1.35);
    this.vfx.spawnDust(position, { count: 9, size: 0.65, speed: 2.5, life: 0.75, ring: true, spread: 0.25 });
    this.vfx.spawnDebris(position.clone().setY(0.15), {
      count: 7,
      speed: 5.5,
      size: 0.09,
      upBias: 1.45,
      spread: 0.25,
      angular: true,
      color: ROCK_PALETTE.shadow,
    });
    this.vfx.addTrauma(0.06);
    if (this.sound) this.sound.playSeismicStep(index);

    const riseTime = 0.12;
    const holdTime = 0.65;
    const sinkTime = 0.28;
    const totalLife = riseTime + holdTime + sinkTime;
    let age = 0;

    const hitbox = {
      type: 'sphere',
      tag: 'seismic_spike',
      owner: this.fighter,
      ownerId: this.ownerId,
      position: position.clone().setY(height * 0.42),
      radius: baseRadius * 1.35,
      damage: 20,
      knockback: 11.5,
      direction: new THREE.Vector3(Math.sin(yaw), 0.55, Math.cos(yaw)).normalize(),
      hitTargets,
      source: null,
    };

    const disposeSpike = () => {
      this.scene.remove(group);
      cluster.dispose();
      glowGeo.dispose();
      glowMat.dispose();
    };

    const hazard = {
      alive: true,
      ownerId: this.ownerId,
      dispose: () => {
        if (!hazard.alive) return;
        hazard.alive = false;
        disposeSpike();
      },
      update: (dt) => {
        age += dt;
        if (age >= totalLife) {
          hazard.alive = false;
          this.vfx.spawnDebris(position.clone().setY(0.25), {
            count: 7,
            speed: 3.8,
            size: 0.1,
            upBias: 0.85,
            angular: true,
            color: ROCK_PALETTE.shadow,
          });
          disposeSpike();
          return;
        }
        let vis = 1;
        if (age < riseTime) {
          const t = age / riseTime;
          vis = 1 - (1 - t) * (1 - t);
        } else if (age > riseTime + holdTime) {
          const t = (age - riseTime - holdTime) / sinkTime;
          vis = 1 - t * t;
        }
        body.position.y = -height * (1 - vis);
        glowMat.opacity = 0.72 * Math.max(0, 1 - age / (riseTime + holdTime * 0.45));
      },
      getHitbox: () => (age < riseTime + holdTime * 0.65 ? hitbox : null),
    };
    hitbox.source = hazard;
    this.manager.addHazard(hazard);
  }

  // ============================================================
  //  4. Habilidad 2 — Peñasco Colosal de Granito Facetado (Tecla E, 7.0s)
  // ============================================================
  castColossalBoulder(customAimPoint = null) {
    if (this.cooldowns.boulder > 0 || !this.fighter.isAlive) return false;
    this.cooldowns.boulder = 7.0 + this.cooldownBonus;
    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.8);
    this.fighter.mesh.playAction('heavy_throw', 0.8);
    this.manager.notifyAbilityUsed('boulder', this.ownerId);

    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const radius = 1.1 * areaScale;
    const rng = mulberry32(Math.floor(Math.random() * 1e9));

    const outerGroup = new THREE.Group();
    const boulder = createRuggedBoulder(radius, rng() * 1000);
    outerGroup.add(boulder.group);

    // 4 a 6 fragmentos de roca orbitando alrededor por magnetismo terrestre
    const orbitRing = new THREE.Group();
    const orbitGeos = [];
    const orbitCount = 4 + Math.floor(rng() * 3); // 4..6 fragmentos
    const orbitMats = [this._shadowGraniteMat, this._graniteMat, this._highlightGraniteMat];
    for (let i = 0; i < orbitCount; i++) {
      const sz = 0.16 + rng() * 0.1;
      const chunkGeo = createStoneSlab(sz * 1.4, sz * 1.0, sz * 1.2, rng() * 600 + i * 19, 0.5);
      chunkGeo.translate(0, -sz * 0.5, 0);
      orbitGeos.push(chunkGeo);

      const chunk = new THREE.Mesh(chunkGeo, orbitMats[i % orbitMats.length]);
      const angle = (i / orbitCount) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const orbitR = radius * (1.42 + rng() * 0.35);
      chunk.position.set(
        Math.cos(angle) * orbitR,
        (rng() - 0.5) * 0.72,
        Math.sin(angle) * orbitR
      );
      chunk.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      chunk.castShadow = true;
      addOutline(chunk, 0.011, ROCK_PALETTE.outline);
      orbitRing.add(chunk);
    }
    outerGroup.add(orbitRing);

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const groundSpawn = this.fighter.position.clone().addScaledVector(forward, 1.9);
    groundSpawn.y = Math.max(0, this.fighter.position.y);

    outerGroup.position.copy(groundSpawn);
    outerGroup.scale.setScalar(0.15);
    this.scene.add(outerGroup);

    // Cráter grande al levantar el peñasco del suelo + partículas de tierra ascendiendo
    this.vfx.spawnGroundCrater(groundSpawn, 2.35, 2.6);
    this.vfx.spawnDust(groundSpawn, { count: 16, size: 1.0, speed: 3.2, spread: 0.7, ring: true });
    this.vfx.spawnShockwave(groundSpawn, 2.7, 0.38, '#d9822b');
    this.vfx.addTrauma(0.2);
    if (this.sound) this.sound.playBoulderCharge();

    const windup = 0.25;
    let elapsed = 0;

    const disposeAll = () => {
      boulder.dispose();
      for (const g of orbitGeos) g.dispose();
    };
    const cleanup = () => {
      this.scene.remove(outerGroup);
      disposeAll();
    };
    this._cleanups.add(cleanup);

    let chargeDustTimer = 0;
    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      elapsed += dt;
      const t = Math.min(1, elapsed / windup);
      const ease = 1 - Math.pow(1 - t, 3);

      const curYaw = this.aimProvider.getAimYaw();
      this.fighter.faceDirection(curYaw, 0.2);
      const curForward = new THREE.Vector3(Math.sin(curYaw), 0, Math.cos(curYaw));
      const holdPos = this.fighter.position.clone().addScaledVector(curForward, 2.1);
      holdPos.y = this.fighter.position.y + 1.85;

      outerGroup.position.lerpVectors(groundSpawn, holdPos, ease);
      outerGroup.scale.setScalar(0.15 + 0.85 * ease);
      boulder.group.rotation.x += dt * 7;
      boulder.group.rotation.y += dt * 9;
      orbitRing.rotation.y += dt * 11;
      orbitRing.rotation.z = Math.sin(elapsed * 14) * 0.28;

      chargeDustTimer += dt;
      if (chargeDustTimer >= 0.045) {
        chargeDustTimer = 0;
        this.vfx.spawnDebris(groundSpawn, {
          count: 3,
          speed: 6.2,
          size: 0.085,
          upBias: 2.2,
          spread: 0.55,
          angular: true,
          color: ROCK_PALETTE.mid,
        });
        this.vfx.spawnDust(groundSpawn, { count: 3, size: 0.65, speed: 1.5, direction: new THREE.Vector3(0, 3.2, 0) });
      }

      if (t < 1) return true;

      this._cleanups.delete(cleanup);
      if (this.sound) this.sound.playRockThrow();
      const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
      const toTarget = aimPoint.clone().sub(outerGroup.position);
      const dist = toTarget.length();
      const speed = 28;
      const gravity = 9.5;
      const flightTime = Math.min(2.2, dist / speed);

      const vel = toTarget.normalize().multiplyScalar(speed);
      vel.y += 0.5 * gravity * flightTime;

      let flightAge = 0;
      let trailTimer = 0;

      const proj = new Projectile({
        mesh: outerGroup,
        velocity: vel,
        radius,
        gravity,
        life: 3.5,
        damage: 30,
        knockback: 15,
        owner: this.fighter,
        ownerId: this.ownerId,
        tag: 'colossal_boulder',
        onUpdate: (pdt, p) => {
          flightAge += pdt;
          // Giro pesado + enfriamiento gradual de grietas ámbar + órbita magnética de escombros
          boulder.group.rotation.x += pdt * 6.5;
          boulder.group.rotation.y += pdt * 8.0;
          boulder.group.rotation.z += pdt * 4.0;
          orbitRing.rotation.y -= pdt * 10.5;
          orbitRing.rotation.x += pdt * 4.5;
          boulder.setCoolFactor(Math.min(1, flightAge / 1.8));

          trailTimer += pdt;
          if (trailTimer >= 0.022) {
            trailTimer = 0;
            this.vfx.spawnDust(p.position, { count: 3, size: 0.72, speed: 1.4, life: 0.55, alpha: 0.58, spread: 0.45 });
            this.vfx.spawnDebris(p.position, {
              count: 2,
              speed: 3.0,
              size: 0.075,
              upBias: 0.2,
              spread: 0.55,
              angular: true,
              color: Math.random() > 0.5 ? ROCK_PALETTE.shadow : ROCK_PALETTE.mid,
            });
          }
        },
        onImpact: (hit) => {
          if (hit.type === 'wall' && hit.wall) {
            hit.wall.takeDamage(120, hit.point);
          }
          if (this.sound) this.sound.playBoulderExplosion();

          const craterGround = hit.point.clone().setY(0);
          this.vfx.spawnGroundCrater(craterGround, 2.75, 2.7);
          this.vfx.rockImpact(hit.point, hit.normal, 2.5);
          // Decenas de esquirlas de roca rebotando en 3 tonos de granito
          this.vfx.spawnDebris(hit.point, {
            count: 26,
            speed: 9.8,
            size: 0.14,
            normal: hit.normal,
            upBias: 1.1,
            spread: 0.55,
            angular: true,
            color: ROCK_PALETTE.highlight,
          });
          this.vfx.spawnDebris(hit.point, {
            count: 18,
            speed: 8.2,
            size: 0.12,
            normal: hit.normal,
            upBias: 0.9,
            spread: 0.55,
            angular: true,
            color: ROCK_PALETTE.shadow,
          });
          this.vfx.spawnDust(hit.point, {
            count: 28,
            size: 1.4,
            speed: 5.8,
            spread: 1.15,
            life: 1.5,
            alpha: 0.65,
            ring: true,
          });
          // Doble onda expansiva de tierra
          this.vfx.spawnShockwave(hit.point, 5.2, 0.56, '#d9822b');
          this.vfx.spawnShockwave(hit.point, 3.6, 0.36, '#e9c46a');
          this.vfx.addTrauma(0.55);
          disposeAll();
        },
        onExpire: disposeAll,
      });

      this.manager.addProjectile(proj);
      this.vfx.addTrauma(0.18);
      return false;
    });
    return true;
  }
}
