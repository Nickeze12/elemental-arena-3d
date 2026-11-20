import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import { createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import {
  STORM_PALETTE,
  createZigzagBoltData,
  createStormBoltGroup,
  createThunderCloudGroup,
  createVerticalLightningGroup,
} from '../utils/StormGeometry.js';

/**
 * StormController
 * ----------------------------------------------------------------------
 * Implementa las 4 habilidades del 7.º Maestro Elemental (Tormenta):
 *  1. Click Izq (`stormbolt`)      — Descarga Voltaica (11 daño, 0.55s CD, proyectil eléctrico rápido)
 *  2. Click Der (`mistform`)       — Forma de Niebla mantenida (hasta 4.0s invulnerable, +55% vel, flota ~0.9u; soltar cancela e inicia 7.5s CD)
 *  3. Tecla Q (`chainlightning`)   — Relámpago Encadenado (14 daño inicial hasta 24u + encadena a 2 rivales en 8.5u por 9 daño, 7.5s CD)
 *  4. Tecla E (`thundercloud`)     — Nube de Trueno (hasta 20u, nube a 5.5u de altura durante 3.0s, 3 rayos cada 0.8s en 2.1u de 11 daño, 9.5s CD)
 */

const ABILITIES = [
  { id: 'stormbolt', slot: 'primary', name: 'Descarga Voltaica', key: 'Click Izq', cooldown: 0.95 },
  { id: 'mistform', slot: 'secondary', name: 'Forma de Niebla', key: 'Click Der', cooldown: 7.0 },
  { id: 'chainlightning', slot: 'skill1', name: 'Relámpago Encadenado', key: 'Q', cooldown: 7.5 },
  { id: 'thundercloud', slot: 'skill2', name: 'Nube de Trueno', key: 'E', cooldown: 9.5 },
];

const MIST_MAX_DURATION = 4.0;
const MIST_COOLDOWN = 7.0;
const CHAIN_INITIAL_RANGE = 24.0;
const CHAIN_HOP_RANGE = 8.5;
const CLOUD_HEIGHT = 6.8;
const CLOUD_DURATION = 3.0;
const CLOUD_STRIKE_TIMES = [0.6, 1.4, 2.2];
const CLOUD_DETERMINISTIC_OFFSETS = [
  [0, 0],
  [1.25, -0.9],
  [-1.15, 1.05],
];

export class StormController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'storm';
    this.usesHeldSecondary = true;
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
      stormbolt: 0,
      mistform: 0,
      chainlightning: 0,
      thundercloud: 0,
    };

    this._mistTrailTimer = 0;
    this._tasks = [];
    this._cleanups = new Set();
  }

  /** @param {import('../core/InputManager.js').InputManager} input */
  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive || this.fighter.isFrozen) {
      if (this.fighter.isMistFormActive) {
        this.endMistForm();
      }
      return;
    }

    if (this.fighter.isMistFormActive) {
      if (!input.isSecondaryHeld()) {
        this.endMistForm();
      }
      return;
    }

    if (input.isSecondaryHeld() || input.mouseJustPressed(2)) {
      if (this.trySecondary()) return;
    }

    if (input.mouseJustPressed(0) || input.isMouseDown(0)) this.tryPrimary();
    if (input.justPressed('KeyQ')) this.trySkill1();
    if (input.justPressed('KeyE')) this.trySkill2();
  }

  isReady(slot) {
    const ab = ABILITIES.find((a) => a.slot === slot || a.id === slot);
    if (!ab) return false;
    if (this.fighter.isMistFormActive) return false;
    return this.cooldowns[ab.id] <= 0 && this.fighter.isAlive && !this.fighter.isFrozen;
  }

  _getMistCooldownTotal() {
    const cdMult = this.fighter.survivalMods?.mistCooldownMult || 1;
    return (MIST_COOLDOWN + (this.cooldownBonus || 0)) * cdMult;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      if (ab.id === 'mistform' && this.fighter.isMistFormActive) {
        const maxDur = this.fighter.mistFormMaxDuration || MIST_MAX_DURATION;
        const rem = Math.max(0, this.fighter.mistFormTimer);
        return {
          id: ab.id,
          slot: ab.slot,
          name: ab.name,
          key: ab.key,
          cooldown: maxDur,
          remaining: rem,
          readiness: maxDur > 0 ? Math.max(0, Math.min(1, rem / maxDur)) : 0,
          active: true,
          activeRatio: maxDur > 0 ? Math.max(0, Math.min(1, rem / maxDur)) : 0,
          ready: false,
        };
      }

      const rem = Math.max(0, this.cooldowns[ab.id]);
      const total =
        ab.id === 'mistform' ? this._getMistCooldownTotal() : ab.cooldown + (this.cooldownBonus || 0);
      return {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: total,
        remaining: rem,
        readiness: total > 0 ? Math.max(0, Math.min(1, 1 - rem / total)) : 1,
        active: false,
        activeRatio: 0,
        ready: rem <= 0 && !this.fighter.isFrozen && !this.fighter.isMistFormActive,
      };
    });
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) {
        this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      }
    }

    if (this.fighter.isMistFormActive) {
      if (!this.fighter.isAlive || this.fighter.isFrozen) {
        this.endMistForm();
      } else {
        this.fighter.mistFormTimer = Math.max(0, this.fighter.mistFormTimer - dt);
        this._mistTrailTimer -= dt;
        if (this._mistTrailTimer <= 0 && this.vfx) {
          this._mistTrailTimer = 0.11;
          this.vfx.spawnDust(this.fighter.position.clone().setY(this.fighter.position.y + 0.7), {
            count: 2,
            size: 0.65,
            speed: 1.4,
            spread: 0.4,
            life: 0.36,
            color: STORM_PALETTE.mistSilver,
            alpha: 0.65,
          });
        }
        if (this.fighter.mistFormTimer <= 0) {
          this.endMistForm();
          if (this.manager.onLocalAbilityCast && this.ownerId === this.manager.player?.id) {
            this.manager.onLocalAbilityCast(
              'mist_end',
              this.fighter.position,
              this.aimProvider.getAimPoint(80),
              this.aimProvider.getAimYaw()
            );
          }
        }
      }
    }

    for (let i = this._tasks.length - 1; i >= 0; i--) {
      if (!this._tasks[i](dt)) {
        this._tasks.splice(i, 1);
      }
    }
  }

  reset() {
    if (this.fighter.isMistFormActive) {
      this.fighter.isMistFormActive = false;
      this.fighter.mistFormTimer = 0;
      if (this.fighter.mesh && this.fighter.mesh.setMistForm) {
        this.fighter.mesh.setMistForm(false);
      }
    }
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = 0;
    this._tasks.length = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  // ============================================================
  //  1. Click Izq — Descarga Voltaica (11 daño, 0.55s CD)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (
      this.fighter.isMistFormActive ||
      this.cooldowns.stormbolt > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen
    ) {
      return false;
    }
    this.cooldowns.stormbolt = 0.95 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.32);
    this.fighter.mesh.playAction('punch_right', 0.24);
    this.manager.notifyAbilityUsed('stormbolt', this.ownerId);
    if (this.sound && this.sound.playStormBolt) this.sound.playStormBolt();

    const overload = !!this.fighter.survivalMods?.auraStormOverload;
    if (overload) {
      this._spawnVoltBolt(customAimPoint, -0.07, 1.25);
      this._spawnVoltBolt(customAimPoint, 0.07, 1.25);
    } else {
      this._spawnVoltBolt(customAimPoint, 0, 1.0);
    }
    return true;
  }

  _spawnVoltBolt(customAimPoint, angleOffset = 0, damageScale = 1.0) {
    const yaw = this.aimProvider.getAimYaw();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.1);
    spawnPos.y = this.fighter.position.y + 1.34;

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();
    if (angleOffset !== 0) {
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset).normalize();
    }

    const bolt = createStormBoltGroup(1.3, 0.075, false);
    bolt.group.position.copy(spawnPos);
    bolt.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(bolt.group);

    let trailT = 0;
    const proj = new Projectile({
      mesh: bolt.group,
      velocity: dir.multiplyScalar(54),
      radius: 0.28,
      gravity: 0.04,
      life: 1.2,
      damage: Math.round(11 * damageScale),
      knockback: 5.4,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'storm_bolt',
      onUpdate: (dt, p) => {
        bolt.group.rotation.z += dt * 16;
        trailT -= dt;
        if (trailT <= 0 && this.vfx) {
          trailT = 0.032;
          this.vfx.spawnDust(p.position, {
            count: 1,
            size: 0.26,
            speed: 0.6,
            life: 0.2,
            color: STORM_PALETTE.electricBlue,
            alpha: 0.85,
          });
        }
      },
      onImpact: (_hit, p) => {
        if (this.vfx) {
          this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 0.95, STORM_PALETTE.boltGold);
        }
        bolt.dispose();
      },
      onExpire: () => bolt.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  2. Click Der (Mantenida) — Forma de Niebla
  //     (hasta 4.0s invulnerable, flota ~0.9u, +55% vel; soltar cancela e inicia 7.5s CD)
  // ============================================================
  trySecondary() {
    if (
      this.fighter.isMistFormActive ||
      this.cooldowns.mistform > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen
    ) {
      return false;
    }

    this.fighter.isMistFormActive = true;
    this.fighter.mistFormMaxDuration = MIST_MAX_DURATION;
    this.fighter.mistFormTimer = MIST_MAX_DURATION;
    this.fighter.isDashing = false;
    this.fighter._dashTime = 0;

    if (this.fighter.mesh && this.fighter.mesh.setMistForm) {
      this.fighter.mesh.setMistForm(true);
    }
    if (this.sound && this.sound.playStormMistStart) {
      this.sound.playStormMistStart();
    }
    if (this.vfx) {
      this.vfx.spawnShockwave(this.fighter.position, 2.2, 0.28, STORM_PALETTE.electricBlue);
      this.vfx.spawnDust(this.fighter.position.clone().setY(this.fighter.position.y + 0.9), {
        count: 10,
        size: 0.78,
        speed: 3.4,
        spread: 0.6,
        life: 0.48,
        color: STORM_PALETTE.mistSilver,
      });
    }
    this.manager.notifyAbilityUsed('mistform', this.ownerId);
    return true;
  }

  /** Cancela la Forma de Niebla al instante e inicia su cooldown */
  endMistForm() {
    if (!this.fighter.isMistFormActive) return false;

    this.fighter.isMistFormActive = false;
    this.fighter.mistFormTimer = 0;
    this.cooldowns.mistform = this._getMistCooldownTotal();

    if (this.fighter.mesh && this.fighter.mesh.setMistForm) {
      this.fighter.mesh.setMistForm(false);
    }
    if (this.sound && this.sound.playStormMistEnd) {
      this.sound.playStormMistEnd();
    }
    if (this.vfx) {
      this.vfx.spawnDust(this.fighter.position.clone().setY(this.fighter.position.y + 0.8), {
        count: 9,
        size: 0.7,
        speed: 3.2,
        spread: 0.55,
        life: 0.42,
        color: STORM_PALETTE.mistSilver,
      });
    }

    // Mejora única de Supervivencia: Paso Espectral (descarga eléctrica al salir de la niebla)
    if (this.fighter.survivalMods?.mistExitDischarge && this.fighter.isAlive) {
      const areaMult = this.fighter.survivalMods?.areaMult || 1;
      const dischargeRadius = 4.6 * areaMult;
      if (this.sound && this.sound.playStormChain) this.sound.playStormChain();
      if (this.vfx) {
        this.vfx.spawnShockwave(this.fighter.position, dischargeRadius * 1.15, 0.34, STORM_PALETTE.boltGold);
      }
      const center = this.fighter.position.clone().setY(this.fighter.position.y + 0.9);
      const pushDir = new THREE.Vector3();
      for (const f of this.manager.fighters) {
        if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
        const dx = f.position.x - center.x;
        const dz = f.position.z - center.z;
        const dy = Math.abs(f.position.y - this.fighter.position.y);
        if (Math.hypot(dx, dz) <= dischargeRadius + (f.config?.radius || 0.5) && dy <= 3.2) {
          pushDir.set(dx, 0, dz);
          if (pushDir.lengthSq() < 1e-4) pushDir.set(0, 0, 1);
          pushDir.normalize().setY(0.38).normalize();
          f.takeDamage(14, pushDir, 10.5, this.ownerId);
          this._spawnLightningArc(center, f.position.clone().setY(f.position.y + 1.05), 31, true);
        }
      }
    }
    return true;
  }

  // ============================================================
  //  3. Tecla Q — Relámpago Encadenado
  //     (24u alcance, 14 daño directo + salta hasta 2 rivales extra en 8.5u por 9 daño, 7.5s CD)
  // ============================================================
  trySkill1(customAimPoint = null) {
    if (
      this.fighter.isMistFormActive ||
      this.cooldowns.chainlightning > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen
    ) {
      return false;
    }
    this.cooldowns.chainlightning = 7.5 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.38);
    this.fighter.mesh.playAction('punch_left', 0.32);
    this.manager.notifyAbilityUsed('chainlightning', this.ownerId);
    if (this.sound && this.sound.playStormChain) this.sound.playStormChain();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const origin = this.fighter.position.clone().addScaledVector(forward, 1.0);
    origin.y = this.fighter.position.y + 1.35;

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(origin).normalize();

    let maxRange = CHAIN_INITIAL_RANGE;
    const arena = this.manager.arena || this.arena;
    if (arena && arena.raycast) {
      const hitWall = arena.raycast(origin, dir, CHAIN_INITIAL_RANGE);
      if (hitWall && hitWall.distance < maxRange) {
        maxRange = hitWall.distance;
      }
    }

    // Buscar primer objetivo hostil cerca del rayo hasta 24u
    let primaryTarget = null;
    let bestAlong = maxRange + 1;
    const toTarget = new THREE.Vector3();
    const closestOnRay = new THREE.Vector3();
    for (const f of this.manager.fighters) {
      if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
      const centerY = f.position.y + (f.monsterType === 'colossus' ? 1.55 : 1.05);
      toTarget.set(f.position.x - origin.x, centerY - origin.y, f.position.z - origin.z);
      const along = toTarget.dot(dir);
      if (along < 0.3 || along > maxRange) continue;
      closestOnRay.copy(origin).addScaledVector(dir, along);
      const perpDist = closestOnRay.distanceTo(
        new THREE.Vector3(f.position.x, centerY, f.position.z)
      );
      const hitTol = (f.config?.radius || 0.55) + 0.95;
      if (perpDist <= hitTol && along < bestAlong) {
        bestAlong = along;
        primaryTarget = f;
      }
    }

    if (!primaryTarget) {
      const missEnd = origin.clone().addScaledVector(dir, maxRange);
      this._spawnLightningArc(origin, missEnd, 11, false);
      if (this.vfx) {
        this.vfx.spawnHitSparks(missEnd, dir.clone().negate(), 0.75, STORM_PALETTE.electricBlue);
      }
      return true;
    }

    const hitSet = new Set([primaryTarget]);
    let prevPoint = new THREE.Vector3(
      primaryTarget.position.x,
      primaryTarget.position.y + 1.05,
      primaryTarget.position.z
    );
    this._spawnLightningArc(origin, prevPoint, 17, false);

    const pushDir = dir.clone().setY(0.32).normalize();
    primaryTarget.takeDamage(12, pushDir, 7.6, this.ownerId);
    if (this.vfx) {
      this.vfx.spawnHitSparks(prevPoint, pushDir, 1.05, STORM_PALETTE.boltGold);
    }

    // Encadenar hasta 2 enemigos adicionales en 8.5u (3 en total con Sobrecarga Voltaica)
    const maxBounces = this.fighter.survivalMods?.auraStormOverload ? 3 : 2;
    for (let bounce = 0; bounce < maxBounces; bounce++) {
      let nextTarget = null;
      let nextDist = CHAIN_HOP_RANGE;
      for (const f of this.manager.fighters) {
        if (!f || hitSet.has(f) || !this.manager.isHostile(this.ownerId, f)) continue;
        const tPos = new THREE.Vector3(f.position.x, f.position.y + 1.05, f.position.z);
        const d = prevPoint.distanceTo(tPos);
        if (d <= nextDist) {
          nextDist = d;
          nextTarget = f;
        }
      }
      if (!nextTarget) break;

      hitSet.add(nextTarget);
      const nextPoint = new THREE.Vector3(nextTarget.position.x, nextTarget.position.y + 1.05, nextTarget.position.z);
      this._spawnLightningArc(prevPoint, nextPoint, 29 + bounce * 19, true);

      const bouncePush = nextPoint.clone().sub(prevPoint);
      bouncePush.y = 0;
      if (bouncePush.lengthSq() < 1e-4) bouncePush.copy(forward);
      bouncePush.normalize().setY(0.28).normalize();
      nextTarget.takeDamage(7, bouncePush, 5.2, this.ownerId);
      if (this.vfx) {
        this.vfx.spawnHitSparks(nextPoint, bouncePush, 0.9, STORM_PALETTE.electricBlue);
      }
      prevPoint = nextPoint;
    }

    return true;
  }

  _spawnLightningArc(start, end, seed = 11, isChain = false) {
    const coreBuild = createZigzagBoltData(start, end, {
      segments: 8,
      jitter: isChain ? 0.34 : 0.42,
      radius: isChain ? 0.045 : 0.062,
      seed,
    });
    const haloBuild = createZigzagBoltData(start, end, {
      segments: 8,
      jitter: isChain ? 0.34 : 0.42,
      radius: isChain ? 0.1 : 0.13,
      seed,
    });
    // Ramificación secundaria eléctrica
    const midPt = coreBuild.pts[Math.floor(coreBuild.pts.length * 0.5)].clone();
    const forkEnd = midPt.clone().add(
      new THREE.Vector3(Math.sin(seed * 3.1) * 0.85, 0.35, Math.cos(seed * 2.7) * 0.85)
    );
    const forkBuild = createZigzagBoltData(midPt, forkEnd, {
      segments: 4,
      jitter: 0.2,
      radius: 0.032,
      seed: seed + 5.7,
    });

    const coreMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: isChain ? '#bae6fd' : '#fef08a',
      opacity: 0.98,
      additive: true,
      depthWrite: false,
    });
    const haloMat = createEnergyVFXMaterial({
      coreColor: isChain ? STORM_PALETTE.electricBlue : STORM_PALETTE.boltGold,
      rimColor: STORM_PALETTE.electricBlue,
      opacity: 0.65,
      additive: true,
      softEdge: true,
      depthWrite: false,
    });

    const arcGroup = new THREE.Group();
    const coreMesh = new THREE.Mesh(coreBuild.geo, coreMat);
    const haloMesh = new THREE.Mesh(haloBuild.geo, haloMat);
    const forkMesh = new THREE.Mesh(forkBuild.geo, haloMat);
    coreMesh.userData.noOutline = true;
    haloMesh.userData.noOutline = true;
    forkMesh.userData.noOutline = true;
    arcGroup.add(haloMesh, coreMesh, forkMesh);
    this.scene.add(arcGroup);

    let age = 0;
    const life = 0.26;
    const cleanup = () => {
      if (arcGroup.parent) arcGroup.parent.remove(arcGroup);
      coreBuild.geo.dispose();
      haloBuild.geo.dispose();
      forkBuild.geo.dispose();
      coreMat.dispose();
      haloMat.dispose();
    };
    this._cleanups.add(cleanup);

    this._tasks.push((dt) => {
      age += dt;
      const t = age / life;
      if (t >= 1) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      const fade = 1 - t * t;
      coreMat.opacity = fade;
      haloMat.opacity = 0.65 * fade;
      return true;
    });
  }

  // ============================================================
  //  4. Tecla E — Nube de Trueno
  //     (alcance hasta 20u, nube a 5.5u de altura durante 3.0s, 3 rayos cada 0.8s de 11 daño, 9.5s CD)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (
      this.fighter.isMistFormActive ||
      this.cooldowns.thundercloud > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen
    ) {
      return false;
    }
    this.cooldowns.thundercloud = 9.5 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.44);
    this.fighter.mesh.playAction('heavy_throw', 0.42);
    this.manager.notifyAbilityUsed('thundercloud', this.ownerId);
    if (this.sound && this.sound.playStormBolt) this.sound.playStormBolt();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.15);
    spawnPos.y = this.fighter.position.y + 1.38;

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();

    const seedBolt = createStormBoltGroup(0.95, 0.085, true);
    seedBolt.group.position.copy(spawnPos);
    seedBolt.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(seedBolt.group);

    let spawnedCloud = false;
    const formCloud = (pos) => {
      if (spawnedCloud) return;
      spawnedCloud = true;
      seedBolt.dispose();
      this._spawnThunderCloud(pos);
    };

    const proj = new Projectile({
      mesh: seedBolt.group,
      velocity: dir.multiplyScalar(40),
      radius: 0.34,
      gravity: 0.35,
      life: 0.5, // Alcance máximo 20 u
      damage: 0,
      knockback: 0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'storm_cloud_seed',
      onUpdate: (dt) => {
        seedBolt.group.rotation.z += dt * 14;
      },
      onImpact: (_hit, p) => formCloud(p.position.clone()),
      onExpire: (p) => formCloud(p.position.clone()),
    });
    this.manager.addProjectile(proj);
    return true;
  }

  _spawnThunderCloud(rawPos) {
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const overload = !!this.fighter.survivalMods?.auraStormOverload;
    const cloudRadius = 5.4 * areaMult;
    const hitRadius = 2.65 * areaMult * (overload ? 1.25 : 1);
    const strikeDamage = overload ? 14 : 11;

    const arena = this.manager.arena || this.arena;
    const gy =
      arena && arena.getGroundHeightAt
        ? arena.getGroundHeightAt(rawPos.x, rawPos.y + 3.0, rawPos.z)
        : Math.max(0, rawPos.y);
    const baseGroundY = Number.isFinite(gy) && gy > -4 ? gy : 0;

    const center = new THREE.Vector3(rawPos.x, baseGroundY, rawPos.z);
    const cloud = createThunderCloudGroup(cloudRadius, CLOUD_HEIGHT);
    cloud.group.position.set(center.x, baseGroundY, center.z);
    cloud.group.scale.setScalar(0.18);
    this.scene.add(cloud.group);

    if (this.sound && this.sound.playStormMistStart) this.sound.playStormMistStart();

    let age = 0;
    let strikeIdx = 0;

    const cleanup = () => {
      if (cloud.group.parent) cloud.group.parent.remove(cloud.group);
      cloud.dispose();
    };
    this._cleanups.add(cleanup);

    this._tasks.push((dt) => {
      age += dt;
      if (age < 0.22) {
        cloud.group.scale.setScalar(0.18 + (age / 0.22) * 0.82);
      } else if (age > CLOUD_DURATION - 0.28) {
        cloud.group.scale.setScalar(Math.max(0.05, (CLOUD_DURATION - age) / 0.28));
      } else {
        cloud.group.scale.setScalar(1.0);
      }
      cloud.canopy.rotation.y += dt * 0.45;
      cloud.canopy.position.y = CLOUD_HEIGHT + Math.sin(age * 3.2) * 0.14;

      // Destello interno previo a cada descarga de relámpago
      let preFlash = 0;
      for (const st of CLOUD_STRIKE_TIMES) {
        const diff = st - age;
        if (diff > -0.1 && diff < 0.28) {
          preFlash = Math.max(preFlash, diff >= 0 ? 1 - diff / 0.28 : 1 + diff / 0.1);
        }
      }
      if (cloud.setInternalFlash) {
        cloud.setInternalFlash(preFlash);
      }
      if (cloud.floorRing && cloud.floorRing.material) {
        cloud.floorRing.material.opacity = 0.38 + 0.18 * Math.sin(age * 8) + preFlash * 0.28;
      }

      while (strikeIdx < CLOUD_STRIKE_TIMES.length && age >= CLOUD_STRIKE_TIMES[strikeIdx]) {
        this._triggerCloudLightningStrike(center, baseGroundY, cloudRadius, hitRadius, strikeDamage, strikeIdx);
        strikeIdx++;
      }

      if (age >= CLOUD_DURATION) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      return true;
    });
  }

  _triggerCloudLightningStrike(center, baseGroundY, cloudRadius, hitRadius, damage, strikeIdx) {
    // Determinístico: busca al enemigo vivo más cercano bajo el radio de la nube; si no hay, usa desplazamiento fijo
    let bestTarget = null;
    let bestDist = cloudRadius;
    for (const f of this.manager.fighters) {
      if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - center.x;
      const dz = f.position.z - center.z;
      const xzDist = Math.hypot(dx, dz);
      if (xzDist <= bestDist) {
        bestDist = xzDist;
        bestTarget = f;
      }
    }

    let strikeX = center.x;
    let strikeZ = center.z;
    if (bestTarget) {
      const dx = bestTarget.position.x - center.x;
      const dz = bestTarget.position.z - center.z;
      const d = Math.hypot(dx, dz);
      const maxOff = cloudRadius * 0.72;
      if (d > maxOff && d > 1e-4) {
        strikeX = center.x + (dx / d) * maxOff;
        strikeZ = center.z + (dz / d) * maxOff;
      } else {
        strikeX = bestTarget.position.x;
        strikeZ = bestTarget.position.z;
      }
    } else {
      const off = CLOUD_DETERMINISTIC_OFFSETS[strikeIdx % CLOUD_DETERMINISTIC_OFFSETS.length];
      strikeX = center.x + off[0];
      strikeZ = center.z + off[1];
    }

    const arena = this.manager.arena || this.arena;
    const rawStrikeGround =
      arena && arena.getGroundHeightAt
        ? arena.getGroundHeightAt(strikeX, baseGroundY + 3.0, strikeZ)
        : baseGroundY;
    const strikeGroundY = Number.isFinite(rawStrikeGround) && rawStrikeGround > -4 ? rawStrikeGround : baseGroundY;
    const cloudTopY = baseGroundY + CLOUD_HEIGHT;
    const boltHeight = Math.max(2.2, cloudTopY - strikeGroundY);

    const strikeGroup = createVerticalLightningGroup(boltHeight, 0.15, 19 + strikeIdx * 31);
    strikeGroup.group.position.set(strikeX, strikeGroundY, strikeZ);
    this.scene.add(strikeGroup.group);

    if (this.sound && this.sound.playStormThunder) {
      this.sound.playStormThunder();
    }
    const impactPos = new THREE.Vector3(strikeX, strikeGroundY + 0.08, strikeZ);
    if (this.vfx) {
      this.vfx.spawnShockwave(impactPos, hitRadius * 1.45, 0.36, STORM_PALETTE.boltGold);
      this.vfx.spawnHitSparks(impactPos, new THREE.Vector3(0, 1, 0), 1.15, STORM_PALETTE.electricBlue);
    }

    // Impacto en cilindro vertical bajo el relámpago (radio = hitRadius = 2.1 u * areaMult)
    const pushDir = new THREE.Vector3();
    for (const f of this.manager.fighters) {
      if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - strikeX;
      const dz = f.position.z - strikeZ;
      const xzDist = Math.hypot(dx, dz);
      const yDist = Math.abs(f.position.y - strikeGroundY);
      if (xzDist <= hitRadius + (f.config?.radius || 0.45) && yDist <= 3.8) {
        if (xzDist > 0.25) {
          pushDir.set(dx / xzDist, 0.56, dz / xzDist).normalize();
        } else {
          pushDir.set(0, 0.88, 0.47).normalize();
        }
        f.takeDamage(damage, pushDir, 5.6, this.ownerId);
        if (this.vfx) {
          this.vfx.spawnHitSparks(
            f.position.clone().setY(f.position.y + 1.05),
            pushDir,
            1.1,
            STORM_PALETTE.boltGold
          );
        }
      }
    }

    let boltAge = 0;
    const boltLife = 0.28;
    const boltCleanup = () => {
      if (strikeGroup.group.parent) strikeGroup.group.parent.remove(strikeGroup.group);
      strikeGroup.dispose();
    };
    this._cleanups.add(boltCleanup);

    this._tasks.push((dt) => {
      boltAge += dt;
      const k = boltAge / boltLife;
      if (k >= 1) {
        this._cleanups.delete(boltCleanup);
        boltCleanup();
        return false;
      }
      const w = Math.max(0.18, 1 - k * 0.78);
      strikeGroup.group.scale.set(w, 1, w);
      return true;
    });
  }

  dispose() {
    this.reset();
  }
}
