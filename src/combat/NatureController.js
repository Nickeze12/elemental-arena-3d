import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import { createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import {
  NATURE_PALETTE,
  createThornDartMesh,
  createRootClusterGroup,
  createSporeOrbGroup,
  createSeedProjectileMesh,
  createSpitterPlantRig,
} from '../utils/NatureGeometry.js';

/**
 * NatureController
 * ----------------------------------------------------------------------
 * Implementa las 4 habilidades del 5.º Maestro Elemental (Naturaleza / Planta):
 *  1. Click Izq (`thorns`)  — Ráfaga de Espinas (2 dardos rápidos, 7 daño c/u, 0.55s CD)
 *  2. Click Der (`spitter`) — Brote Escupesemillas (torreta en mira <=18u, 3.0s, 2 golpes, 0.65s/tiro, 6 daño)
 *  3. Tecla Q (`roots`)     — Raíces Enredaderas (estela terrestre 22u, 14 daño + applyRoot 1.7s, 7.5s CD)
 *  4. Tecla E (`spores`)    — Tormenta de Esporas (orbe explosivo 4.2u*areaMult, 18 daño + applyPoison 3.5s + cura 8 HP, 9.0s CD)
 */

const ABILITIES = [
  { id: 'thorns', slot: 'primary', name: 'Ráfaga Espinas', key: 'Click Izq', cooldown: 1.05 },
  { id: 'spitter', slot: 'secondary', name: 'Escupesemillas', key: 'Click Der', cooldown: 7.0 },
  { id: 'roots', slot: 'skill1', name: 'Raíces Enredaderas', key: 'Q', cooldown: 7.5 },
  { id: 'spores', slot: 'skill2', name: 'Tormenta Esporas', key: 'E', cooldown: 9.0 },
];

export class NatureController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'nature';
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
      thorns: 0,
      spitter: 0,
      roots: 0,
      spores: 0,
    };

    this._plantSeq = 0;
    this._tasks = [];
    this._cleanups = new Set();
  }

  /** @param {import('../core/InputManager.js').InputManager} input */
  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive || this.fighter.isFrozen) return;
    if (input.mouseJustPressed(0) || input.isMouseDown(0)) this.tryPrimary();
    if (input.mouseJustPressed(2)) this.trySecondary();
    if (input.justPressed('KeyQ')) this.trySkill1();
    if (input.justPressed('KeyE')) this.trySkill2();
  }

  isReady(slot) {
    const ab = ABILITIES.find((a) => a.slot === slot || a.id === slot);
    if (!ab) return false;
    return this.cooldowns[ab.id] <= 0 && this.fighter.isAlive && !this.fighter.isFrozen;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      const rem = Math.max(0, this.cooldowns[ab.id]);
      const total = ab.cooldown + (this.cooldownBonus || 0);
      return {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: total,
        remaining: rem,
        ratio: total > 0 ? Math.min(1, rem / total) : 0,
        ready: rem <= 0 && !this.fighter.isFrozen,
      };
    });
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) {
        this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      }
    }
    for (let i = this._tasks.length - 1; i >= 0; i--) {
      if (!this._tasks[i](dt)) {
        this._tasks.splice(i, 1);
      }
    }
  }

  reset() {
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = 0;
    this._tasks.length = 0;
    this._plantSeq = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  // ============================================================
  //  1. Click Izq — Ráfaga de Espinas (2 dardos rápidos, 7 daño c/u, 1.05s CD)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (this.cooldowns.thorns > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.thorns = 1.05 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.35);
    this.fighter.mesh.playAction('punch_right', 0.24);
    this.manager.notifyAbilityUsed('thorns', this.ownerId);

    this._fireThornDart(customAimPoint, 0);

    let delay = 0.11;
    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) return false;
      delay -= dt;
      if (delay > 0) return true;
      this.fighter.mesh.playAction('punch_left', 0.24);
      this._fireThornDart(customAimPoint, 1);
      return false;
    });

    return true;
  }

  _fireThornDart(customAimPoint, index) {
    if (this.sound && this.sound.playNatureThorn) this.sound.playNatureThorn();
    const yaw = this.aimProvider.getAimYaw();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const sideOffset = (index === 0 ? 1 : -1) * 0.24;

    const spawnPos = this.fighter.position
      .clone()
      .addScaledVector(right, sideOffset)
      .addScaledVector(forward, 1.05);
    spawnPos.y = this.fighter.position.y + 1.28;

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();

    const dart = createThornDartMesh(0.95);
    dart.group.position.copy(spawnPos);
    dart.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(dart.group);

    let trailT = 0;
    const proj = new Projectile({
      mesh: dart.group,
      velocity: dir.multiplyScalar(52),
      radius: 0.24,
      gravity: 0.35,
      life: 1.5,
      damage: 7,
      knockback: 3.8,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'nature_thorn',
      onUpdate: (dt, p) => {
        trailT -= dt;
        if (trailT <= 0 && this.vfx) {
          trailT = 0.04;
          this.vfx.spawnDust(p.position, {
            count: 1,
            size: 0.24,
            speed: 0.6,
            life: 0.24,
            color: NATURE_PALETTE.brightLeaf,
            alpha: 0.7,
          });
        }
      },
      onImpact: (hit, p) => {
        if (this.vfx) {
          this.vfx.spawnDebris(p.position, {
            count: 6,
            size: 0.08,
            speed: 4.5,
            color: NATURE_PALETTE.emerald,
            life: 0.38,
          });
        }
        dart.dispose();
      },
      onExpire: () => dart.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  2. Click Der — Brote Escupesemillas (torreta 3.0s, 2 golpes, 0.65s/tiro)
  // ============================================================
  trySecondary(customAimPoint = null) {
    if (this.cooldowns.spitter > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.spitter = 7.0 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.42);
    this.fighter.mesh.playAction('guard_wall', 0.36);
    this.manager.notifyAbilityUsed('spitter', this.ownerId);

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const spawnPos = this._resolveValidGroundSpot(aim, 18);

    const turretId = `plant_${this.ownerId}_${++this._plantSeq}`;
    const turret = this._spawnSpitterTurret(turretId, spawnPos, yaw);
    this.manager.addTurret(turret);

    if (this.sound && this.sound.playNaturePlantSpawn) this.sound.playNaturePlantSpawn();
    if (this.vfx) {
      this.vfx.spawnShockwave(spawnPos.clone().setY(spawnPos.y + 0.05), 1.85, 0.32, NATURE_PALETTE.spore);
      this.vfx.spawnDebris(spawnPos.clone().setY(spawnPos.y + 0.3), {
        count: 8,
        size: 0.1,
        speed: 4.0,
        color: NATURE_PALETTE.emerald,
        life: 0.5,
      });
    }
    return true;
  }

  _resolveValidGroundSpot(aim, maxRange = 18) {
    const start = this.fighter.position;
    const dx = aim.x - start.x;
    const dz = aim.z - start.z;
    const dist = Math.hypot(dx, dz);
    const clampedDist = dist > maxRange ? maxRange : dist;
    const dirX = dist > 0.01 ? dx / dist : Math.sin(this.aimProvider.getAimYaw());
    const dirZ = dist > 0.01 ? dz / dist : Math.cos(this.aimProvider.getAimYaw());

    const arena = this.manager.arena || this.arena;
    const hasAbyss = arena && arena.hasAbyss !== false;
    const arenaR = arena && arena.getBoundsRadius ? arena.getBoundsRadius() - 1.2 : 28.5;
    const refY = Math.max(start.y + 3.5, aim.y + 2.0);

    // Prueba del punto objetivo hacia atrás hasta encontrar terreno sólido válido
    for (let step = 0; step <= 8; step++) {
      const testDist = Math.max(1.8, clampedDist * (1 - step / 8));
      let px = start.x + dirX * testDist;
      let pz = start.z + dirZ * testDist;
      if (hasAbyss) {
        const r = Math.hypot(px, pz);
        if (r > arenaR) {
          px *= arenaR / r;
          pz *= arenaR / r;
        }
      }
      const gy = arena.getGroundHeightAt
        ? arena.getGroundHeightAt(px, refY, pz)
        : arena.getGroundHeight(px, pz, refY);
      if (Number.isFinite(gy) && gy > -4.5) {
        return new THREE.Vector3(px, gy, pz);
      }
    }

    const fallbackY = arena.getGroundHeightAt
      ? arena.getGroundHeightAt(start.x, start.y + 1, start.z)
      : Math.max(0, start.y);
    return new THREE.Vector3(start.x + dirX * 2.0, Number.isFinite(fallbackY) ? fallbackY : start.y, start.z + dirZ * 2.0);
  }

  _spawnSpitterTurret(turretId, spawnPos, initialYaw) {
    const rig = createSpitterPlantRig();
    rig.root.position.copy(spawnPos);
    rig.root.rotation.y = initialYaw;
    rig.root.scale.set(0.06, 0.06, 0.06);
    this.scene.add(rig.root);

    const ctrl = this;
    const duration = 3.0;
    let age = 0;
    let dying = false;
    let deathTimer = 0;
    let shootTimer = 0.42; // Primer disparo tras animación de brote
    let recoil = 0;
    let hitFlashTimer = 0;

    const turret = {
      id: turretId,
      ownerId: this.ownerId,
      team: this.fighter.team || this.ownerId,
      position: spawnPos.clone(),
      rootMesh: rig.root,
      radius: 0.58,
      hp: 2,
      maxHp: 2,
      alive: true,
      get isAlive() { return turret.alive; },
      _disposed: false,

      takeHit(amount = 1, _attackerId = null, fromNetwork = false) {
        if (!turret.alive || dying) return;
        turret.hp = Math.max(0, turret.hp - amount);
        hitFlashTimer = 0.16;
        rig.flash();
        if (ctrl.vfx) {
          ctrl.vfx.spawnDebris(spawnPos.clone().setY(spawnPos.y + 0.8), {
            count: 7,
            size: 0.11,
            speed: 4.5,
            color: NATURE_PALETTE.brightLeaf,
            life: 0.45,
          });
        }
        if (ctrl.sound && ctrl.sound.playWoodBreak) {
          ctrl.sound.playWoodBreak();
        }
        if (!fromNetwork && ctrl.manager.isAuthoritative && ctrl.manager.onAuthoritativeCombatEvent) {
          ctrl.manager.onAuthoritativeCombatEvent({
            targetId: turret.id,
            attackerId: _attackerId || null,
            damage: 0,
            knockback: null,
            isCrit: false,
            status: 'plant_hit',
            hp: turret.hp,
            maxHp: turret.maxHp,
            isAlive: turret.hp > 0,
          });
        }
        if (turret.hp <= 0) {
          turret.destroyEarly();
        }
      },

      destroyEarly() {
        if (!turret.alive || dying) return;
        dying = true;
        deathTimer = 0.16;
        if (ctrl.vfx) {
          ctrl.vfx.spawnShockwave(spawnPos.clone().setY(spawnPos.y + 0.15), 1.6, 0.25, NATURE_PALETTE.emerald);
          ctrl.vfx.spawnDebris(spawnPos.clone().setY(spawnPos.y + 0.75), {
            count: 14,
            size: 0.12,
            speed: 5.5,
            color: NATURE_PALETTE.deepForest,
            life: 0.55,
          });
        }
      },

      update(dt) {
        if (!turret.alive) return;
        age += dt;

        if (hitFlashTimer > 0) {
          hitFlashTimer -= dt;
          if (hitFlashTimer <= 0) rig.clearFlash();
        }

        if (recoil > 0) {
          recoil = Math.max(0, recoil - dt * 5.0);
          rig.bulbGroup.position.z = -recoil * 0.16;
          rig.bulbGroup.scale.set(1 + recoil * 0.14, 1 - recoil * 0.1, 1 + recoil * 0.12);
        } else {
          rig.bulbGroup.position.z = 0;
          rig.bulbGroup.scale.set(1, 1, 1);
        }

        if (dying) {
          deathTimer -= dt;
          const s = Math.max(0.01, deathTimer / 0.16);
          rig.root.scale.set(s, s * 0.8, s);
          if (deathTimer <= 0) turret.alive = false;
          return;
        }

        // Crecimiento al nacer (0.22s) y marchitado natural en últimos 0.22s de los 3.0s
        if (age < 0.22) {
          const t = age / 0.22;
          const ease = 1 - (1 - t) * (1 - t);
          rig.root.scale.set(0.08 + ease * 0.92, 0.08 + ease * 0.92, 0.08 + ease * 0.92);
        } else if (age > duration - 0.22) {
          const rem = Math.max(0, duration - age);
          const s = Math.max(0.02, rem / 0.22);
          rig.root.scale.set(s, s * 0.85, s);
          if (age >= duration) {
            if (ctrl.vfx) {
              ctrl.vfx.spawnDebris(spawnPos.clone().setY(spawnPos.y + 0.5), {
                count: 8,
                size: 0.09,
                speed: 3.0,
                color: NATURE_PALETTE.brightLeaf,
                life: 0.45,
              });
            }
            turret.alive = false;
            return;
          }
        } else {
          rig.root.scale.set(1, 1, 1);
        }

        // Busca el objetivo hostil más cercano dentro de 16 u con línea de visión
        const target = ctrl._findNearestSpitterTarget(spawnPos, 16);
        if (target) {
          const headWorldY = spawnPos.y + 1.24;
          const dx = target.position.x - spawnPos.x;
          const dy = (target.position.y + 1.05) - headWorldY;
          const dz = target.position.z - spawnPos.z;
          const targetWorldYaw = Math.atan2(dx, dz);
          const relYaw = targetWorldYaw - rig.root.rotation.y;
          // Camino más corto para rotar el capullo
          let diffYaw = (relYaw - rig.headPivot.rotation.y) % (Math.PI * 2);
          if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
          if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
          rig.headPivot.rotation.y += diffYaw * (1 - Math.exp(-12 * dt));

          const horiz = Math.hypot(dx, dz) || 1;
          const targetPitch = -THREE.MathUtils.clamp(Math.atan2(dy, horiz), -0.55, 0.55);
          rig.headPivot.rotation.x += (targetPitch - rig.headPivot.rotation.x) * (1 - Math.exp(-10 * dt));
        } else {
          // Respiración orgánica mientras busca presa
          rig.headPivot.rotation.x = Math.sin(age * 3.5) * 0.06;
        }

        shootTimer -= dt;
        if (shootTimer <= 0 && age < duration - 0.22) {
          shootTimer = 0.65;
          if (target) {
            recoil = 1;
            ctrl._fireSpitterSeed(spawnPos, target);
          }
        }
      },

      dispose() {
        if (turret._disposed) return;
        turret._disposed = true;
        turret.alive = false;
        rig.dispose();
      },
    };

    const cleanupFn = () => turret.dispose();
    this._cleanups.add(cleanupFn);
    const origDispose = turret.dispose;
    turret.dispose = () => {
      this._cleanups.delete(cleanupFn);
      origDispose();
    };
    return turret;
  }

  _findNearestSpitterTarget(origin, maxRange = 16) {
    let best = null;
    let bestDistSq = maxRange * maxRange;
    for (const f of this.manager.fighters) {
      if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - origin.x;
      const dy = f.position.y - origin.y;
      const dz = f.position.z - origin.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > bestDistSq) continue;
      if (this._hasClearLineToTarget(origin, f.position)) {
        best = f;
        bestDistSq = dSq;
      }
    }
    return best;
  }

  _hasClearLineToTarget(fromPos, toPos) {
    const start = new THREE.Vector3(fromPos.x, fromPos.y + 1.24, fromPos.z);
    const end = new THREE.Vector3(toPos.x, toPos.y + 1.0, toPos.z);
    const dir = end.clone().sub(start);
    const len = dir.length();
    if (len < 0.5) return true;
    dir.divideScalar(len);

    const step = 1.2;
    const probe = new THREE.Vector3();
    for (let d = 1.1; d < len - 0.8; d += step) {
      probe.copy(start).addScaledVector(dir, d);
      for (const w of this.manager.walls) {
        if (w.intersectSphere && w.intersectSphere(probe, 0.22)) return false;
      }
      const arena = this.manager.arena || this.arena;
      if (arena && arena.checkProjectileHit) {
        const hit = arena.checkProjectileHit(probe, 0.16, 12);
        if (hit) return false;
      }
    }
    return true;
  }

  _fireSpitterSeed(plantPos, target) {
    if (this.sound && this.sound.playNatureSeedSpit) this.sound.playNatureSeedSpit();
    const muzzle = new THREE.Vector3(plantPos.x, plantPos.y + 1.26, plantPos.z);
    const aimTarget = new THREE.Vector3(target.position.x, target.position.y + 1.0, target.position.z);
    const dir = aimTarget.sub(muzzle).normalize();
    muzzle.addScaledVector(dir, 0.42);

    const seed = createSeedProjectileMesh();
    seed.group.position.copy(muzzle);
    seed.group.lookAt(muzzle.clone().add(dir));
    this.scene.add(seed.group);

    const proj = new Projectile({
      mesh: seed.group,
      velocity: dir.multiplyScalar(40),
      radius: 0.24,
      gravity: 0.22,
      life: 0.75,
      damage: 6,
      knockback: 4.0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'nature_seed',
      onImpact: (hit, p) => {
        if (this.vfx) {
          this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 0.75, NATURE_PALETTE.spore);
        }
        seed.dispose();
      },
      onExpire: () => seed.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  3. Tecla Q — Raíces Enredaderas (estela terrestre 22u, 14 daño + Root 1.7s, 7.5s CD)
  // ============================================================
  trySkill1(customAimPoint = null) {
    if (this.cooldowns.roots > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.roots = 7.5 + this.cooldownBonus;

    const yaw = customAimPoint && customAimPoint.isVector3
      ? Math.atan2(customAimPoint.x - this.fighter.position.x, customAimPoint.z - this.fighter.position.z)
      : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.45);
    this.fighter.mesh.playAction('stomp_seismic', 0.42);
    this.manager.notifyAbilityUsed('roots', this.ownerId);
    if (this.sound && this.sound.playNatureRoot) this.sound.playNatureRoot();

    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    const curPos = this.fighter.position.clone().addScaledVector(dir, 1.3);
    const maxDist = 22;
    const speed = 30;
    let traveled = 0;
    let sproutDist = 0;
    let finished = false;
    const hitTargets = new Set();

    const arena = this.manager.arena || this.arena;
    const spawnTrailPatch = (p, seed) => {
      const cluster = createRootClusterGroup(0.85, 0.34, seed);
      cluster.group.position.copy(p);
      cluster.group.rotation.y = Math.random() * Math.PI * 2;
      cluster.group.scale.set(1, 0.1, 1);
      this.scene.add(cluster.group);
      let life = 1.05;
      const maxL = life;
      const cleanup = () => {
        if (cluster.group.parent) this.scene.remove(cluster.group);
        cluster.dispose();
      };
      this._cleanups.add(cleanup);
      this._tasks.push((dt) => {
        life -= dt;
        const age = maxL - life;
        const sy = age < 0.14 ? age / 0.14 : Math.max(0.01, life / 0.35);
        cluster.group.scale.set(1, Math.min(1, sy), 1);
        if (life <= 0) {
          this._cleanups.delete(cleanup);
          cleanup();
          return false;
        }
        return true;
      });
    };

    this._tasks.push((dt) => {
      if (finished) return false;
      const step = speed * dt;
      traveled += step;
      curPos.addScaledVector(dir, step);

      const gy = arena.getGroundHeightAt
        ? arena.getGroundHeightAt(curPos.x, curPos.y + 2.0, curPos.z)
        : arena.getGroundHeight(curPos.x, curPos.z, curPos.y + 2.0);
      if (arena.hasAbyss !== false && gy < -5) {
        finished = true;
        return false;
      }
      curPos.y = gy;

      // Comprueba colisión contra muros sólidos
      for (const w of this.manager.walls) {
        if (w.intersectSphere && w.intersectSphere(curPos.clone().setY(curPos.y + 0.6), 0.65)) {
          finished = true;
          return false;
        }
      }

      if (traveled - sproutDist >= 1.55) {
        sproutDist = traveled;
        spawnTrailPatch(curPos, Math.round(traveled));
        if (this.vfx) {
          this.vfx.spawnDust(curPos.clone().setY(curPos.y + 0.15), {
            count: 3,
            size: 0.42,
            speed: 1.8,
            color: NATURE_PALETTE.bark,
            life: 0.4,
          });
        }
      }

      // Daño a plantas enemigas
      this.manager.damageTurretsInSphere(curPos.clone().setY(curPos.y + 0.5), 1.05, this.ownerId, 1);

      // Detecta el primer objetivo hostil (en el suelo o salto bajo)
      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f) || hitTargets.has(f.id)) continue;
        const dx = f.position.x - curPos.x;
        const dz = f.position.z - curPos.z;
        const dy = Math.abs(f.position.y - curPos.y);
        const minR = f.config.radius + 1.05;
        if (dy < 2.2 && dx * dx + dz * dz <= minR * minR) {
          hitTargets.add(f.id);
          spawnTrailPatch(f.position.clone().setY(curPos.y), 99);
          const kbDir = dir.clone().multiplyScalar(0.5).setY(0.28).normalize();
          f.takeDamage(14, kbDir, 3.2, this.ownerId);
          if (f.applyRoot) f.applyRoot(1.7, this.ownerId);
          if (this.vfx) {
            this.vfx.spawnShockwave(f.position.clone().setY(f.position.y + 0.08), 2.1, 0.34, NATURE_PALETTE.emerald);
          }
          finished = true;
          return false;
        }
      }

      if (traveled >= maxDist) {
        finished = true;
        return false;
      }
      return true;
    });

    return true;
  }

  // ============================================================
  //  4. Tecla E — Tormenta de Esporas (orbe 4.2u*areaMult, 18 daño + Veneno 3.5s + +8 HP)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (this.cooldowns.spores > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.spores = 9.0 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.48);
    this.fighter.mesh.playAction('heavy_throw', 0.44);
    this.manager.notifyAbilityUsed('spores', this.ownerId);
    if (this.sound && this.sound.playNatureSpore) this.sound.playNatureSpore();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.15);
    spawnPos.y = this.fighter.position.y + 1.38;

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();

    const orb = createSporeOrbGroup(0.32);
    orb.group.position.copy(spawnPos);
    this.scene.add(orb.group);

    let detonated = false;
    const detonate = (center) => {
      if (detonated) return;
      detonated = true;
      orb.dispose();
      this._detonateSporeStorm(center);
    };

    const proj = new Projectile({
      mesh: orb.group,
      velocity: dir.multiplyScalar(28),
      radius: 0.38,
      gravity: 1.2,
      life: 0.92,
      damage: 0, // El daño se aplica uniformemente en el estallido zonal de 4.2 u
      knockback: 0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'nature_spores',
      onUpdate: (dt, p) => {
        orb.ring.rotation.y += dt * 7.5;
        orb.ring.rotation.x += dt * 3.2;
        if (this.vfx && Math.random() > 0.35) {
          this.vfx.spawnDust(p.position, {
            count: 2,
            size: 0.36,
            speed: 1.2,
            life: 0.38,
            color: NATURE_PALETTE.spore,
            alpha: 0.78,
          });
        }
      },
      onImpact: (hit, p) => detonate(p.position.clone()),
      onExpire: (p) => detonate(p.position.clone()),
    });
    this.manager.addProjectile(proj);
    return true;
  }

  _detonateSporeStorm(center) {
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 5.4 * areaMult;

    if (this.sound && this.sound.playNatureSpore) this.sound.playNatureSpore();

    // Halo volumétrico suave de nube de esporas (sin contorno negro)
    const sporeDomeGeo = new THREE.SphereGeometry(radius * 0.72, 20, 14);
    const sporeDomeMat = createEnergyVFXMaterial({
      coreColor: '#a7f3d0',
      rimColor: '#22c55e',
      opacity: 0.42,
      softEdge: true,
      additive: true,
      depthWrite: false,
    });
    const sporeDome = new THREE.Mesh(sporeDomeGeo, sporeDomeMat);
    sporeDome.position.copy(center);
    sporeDome.scale.setScalar(0.35);
    sporeDome.userData.noOutline = true;
    this.scene.add(sporeDome);
    let sporeAge = 0;
    const sporeDur = 0.55;
    const disposeDome = () => {
      if (sporeDome.parent) this.scene.remove(sporeDome);
      sporeDomeGeo.dispose();
      sporeDomeMat.dispose();
    };
    this._cleanups.add(disposeDome);
    this._tasks.push((dt) => {
      sporeAge += dt;
      const t = Math.min(1, sporeAge / sporeDur);
      sporeDome.scale.setScalar(0.35 + t * 0.95);
      sporeDomeMat.opacity = 0.44 * (1 - t * t);
      if (t >= 1) {
        this._cleanups.delete(disposeDome);
        disposeDome();
        return false;
      }
      return true;
    });

    if (this.vfx) {
      this.vfx.spawnShockwave(center.clone().setY(Math.max(0.08, center.y)), radius, 0.42, NATURE_PALETTE.spore);
      this.vfx.spawnShockwave(center.clone().setY(Math.max(0.12, center.y + 0.1)), radius * 0.65, 0.32, NATURE_PALETTE.brightLeaf);
      this.vfx.spawnDebris(center, {
        count: 18,
        size: 0.14,
        speed: 6.5,
        color: NATURE_PALETTE.emerald,
        life: 0.65,
      });
      this.vfx.spawnDust(center, {
        count: 14,
        size: 0.85,
        speed: 3.4,
        spread: 0.8,
        life: 0.72,
        color: NATURE_PALETTE.spore,
        alpha: 0.72,
      });
    }

    this.manager.damageTurretsInSphere(center, radius, this.ownerId, 1);

    let hitCount = 0;
    for (const f of this.manager.fighters) {
      if (!this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - center.x;
      const dy = (f.position.y + 0.9) - center.y;
      const dz = f.position.z - center.z;
      const maxR = radius + f.config.radius;
      if (dx * dx + dy * dy + dz * dz <= maxR * maxR) {
        hitCount += 1;
        const pushDir = new THREE.Vector3(dx, 0.35, dz).normalize();
        f.takeDamage(18, pushDir, 6.2, this.ownerId);
        if (f.applyPoison) f.applyPoison(3.5, 4.0, this.ownerId);
      }
    }

    if (hitCount > 0 && this.manager.isAuthoritative !== false && this.fighter.isAlive) {
      this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + 8);
      if (this.fighter.mesh && this.fighter.mesh.flash) {
        this.fighter.mesh.flash('#4ade80');
      }
      if (this.vfx) {
        this.vfx.spawnShockwave(this.fighter.position.clone().setY(this.fighter.position.y + 0.2), 1.9, 0.32, '#4ade80');
      }
    }
  }
}
