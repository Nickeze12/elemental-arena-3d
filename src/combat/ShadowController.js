import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import {
  SHADOW_PALETTE,
  createShadowLanceGroup,
  createShadowPortalGroup,
  createShadowTendrilsGroup,
  createEclipseVeilDomeGroup,
} from '../utils/ShadowGeometry.js';

/**
 * ShadowController
 * ----------------------------------------------------------------------
 * Implementa las 4 habilidades del 9.º Maestro Elemental (Control de Sombra):
 *  1. Click Izq (`shadowlance`)  — Lanza Umbría veloz (11 daño, 0.52s CD; 16 daño en Emboscada)
 *  2. Click Der (`shadowstep`)   — Paso Sombrío: teletransporte 2.2u tras el rival (hasta 16u, 8.0s CD) o salto sombrío de 12u + Emboscada (2.5s)
 *  3. Tecla Q (`tendrils`)       — Tentáculos Oscuros al suelo (alcance 18u, radio 3.2u, persisten 2.0s drenando vida + otorgan hasta 2 cargas de +30% velocidad por 4.0s, 8.0s CD)
 *  4. Tecla E (`eclipseveil`)    — Velo de Eclipse (alcance 18u, radio 4.8u, 4.5s, 9.5s CD): defensa (-32% daño recibido) + camuflaje (+25% vel.) y corrosión enemiga (6 DPS + -30% vel.)
 */

const ABILITIES = [
  { id: 'shadowlance', slot: 'primary', name: 'Lanza Umbría', key: 'Click Izq', cooldown: 0.52 },
  { id: 'shadowstep', slot: 'secondary', name: 'Paso Sombrío', key: 'Click Der', cooldown: 8.0 },
  { id: 'tendrils', slot: 'skill1', name: 'Tentáculos Oscuros', key: 'Q', cooldown: 8.0 },
  { id: 'eclipseveil', slot: 'skill2', name: 'Velo de Eclipse', key: 'E', cooldown: 9.5 },
];

const SHADOW_STEP_RANGE = 16.0;
const SHADOW_STEP_BLINK = 12.0;
const TENDRILS_RANGE = 18.0;
const ECLIPSE_MAX_RANGE = 18.0;
const ECLIPSE_DURATION = 4.5;

export class ShadowController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'shadow';
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
      shadowlance: 0,
      shadowstep: 0,
      tendrils: 0,
      eclipseveil: 0,
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
      const bonus = ab.id === 'shadowlance' ? (this.cooldownBonus || 0) * 0.25 : this.cooldownBonus || 0;
      const total =
        ab.id === 'shadowstep'
          ? (ab.cooldown + bonus) * (this.fighter.survivalMods?.shadowStepCdMult || 1)
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
  //  1. Click Izq — Lanza Umbría (11 daño; 16 con Emboscada; 0.52s CD)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (
      this.cooldowns.shadowlance > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    this.cooldowns.shadowlance = 0.52 + (this.cooldownBonus || 0) * 0.25;

    const empowered = (this.fighter.shadowAmbushTimer || 0) > 0;
    if (empowered) {
      this.fighter.shadowAmbushTimer = 0;
    }

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.32);
    this.fighter.mesh.playAction(empowered ? 'heavy_throw' : 'punch_right', 0.28);
    this.manager.notifyAbilityUsed('shadowlance', this.ownerId);
    if (this.sound && this.sound.playShadowLance) this.sound.playShadowLance(empowered);

    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const origin = this.fighter.position.clone().addScaledVector(forward, 0.92);
    origin.y = this.fighter.position.y + 1.3;

    if (empowered && this.vfx) {
      this.vfx.spawnShockwave(origin, 1.85, 0.22, SHADOW_PALETTE.crimsonNeon);
      if (this.fighter.mesh && this.fighter.mesh.flash) {
        this.fighter.mesh.flash(SHADOW_PALETTE.crimsonNeon);
      }
    }

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(80);
    const dir = aim.clone().sub(origin);
    if (dir.lengthSq() < 1e-4) dir.copy(forward);
    dir.normalize();

    const lanceRig = createShadowLanceGroup(1.26, 0.068, empowered, isRival);
    lanceRig.group.position.copy(origin);
    lanceRig.group.lookAt(origin.clone().add(dir));
    this.scene.add(lanceRig.group);

    const baseDamage = empowered ? 16 : 11;
    const piercing = !!this.fighter.survivalMods?.auraShadowHarvest;
    let age = 0;

    const handleSoulHarvestHeal = (hit) => {
      if (hit && hit.type === 'fighter') {
        if (empowered && this.vfx) {
          this.vfx.spawnHitSparks(hit.point, hit.normal, 1.35, SHADOW_PALETTE.crimsonNeon);
          this.vfx.spawnShockwave(hit.point.clone().setY(Math.max(0.2, hit.point.y - 0.6)), 1.9, 0.24, SHADOW_PALETTE.crimsonNeon);
        } else if (this.vfx) {
          this.vfx.spawnHitSparks(hit.point, hit.normal, 1.0, SHADOW_PALETTE.abyssViolet);
        }
        if (piercing && this.manager.isAuthoritative !== false && this.fighter.isAlive) {
          this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + 3);
        }
      }
    };

    const proj = new Projectile({
      mesh: lanceRig.group,
      velocity: dir.clone().multiplyScalar(50),
      radius: empowered ? 0.28 : 0.24,
      gravity: 0,
      life: 1.15,
      damage: baseDamage,
      knockback: empowered ? 7.8 : 5.4,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: empowered ? 'shadow_lance_ambush' : 'shadow_lance',
      piercing,
      onPierceHit: (hit) => handleSoulHarvestHeal(hit),
      onUpdate: (dt) => {
        age += dt;
        lanceRig.update(dt, age);
      },
      onImpact: (hit) => {
        handleSoulHarvestHeal(hit);
        lanceRig.dispose();
      },
      onExpire: () => lanceRig.dispose(),
    });
    this.manager.addProjectile(proj);
    return true;
  }

  // ============================================================
  //  2. Click Der — Paso Sombrío (teletransporte detrás de rival o salto sombrío)
  // ============================================================
  trySecondary(customAimPoint = null) {
    if (
      this.cooldowns.shadowstep > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    const cdMult = this.fighter.survivalMods?.shadowStepCdMult || 1;
    this.cooldowns.shadowstep = (8.0 + (this.cooldownBonus || 0)) * cdMult;

    const originPos = this.fighter.position.clone();
    const yaw = this.aimProvider.getAimYaw();
    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(SHADOW_STEP_RANGE + 4);

    const aimDir = aim.clone().sub(originPos);
    aimDir.y = 0;
    if (aimDir.lengthSq() < 1e-4) {
      aimDir.set(Math.sin(yaw), 0, Math.cos(yaw));
    } else {
      aimDir.normalize();
    }

    const arena = this.manager.arena || this.arena;
    const arenaR = arena && arena.getBoundsRadius ? arena.getBoundsRadius() : 30;
    const maxSafeR = Math.max(4, arenaR - 1.5);
    const hasAbyss = arena && arena.hasAbyss !== false;

    const clampToArena = (vec) => {
      if (hasAbyss) {
        const d = Math.hypot(vec.x, vec.z);
        if (d > maxSafeR && d > 1e-4) {
          const s = maxSafeR / d;
          vec.x *= s;
          vec.z *= s;
        }
      } else {
        vec.x = THREE.MathUtils.clamp(vec.x, -maxSafeR, maxSafeR);
        vec.z = THREE.MathUtils.clamp(vec.z, -maxSafeR, maxSafeR);
      }
      if (arena && arena.resolveCollisions) {
        arena.resolveCollisions(vec, this.fighter.config?.radius || 0.45, vec.y, null);
      }
      if (arena && arena.getGroundHeightAt) {
        const gy = arena.getGroundHeightAt(vec.x, Math.max(vec.y + 3.0, 4.0), vec.z);
        if (Number.isFinite(gy) && gy > -4) {
          vec.y = gy;
        }
      }
      return vec;
    };

    // Buscar rival o monstruo hostil hasta 16u cerca de la línea o punto de mira
    let bestTarget = null;
    let bestScore = Infinity;

    for (const f of this.manager.fighters) {
      if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
      const toF = f.position.clone().sub(originPos);
      const horizDist = Math.hypot(toF.x, toF.z);
      if (horizDist > SHADOW_STEP_RANGE || horizDist < 0.4) continue;

      const proj = toF.x * aimDir.x + toF.z * aimDir.z;
      if (proj < -0.5) continue;
      const perpX = toF.x - aimDir.x * proj;
      const perpZ = toF.z - aimDir.z * proj;
      const perpDist = Math.hypot(perpX, perpZ);
      const distToAimPt = Math.hypot(f.position.x - aim.x, f.position.z - aim.z);

      if (perpDist <= 3.8 || distToAimPt <= 3.6) {
        const score = perpDist + horizDist * 0.12;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = f;
        }
      }
    }

    let dest = new THREE.Vector3();
    let finalYaw = yaw;

    if (bestTarget) {
      const targetFwdX = Math.sin(bestTarget.yaw || 0);
      const targetFwdZ = Math.cos(bestTarget.yaw || 0);
      dest.set(
        bestTarget.position.x - targetFwdX * 2.2,
        bestTarget.position.y,
        bestTarget.position.z - targetFwdZ * 2.2
      );
      clampToArena(dest);
      finalYaw = Math.atan2(bestTarget.position.x - dest.x, bestTarget.position.z - dest.z);
    } else {
      const aimDist = Math.min(SHADOW_STEP_BLINK, Math.max(4.5, Math.hypot(aim.x - originPos.x, aim.z - originPos.z)));
      dest.set(
        originPos.x + aimDir.x * aimDist,
        originPos.y,
        originPos.z + aimDir.z * aimDist
      );
      clampToArena(dest);
      finalYaw = Math.atan2(aimDir.x, aimDir.z);
    }

    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    this._spawnPortalFX(originPos, isRival);
    this._spawnPortalFX(dest, isRival);

    this.fighter.position.copy(dest);
    this.fighter.velocity.set(0, 0, 0);
    this.fighter.yaw = finalYaw;
    if (this.fighter._netPos) this.fighter._netPos.copy(dest);
    if (typeof this.fighter._netYaw === 'number') this.fighter._netYaw = finalYaw;
    if (this.fighter.mesh && this.fighter.mesh.root) {
      this.fighter.mesh.root.position.copy(dest);
      this.fighter.mesh.root.rotation.y = finalYaw;
      this.fighter.mesh.playAction('dash', 0.3);
      if (this.fighter.mesh.setShadowVeil) this.fighter.mesh.setShadowVeil(true);
      if (this.fighter.mesh.flash) this.fighter.mesh.flash(SHADOW_PALETTE.abyssViolet);
    }

    // Intangibilidad breve + Camuflaje + Emboscada para siguiente ataque básico
    this.fighter.shadowStepVeilTimer = 0.35;
    this.fighter.shadowAmbushTimer = 2.5;
    this.manager.notifyAbilityUsed('shadowstep', this.ownerId);
    if (this.sound && this.sound.playShadowStep) this.sound.playShadowStep();

    return true;
  }

  _spawnPortalFX(groundPos, isRival) {
    const portal = createShadowPortalGroup(1.05, isRival);
    portal.group.position.copy(groundPos);
    this.scene.add(portal.group);

    if (this.vfx) {
      this.vfx.spawnShockwave(groundPos, 2.0, 0.28, SHADOW_PALETTE.abyssViolet);
    }

    let age = 0;
    const life = 0.72;
    const cleanup = () => {
      if (portal.group.parent) portal.group.parent.remove(portal.group);
      portal.dispose();
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
      portal.update(dt, age);
      portal.setFade(1 - t * t);
      return true;
    });
  }

  // ============================================================
  //  3. Tecla Q — Zarcillos Drenavida (18u alcance, radio 3.2u, 13 daño + Root 1.3s + +10 HP/obj, máx +20)
  // ============================================================
  trySkill1(customAimPoint = null) {
    if (
      this.cooldowns.tendrils > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    this.cooldowns.tendrils = 8.0 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.36);
    this.fighter.mesh.playAction('heavy_throw', 0.34);
    this.manager.notifyAbilityUsed('tendrils', this.ownerId);
    if (this.sound && this.sound.playShadowLance) this.sound.playShadowLance(false);

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(TENDRILS_RANGE);

    const dx = aim.x - this.fighter.position.x;
    const dz = aim.z - this.fighter.position.z;
    const horizDist = Math.hypot(dx, dz);
    let targetX = aim.x;
    let targetZ = aim.z;
    if (horizDist > TENDRILS_RANGE && horizDist > 1e-4) {
      const s = TENDRILS_RANGE / horizDist;
      targetX = this.fighter.position.x + dx * s;
      targetZ = this.fighter.position.z + dz * s;
    } else if (horizDist < 2.2) {
      targetX = this.fighter.position.x + Math.sin(yaw) * 4.5;
      targetZ = this.fighter.position.z + Math.cos(yaw) * 4.5;
    }

    const arena = this.manager.arena || this.arena;
    const startPos = this.fighter.position.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.7, 0.58, Math.cos(yaw) * 0.7));
    const gyDest =
      arena && arena.getGroundHeightAt
        ? arena.getGroundHeightAt(targetX, this.fighter.position.y + 3.0, targetZ)
        : Math.max(0, this.fighter.position.y);
    const destY = Number.isFinite(gyDest) && gyDest > -4 ? gyDest : Math.max(0, this.fighter.position.y);
    const destPoint = new THREE.Vector3(targetX, destY + 0.58, targetZ);

    const dir = destPoint.clone().sub(startPos);
    const travelDist = Math.max(1.5, dir.length());
    dir.normalize();
    const speed = 34.0;
    const life = Math.min(0.65, travelDist / speed + 0.04);

    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';
    const orbGroup = new THREE.Group();
    const seekerRig = createShadowLanceGroup(0.92, 0.056, false, isRival);
    orbGroup.add(seekerRig.group);
    orbGroup.position.copy(startPos);
    orbGroup.lookAt(destPoint);
    this.scene.add(orbGroup);

    let age = 0;
    let erupted = false;
    const triggerAt = (pos) => {
      if (erupted) return;
      erupted = true;
      const gY =
        arena && arena.getGroundHeightAt
          ? arena.getGroundHeightAt(pos.x, pos.y + 2.5, pos.z)
          : Math.max(0, this.fighter.position.y);
      const eruptionPos = new THREE.Vector3(pos.x, Number.isFinite(gY) && gY > -4 ? gY : Math.max(0, pos.y), pos.z);
      this._triggerTendrilEruption(eruptionPos, isRival);
    };

    const proj = new Projectile({
      mesh: orbGroup,
      velocity: dir.clone().multiplyScalar(speed),
      radius: 0.22,
      gravity: 0,
      life,
      damage: 0,
      knockback: 0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'shadow_tendrils_seeker',
      onSubStep: (p) => {
        if (arena && arena.getGroundHeightAt) {
          const gy = arena.getGroundHeightAt(p.position.x, p.position.y + 1.5, p.position.z);
          if (Number.isFinite(gy) && gy > -4) {
            p.position.y = Math.max(gy + 0.52, p.position.y);
          }
        }
        const dxD = p.position.x - destPoint.x;
        const dzD = p.position.z - destPoint.z;
        if (dxD * dxD + dzD * dzD <= 0.64) {
          p.alive = false;
          triggerAt(destPoint);
          seekerRig.dispose();
          return true;
        }
        return false;
      },
      onUpdate: (dt) => {
        age += dt;
        seekerRig.update(dt, age);
      },
      onImpact: (hit) => {
        triggerAt(hit.point || destPoint);
        seekerRig.dispose();
      },
      onExpire: (p) => {
        triggerAt(p.position);
        seekerRig.dispose();
      },
    });
    this.manager.addProjectile(proj);
    return true;
  }

  _triggerTendrilEruption(centerPos, isRival) {
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 3.2 * areaMult;
    const tendrilsRig = createShadowTendrilsGroup(radius, isRival);
    tendrilsRig.group.position.copy(centerPos);
    this.scene.add(tendrilsRig.group);

    if (this.sound && this.sound.playShadowTendrils) this.sound.playShadowTendrils();
    if (this.vfx) {
      this.vfx.spawnShockwave(centerPos, radius * 1.15, 0.32, SHADOW_PALETTE.crimsonNeon);
      this.vfx.addTrauma(0.22);
    }

    const dmgScale = (this.fighter.survivalMods?.damageMult || 1) * (this.fighter.survivalMods?.auraDamageMult || 1);
    const initialDmg = Math.max(1, Math.round(6 * dmgScale));
    const tickDmg = Math.max(1, Math.round(3 * dmgScale));
    let healedTotal = 0;

    // Otorga la primera carga (+30% vel., 4.0s) al emerger los Tentáculos Oscuros
    if (this.fighter.isAlive && this.fighter.applyShadowSpeedBuff) {
      this.fighter.applyShadowSpeedBuff(4.0);
    }

    const runDrainPulse = (isInitial) => {
      if (this.manager.isAuthoritative === false) return;
      const pulseDmg = isInitial ? initialDmg : tickDmg;
      const healPerTarget = isInitial ? 6 : 4;
      let drainedNow = 0;
      for (const f of this.manager.fighters) {
        if (!f || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
        const dx = f.position.x - centerPos.x;
        const dz = f.position.z - centerPos.z;
        const dy = Math.abs(f.position.y - centerPos.y);
        const d = Math.hypot(dx, dz);
        if (d <= radius + (f.config?.radius || 0.45) && dy <= 3.6) {
          const pushDir =
            d > 0.15
              ? new THREE.Vector3(-dx / d, 0.22, -dz / d).normalize()
              : new THREE.Vector3(0, 0.35, 1).normalize();
          f.takeDamage(pulseDmg, pushDir, isInitial ? 3.8 : 1.5, this.ownerId);
          if (isInitial && f.applyRoot) f.applyRoot(1.3, this.ownerId);
          if (this.manager.onFighterHit) {
            this.manager.onFighterHit(f, pulseDmg, f.position.clone().setY(f.position.y + 1.0));
          }

          if (healedTotal < 24 && this.fighter.isAlive) {
            const healAmt = Math.min(healPerTarget, 24 - healedTotal);
            healedTotal += healAmt;
            drainedNow += healAmt;
            this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + healAmt);
          }
        }
      }
      if (drainedNow > 0 && this.fighter.mesh && this.fighter.mesh.flash) {
        this.fighter.mesh.flash(SHADOW_PALETTE.crimsonNeon);
      }
      if (isInitial && this.manager.damageTurretsInSphere) {
        this.manager.damageTurretsInSphere(centerPos, radius, this.ownerId, 2);
      }
    };

    runDrainPulse(true);

    let age = 0;
    const life = 2.0;
    let drainTimer = 0.6;
    let grantedSecondSpeedStack = false;
    const cleanup = () => {
      if (tendrilsRig.group.parent) tendrilsRig.group.parent.remove(tendrilsRig.group);
      tendrilsRig.dispose();
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

      if (!grantedSecondSpeedStack && age >= 0.6) {
        grantedSecondSpeedStack = true;
        if (this.fighter.isAlive && this.fighter.applyShadowSpeedBuff) {
          this.fighter.applyShadowSpeedBuff(4.0);
        }
      }

      drainTimer -= dt;
      if (drainTimer <= 0) {
        drainTimer += 0.6;
        runDrainPulse(false);
      }

      const casterLocalOffset = this.fighter.position.clone().sub(centerPos);
      casterLocalOffset.y += 1.1;
      tendrilsRig.update(t, age, casterLocalOffset);
      return true;
    });
  }

  // ============================================================
  //  4. Tecla E — Velo de Eclipse (alcance 18u, radio 4.8u, 4.5s, 9.5s CD)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (
      this.cooldowns.eclipseveil > 0 ||
      !this.fighter.isAlive ||
      this.fighter.isFrozen ||
      this.fighter.isStunned
    ) {
      return false;
    }

    this.cooldowns.eclipseveil = 9.5 + (this.cooldownBonus || 0);

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.38);
    this.fighter.mesh.playAction('stomp_seismic', 0.38);
    this.manager.notifyAbilityUsed('eclipseveil', this.ownerId);
    if (this.sound && this.sound.playShadowEclipse) this.sound.playShadowEclipse();

    const aim =
      customAimPoint && customAimPoint.isVector3
        ? customAimPoint.clone()
        : this.aimProvider.getAimPoint(ECLIPSE_MAX_RANGE);

    const dx = aim.x - this.fighter.position.x;
    const dz = aim.z - this.fighter.position.z;
    const horizDist = Math.hypot(dx, dz);
    let targetX = aim.x;
    let targetZ = aim.z;
    if (horizDist > ECLIPSE_MAX_RANGE && horizDist > 1e-4) {
      const s = ECLIPSE_MAX_RANGE / horizDist;
      targetX = this.fighter.position.x + dx * s;
      targetZ = this.fighter.position.z + dz * s;
    } else if (horizDist < 1.2) {
      targetX = this.fighter.position.x;
      targetZ = this.fighter.position.z;
    }

    const arena = this.manager.arena || this.arena;
    const gy =
      arena && arena.getGroundHeightAt
        ? arena.getGroundHeightAt(targetX, this.fighter.position.y + 3.0, targetZ)
        : Math.max(0, this.fighter.position.y);
    const groundY = Number.isFinite(gy) && gy > -4 ? gy : Math.max(0, this.fighter.position.y);
    const center = new THREE.Vector3(targetX, groundY, targetZ);

    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 4.8 * areaMult;
    const isRival = this.fighter.team !== 'team_blue' && this.ownerId !== 'player';

    // Máximo 1 domo simultáneo del mismo lanzador para mantener claridad visual
    for (const z of [...(this.manager.eclipseZones || [])]) {
      if (z && z.alive && z.ownerId === this.ownerId && z.expireEarly) {
        z.expireEarly();
      }
    }

    const domeRig = createEclipseVeilDomeGroup(radius, isRival);
    domeRig.group.position.copy(center);
    this.scene.add(domeRig.group);

    if (this.vfx) {
      this.vfx.spawnShockwave(center.clone().setY(groundY + 0.08), radius, 0.36, SHADOW_PALETTE.abyssViolet);
    }

    const zoneRecord = {
      id: `eclipse_${this.ownerId}_${Date.now()}`,
      ownerId: this.ownerId,
      team: this.fighter.team || this.ownerId,
      center,
      radius,
      alive: true,
      expireEarly: () => {
        zoneRecord.alive = false;
      },
    };
    if (!this.manager.eclipseZones) this.manager.eclipseZones = [];
    this.manager.eclipseZones.push(zoneRecord);

    const cleanup = () => {
      zoneRecord.alive = false;
      const idx = this.manager.eclipseZones.indexOf(zoneRecord);
      if (idx >= 0) this.manager.eclipseZones.splice(idx, 1);
      if (domeRig.group.parent) domeRig.group.parent.remove(domeRig.group);
      domeRig.dispose();
    };
    this._cleanups.add(cleanup);

    let age = 0;
    let tickAccum = 0.25;
    const dmgScale = (this.fighter.survivalMods?.damageMult || 1) * (this.fighter.survivalMods?.auraDamageMult || 1);
    const tickDmg = Math.max(1, Number((3 * dmgScale).toFixed(2))); // 6 DPS (3 cada 0.5s)

    this._tasks.push((dt) => {
      if (!zoneRecord.alive) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      age += dt;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = age > ECLIPSE_DURATION - 0.35 ? Math.max(0, (ECLIPSE_DURATION - age) / 0.35) : 1;
      domeRig.update(dt, age, Math.min(fadeIn, fadeOut));

      tickAccum -= dt;
      if (tickAccum <= 0) {
        tickAccum = 0.5;
        if (this.manager.isAuthoritative !== false) {
          for (const f of this.manager.fighters) {
            if (!f || !f.isAlive || f.isMirage || !this.manager.isHostile(this.ownerId, f)) continue;
            const dxh = f.position.x - center.x;
            const dzh = f.position.z - center.z;
            if (Math.hypot(dxh, dzh) <= radius + (f.config?.radius || 0.45) && Math.abs(f.position.y - center.y) <= radius) {
              const push = new THREE.Vector3(dxh, 0.12, dzh);
              if (push.lengthSq() < 1e-4) push.set(0, 0.2, 1);
              push.normalize();
              f.takeDamage(tickDmg, push, 0.8, this.ownerId);
              if (this.vfx) {
                this.vfx.spawnHitSparks(f.position.clone().setY(f.position.y + 0.9), push, 0.72, SHADOW_PALETTE.crimsonNeon);
              }
            }
          }
        }
      }

      if (age >= ECLIPSE_DURATION) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      return true;
    });

    return true;
  }
}
