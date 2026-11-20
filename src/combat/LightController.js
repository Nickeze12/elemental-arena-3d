import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import { FighterMesh } from '../entities/FighterMesh.js';
import {
  LIGHT_PALETTE,
  createPhotonBeamGroup,
  createLaserBeamMesh,
  createRefractionPrismGroup,
  createMirageFresnelMaterial,
  createSolarFlashGroup,
} from '../utils/LightGeometry.js';

/**
 * LightController
 * ----------------------------------------------------------------------
 * Implementa las 4 habilidades del 8.º Maestro Elemental (Luz / Prisma):
 *  1. Click Izq (`photonbeam`)  — Haz Fotónico lineal veloz (10 daño, 0.50s CD); refracta al tocar un Prisma
 *  2. Click Der (`mirage`)      — Clon Ilusorio / Espejismo por 3.5s (8.5s CD), atrae bots/monstruos y detona en área
 *  3. Tecla Q (`solarflash`)    — Destello Solar radial (4.6u, 13 daño + empuje + applyStun 1.1s, 7.5s CD)
 *  4. Tecla E (`prism`)         — Prisma Refractario a 1.35u del suelo (alcance 18u, 5.0s dur, 9.0s CD) que divide haces en 3 láseres
 */

const ABILITIES = [
  { id: 'photonbeam', slot: 'primary', name: 'Haz Fotónico', key: 'Click Izq', cooldown: 0.5 },
  { id: 'mirage', slot: 'secondary', name: 'Espejismo', key: 'Click Der', cooldown: 8.5 },
  { id: 'solarflash', slot: 'skill1', name: 'Destello Solar', key: 'Q', cooldown: 5.5 },
  { id: 'prism', slot: 'skill2', name: 'Prisma Refractario', key: 'E', cooldown: 9.0 },
];

const PRISM_MAX_RANGE = 18.0;
const PRISM_HEIGHT = 1.35;
const PRISM_DURATION = 5.0;
const PRISM_CAPTURE_RADIUS = 1.45;
const PRISM_INTERNAL_CD = 0.35;
const PRISM_REFRACT_RANGE = 13.5;
const MIRAGE_DURATION = 3.5;

const LASER_COLORS = [
  { core: '#ffffff', rim: LIGHT_PALETTE.solarGold },
  { core: '#e0f7ff', rim: LIGHT_PALETTE.cyan },
  { core: '#fdf2ff', rim: LIGHT_PALETTE.magenta },
  { core: '#ffffff', rim: LIGHT_PALETTE.ivory },
];

export class LightController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'light';
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
      photonbeam: 0,
      mirage: 0,
      solarflash: 0,
      prism: 0,
    };

    this._tasks = [];
    this._cleanups = new Set();
  }

  /** @param {import('../core/InputManager.js').InputManager} input */
  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive || this.fighter.isFrozen || this.fighter.isStunned) return;
    if (input.mouseJustPressed(0) || input.isMouseDown(0)) this.tryPrimary();
    if (input.mouseJustPressed(2)) this.trySecondary();
    if (input.justPressed('KeyQ')) this.trySkill1();
    if (input.justPressed('KeyE')) this.trySkill2();
  }

  isReady(slot) {
    const ab = ABILITIES.find((a) => a.slot === slot || a.id === slot);
    if (!ab) return false;
    return this.cooldowns[ab.id] <= 0 && this.fighter.isAlive && !this.fighter.isFrozen && !this.fighter.isStunned;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      const bonus = ab.id === 'photonbeam' ? (this.cooldownBonus || 0) * 0.25 : this.cooldownBonus || 0;
      const total =
        ab.id === 'mirage'
          ? (ab.cooldown + bonus) * (this.fighter.survivalMods?.lightMirageCdMult || 1)
          : ab.cooldown + bonus;
      const rem = Math.max(0, this.cooldowns[ab.id]);
      return {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: total,
        remaining: rem,
        ready: rem <= 0 && !this.fighter.isFrozen && !this.fighter.isStunned,
      };
    });
  }

  reset() {
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = 0;
    this._tasks.length = 0;
    for (const fn of this._cleanups) {
      try {
        fn();
      } catch (_) {}
    }
    this._cleanups.clear();
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    for (let i = this._tasks.length - 1; i >= 0; i--) {
      if (!this._tasks[i](dt)) this._tasks.splice(i, 1);
    }
  }

  // ============================================================
  //  1. Click Izq — Haz Fotónico (10 daño, 0.50s CD, refracta en Prismas)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (
      this.cooldowns.photonbeam > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    const baseCd = 0.5 + (this.cooldownBonus || 0) * 0.25;
    this.cooldowns.photonbeam = baseCd;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.3);
    this.fighter.mesh.playAction('punch_right', 0.28);
    this.manager.notifyAbilityUsed('photonbeam', this.ownerId);
    if (this.sound && this.sound.playLightBeam) this.sound.playLightBeam();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnOrigin = this.fighter.position.clone().addScaledVector(forward, 0.9);
    spawnOrigin.y = this.fighter.position.y + 1.32;

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const baseDir = aim.clone().sub(spawnOrigin);
    if (baseDir.lengthSq() < 1e-4) baseDir.copy(forward);
    baseDir.normalize();

    const infiniteRefract = !!this.fighter.survivalMods?.auraLightInfiniteRefract;
    const angles = infiniteRefract ? [-0.14, 0, 0.14] : [0];
    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    const coreTint = isRival ? LIGHT_PALETTE.rivalCyan : LIGHT_PALETTE.solarGold;

    for (const ang of angles) {
      const dir = baseDir.clone();
      if (ang !== 0) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      this._spawnPhotonProjectile(spawnOrigin.clone(), dir, coreTint);
    }

    return true;
  }

  _spawnPhotonProjectile(origin, dir, coreTint) {
    const beamRig = createPhotonBeamGroup(1.38, 0.082, coreTint);
    beamRig.group.position.copy(origin);
    beamRig.group.lookAt(origin.clone().add(dir));
    this.scene.add(beamRig.group);

    let age = 0;
    const refractedPrisms = new Set();

    const proj = new Projectile({
      mesh: beamRig.group,
      velocity: dir.clone().multiplyScalar(54),
      radius: 0.24,
      gravity: 0,
      life: 1.05,
      damage: 10,
      knockback: 5.2,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'light_photonbeam',
      onSubStep: (p) => {
        const prisms = this.manager.lightPrisms;
        if (!prisms || prisms.length === 0 || !p.alive) return false;
        const selfTeam = this.fighter.team || this.ownerId;
        for (const prism of prisms) {
          if (!prism.alive || refractedPrisms.has(prism)) continue;
          if (prism.team !== selfTeam && prism.ownerId !== this.ownerId) continue;
          if (prism.refractCd > 0) continue;

          if (p.position.distanceToSquared(prism.center) <= PRISM_CAPTURE_RADIUS * PRISM_CAPTURE_RADIUS) {
            refractedPrisms.add(prism);
            prism.refractCd = PRISM_INTERNAL_CD;
            p.alive = false;
            beamRig.dispose();
            this._triggerPrismRefraction(prism, dir);
            return true;
          }
        }
        return false;
      },
      onUpdate: (dt) => {
        age += dt;
        beamRig.update(dt, age);
      },
      onImpact: (hit) => {
        if (this.vfx) {
          this.vfx.spawnHitSparks(hit.point, hit.normal, 1.0, LIGHT_PALETTE.solarGold);
        }
        beamRig.dispose();
      },
      onExpire: () => beamRig.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  _triggerPrismRefraction(prism, incomingDir) {
    prism.rig.triggerRefractFlash();
    if (this.sound && this.sound.playLightRefract) this.sound.playLightRefract();
    if (this.vfx) {
      this.vfx.spawnShockwave(prism.center.clone(), 2.2, 0.25, LIGHT_PALETTE.cyan);
      this.vfx.spawnHitSparks(prism.center.clone(), new THREE.Vector3(0, 1, 0), 1.25, LIGHT_PALETTE.solarGold);
    }

    const maxLasers = 2;
    const candidates = [];

    for (const f of this.manager.fighters) {
      if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
      const aimY = f.position.y + (f.monsterType === 'colossus' ? 1.55 : 1.05);
      const tPos = new THREE.Vector3(f.position.x, aimY, f.position.z);
      const dist = prism.center.distanceTo(tPos);
      if (dist <= PRISM_REFRACT_RANGE) {
        candidates.push({ target: f, pos: tPos, dist });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);
    const chosen = candidates.slice(0, maxLasers);

    if (chosen.length === 0) {
      // Sin objetivos cercanos: dispersa 2 haces espectrales limitados al rango del prisma
      for (let i = 0; i < 2; i++) {
        const ang = (i === 0 ? -1 : 1) * 0.34;
        const spreadDir = incomingDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).normalize();
        const endPt = prism.center.clone().addScaledVector(spreadDir, Math.min(8.5, PRISM_REFRACT_RANGE));
        const c = LASER_COLORS[i % LASER_COLORS.length];
        this._spawnRefractedLaserVisual(prism.center, endPt, c.core, c.rim);
      }
      return;
    }

    const dmgScale = (this.fighter.survivalMods?.damageMult || 1) * (this.fighter.survivalMods?.auraDamageMult || 1);
    const refractDmg = Math.max(1, Math.round(9 * dmgScale));

    chosen.forEach((entry, idx) => {
      const c = LASER_COLORS[idx % LASER_COLORS.length];
      this._spawnRefractedLaserVisual(prism.center, entry.pos, c.core, c.rim);

      const push = entry.pos.clone().sub(prism.center);
      push.y = 0;
      if (push.lengthSq() < 1e-4) push.set(0, 0, 1);
      push.normalize().setY(0.24).normalize();

      if (this.manager.isAuthoritative !== false) {
        entry.target.takeDamage(refractDmg, push, 4.4, this.ownerId);
        if (this.manager.onFighterHit) this.manager.onFighterHit(entry.target, refractDmg, entry.pos);
      }
      if (this.vfx) {
        this.vfx.spawnHitSparks(entry.pos, push, 1.05, c.rim);
      }
    });
  }

  _spawnRefractedLaserVisual(start, end, coreColor, rimColor) {
    const laser = createLaserBeamMesh(start, end, {
      coreColor,
      rimColor,
      radius: 0.068,
    });
    this.scene.add(laser.group);

    let age = 0;
    const life = 0.28;
    const cleanup = () => {
      if (laser.group.parent) laser.group.parent.remove(laser.group);
      laser.dispose();
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
      laser.setFade(1 - t * t);
      return true;
    });
  }

  // ============================================================
  //  2. Click Der — Espejismo / Clon Ilusorio (3.5s, distrae y estalla)
  // ============================================================
  trySecondary() {
    if (
      this.cooldowns.mirage > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    const cdMult = this.fighter.survivalMods?.lightMirageCdMult || 1;
    this.cooldowns.mirage = (8.5 + (this.cooldownBonus || 0)) * cdMult;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.35);
    this.fighter.mesh.playAction('heavy_throw', 0.32);
    this.manager.notifyAbilityUsed('mirage', this.ownerId);
    if (this.sound && this.sound.playLightMirage) this.sound.playLightMirage();

    // Limpiar espejismo previo del mismo dueño si aún existe
    for (const f of [...this.manager.fighters]) {
      if (f && f.isMirage && f.ownerId === this.ownerId && typeof f.detonateEarly === 'function') {
        f.detonateEarly();
      }
    }

    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    const mirageRig = new FighterMesh(isRival ? 'light_rival' : 'light');
    const fresnelMat = createMirageFresnelMaterial(isRival);
    const toRemoveOutlines = [];
    mirageRig.root.traverse((obj) => {
      if (obj.userData?.isOutline || obj.userData?.noOutline) {
        if (obj.userData?.isOutline) toRemoveOutlines.push(obj);
        return;
      }
      if (obj.isMesh) {
        obj.material = fresnelMat;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
    for (const ol of toRemoveOutlines) {
      if (ol.parent) ol.parent.remove(ol);
    }

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    const arena = this.manager.arena || this.arena;
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 0.65);
    if (arena && arena.getGroundHeightAt) {
      const gy = arena.getGroundHeightAt(spawnPos.x, spawnPos.y + 1.5, spawnPos.z);
      if (Number.isFinite(gy) && gy > -4) spawnPos.y = gy;
    }
    mirageRig.root.position.copy(spawnPos);
    mirageRig.root.rotation.y = yaw;
    this.scene.add(mirageRig.root);

    if (this.vfx) {
      this.vfx.spawnShockwave(spawnPos, 2.0, 0.28, LIGHT_PALETTE.cyan);
    }

    const explosiveBonus = !!this.fighter.survivalMods?.auraLightExplosiveMirage;
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const explodeRadius = 3.2 * areaMult * (explosiveBonus ? 2.0 : 1.0);
    const dmgScale = (this.fighter.survivalMods?.damageMult || 1) * (this.fighter.survivalMods?.auraDamageMult || 1);
    const explodeDmg = Math.round(12 * (explosiveBonus ? 2.0 : 1.0) * dmgScale);

    const mirageId = `mirage_${this.ownerId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let age = 0;
    let trailTimer = 0;
    let detonated = false;

    const mirageEntity = {
      id: mirageId,
      isMirage: true,
      ownerId: this.ownerId,
      team: this.fighter.team || this.ownerId,
      isAlive: true,
      hp: 14,
      maxHp: 14,
      hitsReceived: 0,
      position: spawnPos,
      velocity: forward.clone().multiplyScalar(8.4),
      yaw,
      config: { radius: 0.48 },
      mesh: mirageRig,
      takeDamage: (amount = 0) => {
        if (!mirageEntity.isAlive || detonated) return;
        mirageEntity.hitsReceived += 1;
        mirageEntity.hp = Math.max(0, mirageEntity.hp - Math.max(0, amount));
        if (this.vfx) {
          this.vfx.spawnHitSparks(
            mirageEntity.position.clone().setY(mirageEntity.position.y + 1.0),
            new THREE.Vector3(0, 1, 0),
            0.9,
            LIGHT_PALETTE.cyan
          );
        }
        if (mirageEntity.hitsReceived >= 2 || mirageEntity.hp <= 0) {
          detonate();
        }
      },
      applyFreeze() {},
      applyBurn() {},
      applyRoot() {},
      applyPoison() {},
      applyConfusion() {},
      applyStun() {},
      clearStatuses() {},
      detonateEarly: () => detonate(false),
    };

    const cleanup = () => {
      mirageEntity.isAlive = false;
      const idx = this.manager.fighters.indexOf(mirageEntity);
      if (idx >= 0) this.manager.fighters.splice(idx, 1);
      if (mirageRig.root.parent) mirageRig.root.parent.remove(mirageRig.root);
      mirageRig.root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
      });
      for (const m of mirageRig.materials || []) m.dispose();
      for (const m of mirageRig._extraMaterials || []) m.dispose();
      fresnelMat.dispose();
    };

    const detonate = (dealDamage = true) => {
      if (detonated) return;
      detonated = true;
      mirageEntity.isAlive = false;

      const burstCenter = mirageEntity.position.clone();
      if (this.sound && this.sound.playLightMirage) this.sound.playLightMirage();
      if (this.vfx) {
        this.vfx.spawnShockwave(burstCenter, explodeRadius * 1.15, 0.34, LIGHT_PALETTE.solarGold);
        this.vfx.spawnShockwave(burstCenter, explodeRadius * 0.72, 0.24, LIGHT_PALETTE.cyan);
        this.vfx.spawnDust(burstCenter.clone().setY(burstCenter.y + 0.9), {
          count: 14,
          size: 0.52,
          speed: 4.5,
          life: 0.45,
          color: LIGHT_PALETTE.ivory,
          alpha: 0.9,
        });
      }

      if (dealDamage && this.manager.isAuthoritative !== false) {
        for (const f of this.manager.fighters) {
          if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
          const dx = f.position.x - burstCenter.x;
          const dz = f.position.z - burstCenter.z;
          const d = Math.hypot(dx, dz);
          if (d <= explodeRadius + (f.config?.radius || 0.45)) {
            const pushDir =
              d > 0.15
                ? new THREE.Vector3(dx / d, 0.25, dz / d).normalize()
                : forward.clone().setY(0.25).normalize();
            f.takeDamage(explodeDmg, pushDir, 6.2, this.ownerId);
            // Ralentización breve tras el destello ilusorio
            f.velocity.x *= 0.42;
            f.velocity.z *= 0.42;
            if (this.manager.onFighterHit) {
              this.manager.onFighterHit(f, explodeDmg, f.position.clone().setY(f.position.y + 1.0));
            }
          }
        }
      }

      this._cleanups.delete(cleanup);
      cleanup();
    };

    this.manager.fighters.push(mirageEntity);
    this._cleanups.add(cleanup);

    let runYaw = yaw;
    const contactCooldowns = new Map();
    const contactDmg = Math.max(1, Math.round(6 * dmgScale));

    this._tasks.push((dt) => {
      if (detonated || !mirageEntity.isAlive) return false;
      age += dt;
      if (age >= MIRAGE_DURATION) {
        detonate(true);
        return false;
      }

      for (const [fid, rem] of contactCooldowns.entries()) {
        if (rem - dt <= 0) contactCooldowns.delete(fid);
        else contactCooldowns.set(fid, rem - dt);
      }

      // Evita caerse al abismo en Arena Clásica invirtiendo giro cerca del borde
      const hasAbyss = arena && arena.hasAbyss !== false;
      const arenaR = arena && arena.getBoundsRadius ? arena.getBoundsRadius() : 30;
      const radialDist = hasAbyss
        ? Math.hypot(mirageEntity.position.x, mirageEntity.position.z)
        : Math.max(Math.abs(mirageEntity.position.x), Math.abs(mirageEntity.position.z));
      if (radialDist > arenaR - 3.6) {
        runYaw = Math.atan2(-mirageEntity.position.x, -mirageEntity.position.z);
      }

      const stepSpeed = 8.4;
      const mx = Math.sin(runYaw);
      const mz = Math.cos(runYaw);
      mirageEntity.velocity.set(mx * stepSpeed, 0, mz * stepSpeed);
      mirageEntity.position.x += mx * stepSpeed * dt;
      mirageEntity.position.z += mz * stepSpeed * dt;

      if (arena && arena.getGroundHeightAt) {
        const gy = arena.getGroundHeightAt(mirageEntity.position.x, mirageEntity.position.y + 1.4, mirageEntity.position.z);
        if (Number.isFinite(gy) && gy > -4) {
          mirageEntity.position.y = THREE.MathUtils.lerp(mirageEntity.position.y, gy, Math.min(1, dt * 12));
        }
      }

      // Daño leve de contacto si el Espejismo choca contra un rival o monstruo
      for (const f of this.manager.fighters) {
        if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
        if (contactCooldowns.has(f.id)) continue;
        const dx = f.position.x - mirageEntity.position.x;
        const dz = f.position.z - mirageEntity.position.z;
        const dy = Math.abs(f.position.y - mirageEntity.position.y);
        const hitDist = mirageEntity.config.radius + (f.config?.radius || 0.45) + 0.18;
        if (dx * dx + dz * dz <= hitDist * hitDist && dy <= 1.8) {
          contactCooldowns.set(f.id, 0.7);
          const push = new THREE.Vector3(dx, 0.18, dz);
          if (push.lengthSq() < 1e-4) push.set(mx, 0.18, mz);
          push.normalize();
          if (this.manager.isAuthoritative !== false) {
            f.takeDamage(contactDmg, push, 3.8, this.ownerId);
            if (this.manager.onFighterHit) {
              this.manager.onFighterHit(f, contactDmg, f.position.clone().setY(f.position.y + 1.0));
            }
          }
          if (this.vfx) {
            this.vfx.spawnHitSparks(f.position.clone().setY(f.position.y + 1.0), push, 0.75, LIGHT_PALETTE.cyan);
          }
        }
      }

      mirageRig.root.position.copy(mirageEntity.position);
      mirageRig.root.rotation.y = runYaw;
      mirageRig.update(dt, { state: 'run', speed: stepSpeed, verticalVelocity: 0 });
      fresnelMat.opacity = 0.56 + 0.16 * Math.sin(age * 11);

      trailTimer -= dt;
      if (trailTimer <= 0 && this.vfx) {
        trailTimer = 0.065;
        this.vfx.spawnDust(mirageEntity.position.clone().setY(mirageEntity.position.y + 0.85), {
          count: 2,
          size: 0.34,
          speed: 1.2,
          life: 0.35,
          spread: 0.22,
          color: Math.random() > 0.45 ? LIGHT_PALETTE.solarGold : LIGHT_PALETTE.cyan,
          alpha: 0.78,
        });
      }
      return true;
    });

    return true;
  }

  // ============================================================
  //  3. Tecla Q — Destello Solar (radio 4.6u, 13 daño + empuje + applyStun 1.1s)
  // ============================================================
  trySkill1() {
    if (
      this.cooldowns.solarflash > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    this.cooldowns.solarflash = 5.5 + (this.cooldownBonus || 0);
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 4.6 * areaMult;

    this.fighter.mesh.playAction('stomp_seismic', 0.36);
    this.manager.notifyAbilityUsed('solarflash', this.ownerId);
    if (this.sound && this.sound.playLightFlash) this.sound.playLightFlash();

    const origin = this.fighter.position.clone();
    const flashGroup = createSolarFlashGroup(radius);
    flashGroup.group.position.copy(origin).setY(origin.y + 0.85);
    this.scene.add(flashGroup.group);

    if (this.vfx) {
      this.vfx.spawnShockwave(origin, radius * 1.15, 0.36, LIGHT_PALETTE.solarGold);
      this.vfx.spawnShockwave(origin, radius * 0.72, 0.25, '#ffffff');
      this.vfx.spawnHitSparks(origin.clone().setY(origin.y + 1.0), new THREE.Vector3(0, 1, 0), 1.4, LIGHT_PALETTE.ivory);
      this.vfx.addTrauma(0.28);
    }

    const dmgScale = (this.fighter.survivalMods?.damageMult || 1) * (this.fighter.survivalMods?.auraDamageMult || 1);
    const dmg = Math.max(1, Math.round(13 * dmgScale));

    if (this.manager.isAuthoritative !== false) {
      for (const f of this.manager.fighters) {
        if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
        const dx = f.position.x - origin.x;
        const dz = f.position.z - origin.z;
        const dy = Math.abs(f.position.y - origin.y);
        const d = Math.hypot(dx, dz);
        if (d <= radius + (f.config?.radius || 0.45) && dy <= 3.6) {
          const pushDir =
            d > 0.15
              ? new THREE.Vector3(dx / d, 0.32, dz / d).normalize()
              : new THREE.Vector3(Math.sin(this.fighter.yaw), 0.32, Math.cos(this.fighter.yaw)).normalize();
          f.takeDamage(dmg, pushDir, 7.6, this.ownerId);
          if (f.applyStun) {
            f.applyStun(1.1, this.ownerId);
          }
          if (this.manager.onFighterHit) {
            this.manager.onFighterHit(f, dmg, f.position.clone().setY(f.position.y + 1.0));
          }
        }
      }
      if (this.manager.damageTurretsInSphere) {
        this.manager.damageTurretsInSphere(origin, radius, this.ownerId, 2);
      }
    }

    let age = 0;
    const life = 0.36;
    const cleanup = () => {
      if (flashGroup.group.parent) flashGroup.group.parent.remove(flashGroup.group);
      flashGroup.dispose();
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
      flashGroup.updateProgress(t);
      return true;
    });

    return true;
  }

  // ============================================================
  //  4. Tecla E — Prisma Refractario (alcance 18u, 1.35u sobre suelo, 5.0s, 9.0s CD)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (
      this.cooldowns.prism > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    this.cooldowns.prism = 9.0 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.38);
    this.fighter.mesh.playAction('heavy_throw', 0.36);
    this.manager.notifyAbilityUsed('prism', this.ownerId);
    if (this.sound && this.sound.playLightPrismSpawn) this.sound.playLightPrismSpawn();

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(PRISM_MAX_RANGE);

    // Clampeo horizontal hasta 18u desde el jugador
    const dx = aim.x - this.fighter.position.x;
    const dz = aim.z - this.fighter.position.z;
    const horizDist = Math.hypot(dx, dz);
    let targetX = aim.x;
    let targetZ = aim.z;
    if (horizDist > PRISM_MAX_RANGE && horizDist > 1e-4) {
      const s = PRISM_MAX_RANGE / horizDist;
      targetX = this.fighter.position.x + dx * s;
      targetZ = this.fighter.position.z + dz * s;
    } else if (horizDist < 2.2) {
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      targetX = this.fighter.position.x + fwdX * 4.5;
      targetZ = this.fighter.position.z + fwdZ * 4.5;
    }

    const arena = this.manager.arena || this.arena;
    const gy =
      arena && arena.getGroundHeightAt
        ? arena.getGroundHeightAt(targetX, this.fighter.position.y + 3.0, targetZ)
        : Math.max(0, this.fighter.position.y);
    const groundY = Number.isFinite(gy) && gy > -4 ? gy : Math.max(0, this.fighter.position.y);
    const center = new THREE.Vector3(targetX, groundY + PRISM_HEIGHT, targetZ);

    // Máximo 2 prismas simultáneos del mismo dueño
    const sameOwnerPrisms = (this.manager.lightPrisms || []).filter(
      (pr) => pr.alive && pr.ownerId === this.ownerId
    );
    if (sameOwnerPrisms.length >= 2 && sameOwnerPrisms[0].expireEarly) {
      sameOwnerPrisms[0].expireEarly();
    }

    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    const rig = createRefractionPrismGroup(1.0, isRival);
    rig.group.position.copy(center);
    rig.group.scale.setScalar(0.15);
    this.scene.add(rig.group);

    if (this.vfx) {
      this.vfx.spawnShockwave(new THREE.Vector3(targetX, groundY + 0.08, targetZ), 2.1, 0.3, LIGHT_PALETTE.cyan);
    }

    let age = 0;
    const prismRecord = {
      id: `prism_${this.ownerId}_${Date.now()}`,
      ownerId: this.ownerId,
      team: this.fighter.team || this.ownerId,
      center,
      rig,
      refractCd: 0,
      alive: true,
      expireEarly: () => {
        prismRecord.alive = false;
      },
    };
    this.manager.lightPrisms.push(prismRecord);

    const cleanup = () => {
      prismRecord.alive = false;
      const idx = this.manager.lightPrisms.indexOf(prismRecord);
      if (idx >= 0) this.manager.lightPrisms.splice(idx, 1);
      if (rig.group.parent) rig.group.parent.remove(rig.group);
      rig.dispose();
    };
    this._cleanups.add(cleanup);

    this._tasks.push((dt) => {
      if (!prismRecord.alive) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      age += dt;
      if (prismRecord.refractCd > 0) {
        prismRecord.refractCd = Math.max(0, prismRecord.refractCd - dt);
      }

      if (age < 0.2) {
        rig.group.scale.setScalar(0.15 + (age / 0.2) * 0.85);
      } else if (age > PRISM_DURATION - 0.24) {
        rig.group.scale.setScalar(Math.max(0.05, (PRISM_DURATION - age) / 0.24));
      } else {
        rig.group.scale.setScalar(1.0);
      }

      rig.update(dt, age);

      if (age >= PRISM_DURATION) {
        if (this.vfx) {
          this.vfx.spawnHitSparks(center, new THREE.Vector3(0, 1, 0), 0.9, LIGHT_PALETTE.cyan);
        }
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      return true;
    });

    return true;
  }
}
