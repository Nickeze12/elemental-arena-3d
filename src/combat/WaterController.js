import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import { addOutline, createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import { createJaggedStalagmite } from '../utils/RockGeometry.js';
import {
  WATER_PALETTE,
  getWaterMaterials,
  createHydroWhipMesh,
  createWaterCometOrb,
  createCrystallineIceSpear,
  createBreakingTsunamiMesh,
  createWaterLakePatch,
} from '../utils/WaterGeometry.js';

/**
 * WaterController
 * ------------------------------------------------------------
 * Controlador refinado del Maestro Agua (Control, Hielo y Barrido) con
 * construcciones fluidas y cristalinas Cel-Shaded (`WaterGeometry.js`):
 *  1. Click Izq — Látigo de Agua (0.65s, 13 daño, alcance 6.8u / 10.2u sobre agua): cinta fluida
 *     con filamentos helicoidales y filo dentado de espuma, anillo de agua
 *     en la muñeca, estela húmeda en el piso y gotas tangenciales.
 *  2. Click Der — Órbita de Dos Gotas de Agua (6.0s, duración 4.0s): cometas
 *     acuáticos con anillos de corriente, cola fluida tangencial y aro de
 *     corriente en el suelo (9 daño, empuje 7.5 e intercepción de proyectiles).
 *  3. Tecla Q — Doble Lanza de Hielo (3.5s, 2 × 11 daño): sello hexagonal de
 *     escarcha al invocar, 2 jabalinas cristalinas con esquirlas orbitales,
 *     estela `spawnFrostTrail()`, `applyFreeze(1.5)` y púas en los pies.
 *  4. Tecla E — Maremoto Mejorado (6.4s, 24 daño, alcance 16u): ola rompiente
 *     ukiyo-e (5.6 × 2.7) con surcos animados, garras de espuma en la cresta
 *     y rastro continuo tipo lago de agua (5.0s) que potencia el Látigo.
 */

const ABILITIES = [
  { id: 'waterwhip', slot: 'primary', name: 'Látigo de Agua', key: 'Click Izq', cooldown: 0.65 },
  { id: 'waterorbit', slot: 'secondary', name: 'Órbita de Gotas', key: 'Click Der', cooldown: 6.0 },
  { id: 'icespears', slot: 'skill1', name: 'Lanzas de Hielo', key: 'Q', cooldown: 3.5 },
  { id: 'tidalwave', slot: 'skill2', name: 'Maremoto', key: 'E', cooldown: 6.4 },
];

const SLOT_TO_ID = {
  primary: 'waterwhip',
  secondary: 'waterorbit',
  skill1: 'icespears',
  skill2: 'tidalwave',
};

export class WaterController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'water';
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
      waterwhip: 0,
      waterorbit: 0,
      icespears: 0,
      tidalwave: 0,
    };

    this._whipRight = true;
    this._tasks = [];
    this._cleanups = new Set();

    this._initMaterials();
  }

  _initMaterials() {
    const wm = getWaterMaterials();
    this._waterDeepMat = wm.deepMat;
    this._waterTurquoiseMat = wm.turquoiseMat;
    this._foamMat = wm.foamMat;
    this._iceCrystalMat = wm.iceCoreMat;
    this._iceFinMat = wm.iceFinMat;
  }

  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive || this.fighter.isFrozen) return;

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

  update(dt) {
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

  reset() {
    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] = 0;
    }
    this._tasks.length = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  isReady(idOrSlot) {
    const key = SLOT_TO_ID[idOrSlot] || idOrSlot;
    return (this.cooldowns[key] ?? 0) <= 0;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
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
  //  1. Click Izquierdo — Látigo de Agua (cooldown: 0.65s, alcance 6.8u, ancho 2.0u, 13 daño)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (this.cooldowns.waterwhip > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.waterwhip = 0.65 + this.cooldownBonus;

    const whipFromRight = this._whipRight;
    this._whipRight = !this._whipRight;
    const sweepSign = whipFromRight ? 1 : -1;

    const yaw =
      customAimPoint && customAimPoint.isVector3
        ? Math.atan2(customAimPoint.x - this.fighter.position.x, customAimPoint.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.35);
    this.fighter.mesh.playAction(whipFromRight ? 'punch_right' : 'punch_left', 0.32);
    this.manager.notifyAbilityUsed('waterwhip', this.ownerId);
    if (this.sound) this.sound.playWaterWhip();

    // Látigo de agua fluido compuesto (cinta ahusada + 2 filamentos helicoidales + filo dentado de espuma)
    const whip = createHydroWhipMesh(22, sweepSign);
    whip.group.name = 'WaterWhip';
    this.scene.add(whip.group);

    // Anillo luminoso de corriente en la muñeca al lanzar el látigo
    const wristGeo = new THREE.RingGeometry(0.18, 0.38, 22);
    const wristMat = createEnergyVFXMaterial({
      coreColor: WATER_PALETTE.foam,
      rimColor: WATER_PALETTE.turquoise,
      opacity: 0.9,
      additive: true,
    });
    const wristRing = new THREE.Mesh(wristGeo, wristMat);
    const initFwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const initRight = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const initHand = this.fighter.position
      .clone()
      .addScaledVector(initRight, sweepSign * 0.42)
      .addScaledVector(initFwd, 0.55);
    initHand.y = this.fighter.position.y + 1.24;
    wristRing.position.copy(initHand);
    wristRing.lookAt(initHand.clone().add(initFwd));
    this.scene.add(wristRing);
    this.vfx.spawnAquaBurst(initHand, 1.0);

    const disposeWhip = () => {
      this.scene.remove(whip.group);
      this.scene.remove(wristRing);
      whip.dispose();
      wristGeo.dispose();
      wristMat.dispose();
    };
    this._cleanups.add(disposeWhip);

    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const onWater = this.fighter.isOnWaterSurface ? this.fighter.isOnWaterSurface() : false;
    const duration = 0.28;
    const maxRange = (onWater ? 10.2 : 6.8) * areaScale;
    const halfWidth = (onWater ? 1.18 : 1.0) * areaScale; // ancho base = 2.0u (mayor sobre agua)
    if (onWater && this.vfx) {
      this.vfx.spawnShockwave(
        this.fighter.position.clone().setY(this.fighter.position.y + 0.08),
        2.1,
        0.26,
        WATER_PALETTE.turquoiseLight
      );
    }
    let elapsed = 0;
    let splashTimer = 0;
    let wakeTimer = 0;
    const hitFighters = new Set();
    const hitWalls = new Set();

    const prevTip = new THREE.Vector3();
    const curTip = new THREE.Vector3();
    const tangDir = new THREE.Vector3();
    let hasPrevTip = false;

    this._tasks.push((dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      if (!this.fighter.isAlive || t >= 1) {
        this._cleanups.delete(disposeWhip);
        disposeWhip();
        return false;
      }

      const curYaw = this.fighter.yaw;
      const fwd = new THREE.Vector3(Math.sin(curYaw), 0, Math.cos(curYaw));
      const right = new THREE.Vector3(-Math.cos(curYaw), 0, Math.sin(curYaw));

      // Punto de anclaje en la mano adelantada del luchador
      const handOrigin = this.fighter.position
        .clone()
        .addScaledVector(right, sweepSign * 0.42)
        .addScaledVector(fwd, 0.55);
      handOrigin.y = this.fighter.position.y + 1.24;

      // Anillo en la muñeca que acompaña el lanzamiento y se disipa
      wristRing.position.copy(handOrigin);
      wristRing.scale.setScalar(1 + t * 1.45);
      wristMat.opacity = 0.9 * Math.max(0, 1 - t * 1.5);

      // Extensión rápida en la primera mitad y latigazo en arco horizontal/diagonal
      const reach = maxRange * Math.sin(Math.pow(t, 0.68) * Math.PI * 0.88);
      const sweepPhase = (t - 0.5) * 2; // -1 -> +1

      const sampleCurve = (s, out) => {
        const dist = s * reach;
        const wave = Math.sin(s * Math.PI * 1.45 - t * 7.2) * (0.98 * s) * sweepSign;
        const arc = sweepPhase * (1.28 * Math.pow(s, 1.15)) * -sweepSign;
        const latOffset = wave + arc;
        const diagY = (0.28 * (1 - s) - sweepPhase * 0.22 * s) * sweepSign;

        out
          .copy(handOrigin)
          .addScaledVector(fwd, dist)
          .addScaledVector(right, latOffset);
        out.y = handOrigin.y + diagY;
      };

      whip.updateCurve(sampleCurve, elapsed);

      // Estela curva de espuma en el suelo bajo el arco del látigo
      wakeTimer += dt;
      if (wakeTimer >= 0.06 && t > 0.14 && t < 0.85) {
        wakeTimer = 0;
        const groundSample = new THREE.Vector3();
        sampleCurve(0.68, groundSample);
        groundSample.y = 0;
        this.vfx.spawnWaterWake(groundSample, 1.9, 1.35, curYaw + sweepPhase * 0.45);
      }

      // Gotas tangenciales lanzadas desde la punta del látigo
      sampleCurve(0.96, curTip);
      splashTimer += dt;
      if (splashTimer >= 0.038 && t > 0.14 && t < 0.88) {
        splashTimer = 0;
        if (hasPrevTip) {
          tangDir.subVectors(curTip, prevTip);
          if (tangDir.lengthSq() > 1e-6) tangDir.normalize();
          else tangDir.copy(fwd);
        } else {
          tangDir.copy(fwd);
        }
        this.vfx.spawnDebris(curTip, {
          count: 4,
          speed: 7.4,
          size: 0.075,
          normal: tangDir,
          upBias: 0.45,
          spread: 0.16,
          angular: true,
          color: Math.random() > 0.4 ? WATER_PALETTE.foam : WATER_PALETTE.turquoise,
        });
        this.vfx.spawnDust(curTip, {
          count: 3,
          size: 0.45,
          speed: 2.2,
          life: 0.35,
          direction: tangDir.clone().multiplyScalar(2.4),
          color: WATER_PALETTE.foam,
          alpha: 0.8,
        });
      }
      prevTip.copy(curTip);
      hasPrevTip = true;

      // Ventana activa de golpe (t entre 0.12 y 0.82)
      if (t >= 0.12 && t <= 0.82) {
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f) || hitFighters.has(f.id)) continue;
          const dx = f.position.x - this.fighter.position.x;
          const dz = f.position.z - this.fighter.position.z;
          const localZ = dx * fwd.x + dz * fwd.z;
          const localX = dx * right.x + dz * right.z;

          if (
            localZ >= 0.3 &&
            localZ <= maxRange + f.config.radius &&
            Math.abs(localX) <= halfWidth + f.config.radius &&
            Math.abs(f.position.y - this.fighter.position.y) <= 1.8
          ) {
            // Verifica que no haya un pilar de la arena bloqueando en medio
            if (this._isBlockedByPillar(this.fighter.position, f.position)) continue;

            hitFighters.add(f.id);
            const pushDir = new THREE.Vector3(
              fwd.x * 0.82 - right.x * sweepSign * 0.35,
              0.22,
              fwd.z * 0.82 - right.z * sweepSign * 0.35
            ).normalize();

            f.takeDamage(13, pushDir, 8.0, this.ownerId);
            const hitPt = f.position.clone().setY(f.position.y + 1.05);
            this.vfx.spawnWaterSplash(hitPt, 14);
            this.vfx.addTrauma(0.16);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 13, hitPt);
          }
        }

        // También golpea muros dentro del barrido del látigo
        for (const w of this.manager.getActiveWalls()) {
          if (hitWalls.has(w)) continue;
          const dx = w.position.x - this.fighter.position.x;
          const dz = w.position.z - this.fighter.position.z;
          const localZ = dx * fwd.x + dz * fwd.z;
          const localX = dx * right.x + dz * right.z;
          if (localZ >= 0.4 && localZ <= maxRange && Math.abs(localX) <= halfWidth + 0.8) {
            hitWalls.add(w);
            w.takeDamage(28, w.position.clone().setY(1.0));
            this.vfx.spawnWaterSplash(w.position.clone().setY(1.0), 10);
          }
        }

        if (this.arena.damageBarrelsInSphere) {
          this.arena.damageBarrelsInSphere(curTip, 1.35, 15);
        }
      }

      return true;
    });

    return true;
  }

  /** Comprueba si el segmento entre `a` y `b` atraviesa algún obstáculo o muro */
  _isBlockedByPillar(a, b) {
    const arena = this.manager.arena || this.arena;
    const abX = b.x - a.x;
    const abZ = b.z - a.z;
    const lenSq = abX * abX + abZ * abZ;
    if (lenSq < 1e-4) return false;
    for (const p of arena.pillars) {
      const t = THREE.MathUtils.clamp(((p.x - a.x) * abX + (p.z - a.z) * abZ) / lenSq, 0, 1);
      const cx = a.x + abX * t;
      const cz = a.z + abZ * t;
      if (Math.hypot(p.x - cx, p.z - cz) < p.radius - 0.1) {
        return true;
      }
    }
    if (arena.boxColliders) {
      for (let i = 1; i <= 4; i++) {
        const s = i / 5;
        const sx = a.x + abX * s;
        const sz = a.z + abZ * s;
        for (const box of arena.boxColliders) {
          if (!box.blocksProjectile) continue;
          if (box.maxY > Math.max(a.y, b.y) + 0.6 && sx >= box.minX && sx <= box.maxX && sz >= box.minZ && sz <= box.maxZ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // ============================================================
  //  2. Click Derecho — Órbita de Dos Gotas de Agua (cooldown: 6.0s, duración 4.0s)
  // ============================================================
  trySecondary() {
    if (this.cooldowns.waterorbit > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.waterorbit = 6.0 + this.cooldownBonus;

    this.fighter.mesh.playAction('guard_wall', 0.48);
    this.manager.notifyAbilityUsed('waterorbit', this.ownerId);
    if (this.sound) this.sound.playWaterWhip();
    this.vfx.spawnAquaBurst(this.fighter.position.clone().setY(0.85), 1.85);

    const orbitRadius = 1.75;
    const orbitGroup = new THREE.Group();
    orbitGroup.name = 'WaterOrbit';
    this.scene.add(orbitGroup);

    // Anillo sutil de corriente giratoria en el suelo alrededor del jugador
    const floorRingGroup = new THREE.Group();
    const outerFloorGeo = new THREE.RingGeometry(orbitRadius - 0.16, orbitRadius + 0.14, 42);
    outerFloorGeo.rotateX(-Math.PI / 2);
    const outerFloorMat = createEnergyVFXMaterial({
      coreColor: WATER_PALETTE.turquoise,
      rimColor: WATER_PALETTE.foam,
      opacity: 0.44,
      additive: true,
    });
    const innerFloorGeo = new THREE.RingGeometry(orbitRadius - 0.04, orbitRadius + 0.03, 42);
    innerFloorGeo.rotateX(-Math.PI / 2);
    const innerFloorMat = createEnergyVFXMaterial({
      coreColor: WATER_PALETTE.foam,
      rimColor: WATER_PALETTE.turquoiseLight,
      opacity: 0.62,
      additive: true,
    });
    floorRingGroup.add(new THREE.Mesh(outerFloorGeo, outerFloorMat), new THREE.Mesh(innerFloorGeo, innerFloorMat));
    floorRingGroup.position.set(this.fighter.position.x, 0.048, this.fighter.position.z);
    orbitGroup.add(floorRingGroup);

    // Dos cometas acuáticos con anillos de corriente y cola fluida ondulante
    const droplets = [];
    for (let i = 0; i < 2; i++) {
      const comet = createWaterCometOrb(0.3);
      orbitGroup.add(comet.group);
      droplets.push({ group: comet.group, comet, worldPos: new THREE.Vector3() });
    }

    const disposeOrbit = () => {
      this.scene.remove(orbitGroup);
      for (const d of droplets) d.comet.dispose();
      outerFloorGeo.dispose();
      outerFloorMat.dispose();
      innerFloorGeo.dispose();
      innerFloorMat.dispose();
    };
    this._cleanups.add(disposeOrbit);

    const duration = 4.0;
    const angularSpeed = 5.4; // rad/s
    let age = 0;
    let trailTimer = 0;
    /** Cooldown de 0.65s por objetivo para evitar múltiples golpes en el mismo frame */
    const targetHitTimers = new Map();

    this._tasks.push((dt) => {
      age += dt;
      if (!this.fighter.isAlive || age >= duration) {
        this._cleanups.delete(disposeOrbit);
        disposeOrbit();
        return false;
      }

      for (const [fid, rem] of targetHitTimers.entries()) {
        if (rem - dt <= 0) targetHitTimers.delete(fid);
        else targetHitTimers.set(fid, rem - dt);
      }

      const center = this.fighter.position;
      const baseAngle = age * angularSpeed;
      const fadeK = age > duration - 0.5 ? Math.max(0, (duration - age) / 0.5) : 1;

      floorRingGroup.position.set(center.x, 0.048, center.z);
      floorRingGroup.rotation.y += dt * 3.2;
      outerFloorMat.opacity = 0.42 * fadeK;
      innerFloorMat.opacity = 0.56 * fadeK;

      for (let i = 0; i < 2; i++) {
        const angle = baseAngle + i * Math.PI;
        const d = droplets[i];
        const bobY = Math.sin(age * 6.2 + i * Math.PI) * 0.14;
        const wx = center.x + Math.cos(angle) * orbitRadius;
        const wy = center.y + 1.12 + bobY;
        const wz = center.z + Math.sin(angle) * orbitRadius;

        d.worldPos.set(wx, wy, wz);
        d.group.position.copy(d.worldPos);
        // Orienta el cometa (+Z cabeza, -Z cola fluida) en sentido tangencial a la órbita
        d.group.rotation.y = -angle;
        d.comet.update(dt, age + i * 0.9);

        // 1. Intercepta y disipa proyectiles básicos enemigos
        for (const p of this.manager.projectiles) {
          if (!p.alive || this.manager.isSameTeamIds(this.ownerId, p.ownerId)) continue;
          if (p.position.distanceTo(d.worldPos) <= 0.68 + p.radius) {
            p.alive = false;
            if (p.onExpire) p.onExpire(p);
            this.vfx.spawnWaterSplash(p.position, 10);
            if (this.sound) this.sound.playWaterWhip();
          }
        }

        // 2. Daña (9) y empuja radialmente (7.5) a enemigos que toquen la gota
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f)) continue;
          if (targetHitTimers.has(f.id)) continue;

          const dist2D = Math.hypot(f.position.x - wx, f.position.z - wz);
          const dy = Math.abs(f.position.y + 0.95 - wy);
          if (dist2D <= 0.62 + f.config.radius && dy <= 1.2) {
            targetHitTimers.set(f.id, 0.65);
            const radialDir = new THREE.Vector3(
              f.position.x - center.x,
              0.24,
              f.position.z - center.z
            );
            if (radialDir.lengthSq() < 1e-4) radialDir.set(Math.cos(angle), 0.24, Math.sin(angle));
            radialDir.normalize();

            f.takeDamage(9, radialDir, 7.5, this.ownerId);
            this.vfx.spawnWaterSplash(d.worldPos, 12);
            this.vfx.addTrauma(0.14);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 9, d.worldPos.clone());
          }
        }
      }

      trailTimer += dt;
      if (trailTimer >= 0.05) {
        trailTimer = 0;
        for (const d of droplets) {
          this.vfx.spawnDust(d.worldPos, {
            count: 1,
            size: 0.34,
            speed: 1.2,
            life: 0.28,
            spread: 0.1,
            color: '#eaf8ff',
            alpha: 0.72,
          });
        }
      }

      return true;
    });

    return true;
  }

  // ============================================================
  //  3. Tecla Q — Doble Lanza de Hielo (cooldown: 3.5s, 2 lanzas en línea, 11 daño + Freeze 1.5s)
  // ============================================================
  trySkill1(customAimPoint = null) {
    if (this.cooldowns.icespears > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.icespears = 3.5 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.55);
    this.fighter.mesh.playAction('punch_right', 0.38);
    this.manager.notifyAbilityUsed('icespears', this.ownerId);

    // Dispara la primera lanza inmediatamente y la segunda 0.18s después en línea recta
    this._fireSingleIceSpear(customAimPoint, 0);

    let delayTimer = 0.18;
    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) return false;
      delayTimer -= dt;
      if (delayTimer > 0) return true;

      this.fighter.mesh.playAction('punch_left', 0.36);
      this._fireSingleIceSpear(customAimPoint, 1);
      return false;
    });

    return true;
  }

  _fireSingleIceSpear(customAimPoint, index) {
    if (this.sound) this.sound.playIceSpears();

    const yaw = this.aimProvider.getAimYaw();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const sideSign = index === 0 ? -1 : 1;

    const spawnPos = this.fighter.position
      .clone()
      .addScaledVector(right, sideSign * 0.22)
      .addScaledVector(forward, 1.15);
    spawnPos.y = this.fighter.position.y + 1.32;

    const aimPoint =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const dir = aimPoint.sub(spawnPos).normalize();

    // Sello hexagonal breve de escarcha frente al lanzador al invocar la lanza
    this._spawnFrostHexSeal(spawnPos, dir);

    // Jabalina de cristal glaciar multi-pieza (núcleo hexagonal + 3 aletas + esquirlas orbitales)
    const spear = createCrystallineIceSpear(index);
    const spearGroup = spear.group;
    spearGroup.position.copy(spawnPos);
    spearGroup.lookAt(spawnPos.clone().add(dir));
    this.scene.add(spearGroup);

    let crystalTimer = 0;
    const proj = new Projectile({
      mesh: spearGroup,
      velocity: dir.multiplyScalar(45),
      radius: 0.34,
      gravity: 0.25,
      life: 2.1,
      damage: 11,
      knockback: 5.5,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'ice_spear_freeze',
      spin: new THREE.Vector3(0, 0, 14),
      onUpdate: (dt, p) => {
        spear.update(dt);
        crystalTimer += dt;
        if (crystalTimer >= 0.028) {
          crystalTimer = 0;
          this.vfx.spawnFrostTrail(p.position);
        }
      },
      onImpact: (hit) => {
        if (hit.type === 'wall' && hit.wall) {
          hit.wall.takeDamage(24, hit.point);
        }
        if (hit.type === 'fighter' && hit.fighter) {
          // Congela al enemigo durante 1.5 segundos y brotan púas de hielo en sus pies
          hit.fighter.applyFreeze(1.5, this.ownerId);
          this._spawnFootFreezeSpikes(hit.fighter.position, 1.5);
        }
        this.vfx.spawnIceShatter(hit.point, 16);
        this.vfx.spawnAquaBurst(hit.point, 1.8);
        this.vfx.addTrauma(0.14);
        spear.dispose();
      },
      onExpire: () => spear.dispose(),
    });

    this.manager.addProjectile(proj);
  }

  /** Sello / destello hexagonal breve frente al lanzador al conjurar lanza de hielo */
  _spawnFrostHexSeal(position, dir) {
    const sealGroup = new THREE.Group();
    sealGroup.position.copy(position);
    sealGroup.lookAt(position.clone().add(dir));

    const outerGeo = new THREE.RingGeometry(0.42, 0.56, 6);
    const innerGeo = new THREE.CircleGeometry(0.28, 6);
    const outerMat = new THREE.MeshBasicMaterial({
      color: WATER_PALETTE.iceCore,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: WATER_PALETTE.foam,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    sealGroup.add(new THREE.Mesh(outerGeo, outerMat), new THREE.Mesh(innerGeo, innerMat));
    sealGroup.scale.setScalar(0.35);
    this.scene.add(sealGroup);

    const disposeSeal = () => {
      this.scene.remove(sealGroup);
      outerGeo.dispose();
      innerGeo.dispose();
      outerMat.dispose();
      innerMat.dispose();
    };
    this._cleanups.add(disposeSeal);

    let age = 0;
    const duration = 0.24;
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / duration);
      sealGroup.rotation.z += dt * 10;
      sealGroup.scale.setScalar(0.35 + t * 1.1);
      outerMat.opacity = 0.9 * (1 - t);
      innerMat.opacity = 0.72 * (1 - t);
      if (t >= 1) {
        this._cleanups.delete(disposeSeal);
        disposeSeal();
        return false;
      }
      return true;
    });
  }

  /** Púas de hielo brotando alrededor de los pies del objetivo congelado */
  _spawnFootFreezeSpikes(basePos, duration = 1.5) {
    const spikeGroup = new THREE.Group();
    spikeGroup.position.set(basePos.x, 0, basePos.z);
    const spikeGeos = [];
    const count = 5;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + 0.3;
      const h = 0.55 + (i % 2) * 0.25;
      const sGeo = createJaggedStalagmite(h, 0.16, 400 + i * 29);
      spikeGeos.push(sGeo);
      const mesh = new THREE.Mesh(sGeo, i % 2 === 0 ? this._iceCrystalMat : this._iceFinMat);
      mesh.position.set(Math.cos(ang) * 0.52, -0.04, Math.sin(ang) * 0.52);
      mesh.rotation.set(Math.sin(ang) * 0.35, -ang, -Math.cos(ang) * 0.35);
      spikeGroup.add(mesh);
    }
    addOutline(spikeGroup, 0.01, WATER_PALETTE.outline);
    spikeGroup.position.y = -0.5;
    this.scene.add(spikeGroup);

    const disposeSpikes = () => {
      this.scene.remove(spikeGroup);
      for (const g of spikeGeos) g.dispose();
    };
    this._cleanups.add(disposeSpikes);

    let age = 0;
    this._tasks.push((dt) => {
      age += dt;
      if (age < 0.1) {
        spikeGroup.position.y = -0.5 * (1 - age / 0.1);
      } else if (age > duration - 0.18) {
        const k = (age - (duration - 0.18)) / 0.18;
        spikeGroup.position.y = -0.6 * k;
      } else {
        spikeGroup.position.y = 0;
      }
      if (age >= duration) {
        this._cleanups.delete(disposeSpikes);
        disposeSpikes();
        return false;
      }
      return true;
    });
  }

  // ============================================================
  //  4. Tecla E — Maremoto Mejorado (cooldown: 6.4s, ancho 5.5, alto 2.6, alcance 16u, 24 daño + charcos 3.0s)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (this.cooldowns.tidalwave > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.tidalwave = 6.4 + this.cooldownBonus;

    const yaw =
      customAimPoint && customAimPoint.isVector3
        ? Math.atan2(customAimPoint.x - this.fighter.position.x, customAimPoint.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.65);
    this.fighter.mesh.playAction('heavy_throw', 0.68);
    this.manager.notifyAbilityUsed('tidalwave', this.ownerId);
    if (this.sound) this.sound.playTidalWave();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const startPos = this.fighter.position.clone().addScaledVector(forward, 1.9);
    startPos.y = 0;

    // Ola rompiente ukiyo-e estilizada (5.6 × 2.7) con surcos animados y garras de espuma
    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const waveWidth = 5.6 * areaScale;
    const waveHeight = 2.7;
    const wave = createBreakingTsunamiMesh(waveWidth, waveHeight);
    const waveGroup = wave.group;
    waveGroup.name = 'TsunamiWave';
    waveGroup.position.copy(startPos);
    waveGroup.rotation.y = yaw;
    this.scene.add(waveGroup);
    this.vfx.spawnAquaBurst(startPos.clone().setY(0.45), 2.5);

    const disposeWave = () => {
      this.scene.remove(waveGroup);
      wave.dispose();
    };

    const maxDist = 16.0;
    const speed = 21.5;
    let waveAge = 0;
    let traveled = 0;
    let splashTimer = 0;
    let wakeTimer = 0;
    let puddleDist = 2.4; // Fuerza charco inicial al arrancar la ola
    const hitTargets = new Set();

    const hazard = {
      alive: true,
      ownerId: this.ownerId,
      dispose: () => {
        if (!hazard.alive) return;
        hazard.alive = false;
        disposeWave();
      },
      update: (dt) => {
        const arena = this.manager.arena || this.arena;
        waveAge += dt;
        const step = speed * dt;
        traveled += step;
        puddleDist += step;
        waveGroup.position.addScaledVector(forward, step);
        wave.update(dt, waveAge);

        if (puddleDist >= 1.75) {
          puddleDist = 0;
          this._spawnWaterPuddle(
            waveGroup.position.x,
            waveGroup.position.y + 1.5,
            waveGroup.position.z,
            waveWidth * 0.64,
            3.2,
            yaw,
            5.0
          );
        }

        if (traveled >= maxDist || (arena.isOutOfBounds && arena.isOutOfBounds(waveGroup.position.x, waveGroup.position.z, 0.4))) {
          this.vfx.spawnAquaBurst(waveGroup.position.clone().setY(0.85), 2.6);
          this.vfx.spawnWaterSplash(waveGroup.position.clone().setY(0.8), 18);
          hazard.dispose();
          return;
        }

        const hitBlocker = arena.getPillarAt(waveGroup.position.x, waveGroup.position.z, 1.1);
        if (hitBlocker && hitBlocker.top > 0.7) {
          this.vfx.spawnAquaBurst(waveGroup.position.clone().setY(1.1), 2.6);
          this.vfx.spawnWaterSplash(waveGroup.position.clone().setY(1.1), 18);
          hazard.dispose();
          return;
        }

        for (const w of this.manager.getActiveWalls()) {
          if (w.containsPoint2D(waveGroup.position.x, waveGroup.position.z, 1.35)) {
            w.takeDamage(75, waveGroup.position.clone().setY(1.0));
            this.vfx.spawnAquaBurst(waveGroup.position.clone().setY(1.0), 2.4);
            this.vfx.spawnWaterSplash(waveGroup.position.clone().setY(1.0), 16);
            hazard.dispose();
            return;
          }
        }

        // Rompe barriles alcanzados por la ola
        if (this.arena.damageBarrelsInSphere) {
          this.arena.damageBarrelsInSphere(waveGroup.position.clone().setY(0.6), waveWidth * 0.52, 20);
        }

        // Arrastre y empuje fuerte (24 daño, knockback 16.5 + hitstop)
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f)) continue;
          const dx = f.position.x - waveGroup.position.x;
          const dz = f.position.z - waveGroup.position.z;
          const localZ = dx * forward.x + dz * forward.z;
          const localX = -dx * forward.z + dz * forward.x;

          if (Math.abs(localX) <= waveWidth * 0.52 && Math.abs(localZ) <= 1.65 && f.position.y <= waveHeight) {
            f.position.addScaledVector(forward, step * 0.9);
            if (!hitTargets.has(f.id)) {
              hitTargets.add(f.id);
              const pushDir = new THREE.Vector3(forward.x, 0.24, forward.z).normalize();
              f.takeDamage(24, pushDir, 16.5, this.ownerId);
              const hitPt = f.position.clone().setY(f.position.y + 1.0);
              this.vfx.spawnAquaBurst(hitPt, 2.2);
              this.vfx.spawnWaterSplash(hitPt, 18);
              this.vfx.addTrauma(0.42);
              if (this.manager.onFighterHit) this.manager.onFighterHit(f, 24, hitPt);
              if (this.manager.onHitstop) this.manager.onHitstop(0.055);
            }
          }
        }

        // Rastro continuo de estela húmeda sobre el piso
        wakeTimer += dt;
        if (wakeTimer >= 0.085) {
          wakeTimer = 0;
          this.vfx.spawnWaterWake(waveGroup.position.clone().setY(0), waveWidth * 0.88, 1.6, yaw);
        }

        // Arcos de espuma y gotas expulsadas desde la cresta superior y la base
        splashTimer += dt;
        if (splashTimer >= 0.042) {
          splashTimer = 0;
          const sideOff = (Math.random() - 0.5) * waveWidth * 0.85;
          const rightVec = new THREE.Vector3(-forward.z, 0, forward.x);
          const crestPos = waveGroup.position
            .clone()
            .addScaledVector(rightVec, sideOff)
            .addScaledVector(forward, 1.35);
          crestPos.y = waveHeight - 0.1;

          this.vfx.spawnDebris(crestPos, {
            count: 3,
            speed: 7.5,
            size: 0.09,
            normal: forward.clone().add(new THREE.Vector3(0, 0.5, 0)).normalize(),
            upBias: 0.8,
            spread: 0.35,
            angular: true,
            color: Math.random() > 0.35 ? WATER_PALETTE.foam : WATER_PALETTE.turquoise,
          });
          this.vfx.spawnDust(crestPos, {
            count: 3,
            size: 0.65,
            speed: 2.5,
            life: 0.42,
            direction: forward.clone().multiplyScalar(3.5),
            color: WATER_PALETTE.foam,
            alpha: 0.82,
          });
        }
      },
      getHitbox: () => null,
    };

    this.manager.addHazard(hazard);
    this.vfx.addTrauma(0.24);
    return true;
  }

  /** Crea un parche orgánico tipo lago de 5.0s a lo largo del recorrido del Maremoto */
  _spawnWaterPuddle(x, yHint, z, width = 3.6, length = 3.2, yaw = 0, duration = 5.0) {
    const arena = this.manager.arena || this.arena;
    if (arena.isOutOfBounds && arena.isOutOfBounds(x, z, 0.35)) return;
    const gy = arena.getGroundHeightAt
      ? arena.getGroundHeightAt(x, yHint, z)
      : 0;
    if (arena.hasAbyss !== false && (!Number.isFinite(gy) || gy < -4)) return;
    const groundY = Number.isFinite(gy) ? Math.max(0, gy) : 0;

    const lake = createWaterLakePatch(width, length, Math.random() * 100);
    const lakeGroup = lake.group;
    lakeGroup.name = 'TidalWaterLakePatch';
    lakeGroup.position.set(x, groundY + 0.032, z);
    lakeGroup.rotation.y = yaw + (Math.random() - 0.5) * 0.32;
    this.scene.add(lakeGroup);

    const puddleRecord = {
      x,
      y: groundY,
      z,
      radius: Math.max(width, length) * 0.52,
      alive: true,
    };
    if (!this.manager.waterPuddles) this.manager.waterPuddles = [];
    this.manager.waterPuddles.push(puddleRecord);

    let age = 0;
    const puddleHazard = {
      alive: true,
      ownerId: this.ownerId,
      tag: 'water_puddle',
      dispose: () => {
        if (!puddleHazard.alive) return;
        puddleHazard.alive = false;
        puddleRecord.alive = false;
        if (this.manager.waterPuddles) {
          const idx = this.manager.waterPuddles.indexOf(puddleRecord);
          if (idx >= 0) this.manager.waterPuddles.splice(idx, 1);
        }
        this.scene.remove(lakeGroup);
        lake.dispose();
      },
      update: (dt) => {
        age += dt;
        if (age >= duration) {
          puddleHazard.dispose();
          return;
        }
        const intro = Math.min(1, age / 0.18);
        const outro = age > duration - 0.6 ? Math.max(0, (duration - age) / 0.6) : 1;
        const k = intro * outro;
        lakeGroup.scale.setScalar(0.65 + 0.35 * intro);
        lake.update(age, k);
      },
      getHitbox: () => null,
    };

    this.manager.addHazard(puddleHazard);
  }
}
