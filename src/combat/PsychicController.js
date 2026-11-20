import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import { createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import {
  PSYCHIC_PALETTE,
  createPsychicOrbGroup,
  createConfusionPulseMesh,
  createGravityVortexGroup,
} from '../utils/PsychicGeometry.js';

/**
 * PsychicController
 * ----------------------------------------------------------------------
 * Implementa las 4 habilidades del 6.º Maestro Elemental (Psíquico):
 *  1. Click Izq (`psiorb`)   — Orbe Telequinético (11 daño, 0.60s CD, ligero magnetismo)
 *  2. Click Der (`confuse`)  — Pulso de Confusión (10 daño + applyConfusion 3.0s, 8.0s CD)
 *  3. Tecla Q (`psiwave`)    — Onda Telequinética (domo 4.8u*areaMult, 12 daño, knockback 15.5, destruye proyectiles)
 *  4. Tecla E (`implosion`)  — Implosión Astral (vórtice 2.2s que atrae en 4.6u y detona 18 daño, 9.5s CD)
 */

const ABILITIES = [
  { id: 'psiorb', slot: 'primary', name: 'Orbe Psíquico', key: 'Click Izq', cooldown: 0.70 },
  { id: 'confuse', slot: 'secondary', name: 'Pulso Confusión', key: 'Click Der', cooldown: 6.0 },
  { id: 'psiwave', slot: 'skill1', name: 'Onda Mental', key: 'Q', cooldown: 5.5 },
  { id: 'implosion', slot: 'skill2', name: 'Implosión Astral', key: 'E', cooldown: 7.5 },
];

export class PsychicController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'psychic';
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
      psiorb: 0,
      confuse: 0,
      psiwave: 0,
      implosion: 0,
    };

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
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  // ============================================================
  //  1. Click Izq — Orbe Telequinético (11 daño, 0.60s CD, ligero magnetismo)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (this.cooldowns.psiorb > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.psiorb = 0.70 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.35);
    this.fighter.mesh.playAction('punch_right', 0.26);
    this.manager.notifyAbilityUsed('psiorb', this.ownerId);
    if (this.sound && this.sound.playPsychicOrb) this.sound.playPsychicOrb();

    const overload = !!this.fighter.survivalMods?.auraPsychicOverload;
    if (overload) {
      this._spawnTelekineticOrb(customAimPoint, -0.075, 1.3);
      this._spawnTelekineticOrb(customAimPoint, 0.075, 1.3);
    } else {
      this._spawnTelekineticOrb(customAimPoint, 0, 1.0);
    }
    return true;
  }

  _spawnTelekineticOrb(customAimPoint, angleOffset = 0, damageScale = 1.0) {
    const yaw = this.aimProvider.getAimYaw();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.08);
    spawnPos.y = this.fighter.position.y + 1.34;

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();
    if (angleOffset !== 0) {
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset).normalize();
    }

    const orb = createPsychicOrbGroup(0.24, 2);
    orb.group.position.copy(spawnPos);
    this.scene.add(orb.group);

    const speed = 40;
    let trailT = 0;
    const toF = new THREE.Vector3();
    const curDir = new THREE.Vector3();

    const proj = new Projectile({
      mesh: orb.group,
      velocity: dir.multiplyScalar(speed),
      radius: 0.28,
      gravity: 0.08,
      life: 1.6,
      damage: Math.round(9 * damageScale),
      knockback: 5.2,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'psychic_orb',
      onUpdate: (dt, p) => {
        for (let i = 0; i < orb.rings.length; i++) {
          orb.rings[i].rotation.x += dt * (4.5 + i * 2);
          orb.rings[i].rotation.y += dt * (5.2 - i * 1.5);
        }

        // Leve atracción gravitatoria si el orbe pasa cerca de la trayectoria de un enemigo
        const curSpd = p.velocity.length() || speed;
        curDir.copy(p.velocity).divideScalar(curSpd);
        let bestTarget = null;
        let bestDist = Infinity;
        let bestScore = -Infinity;
        for (const f of this.manager.fighters) {
          if (!f || !this.manager.isHostile(this.ownerId, f)) continue;
          toF.set(f.position.x - p.position.x, (f.position.y + 1.0) - p.position.y, f.position.z - p.position.z);
          const dist = toF.length();
          if (dist < 0.7 || dist > 13.5) continue;
          toF.divideScalar(dist);
          const dot = curDir.dot(toF);
          // Acepta enemigos laterales cercanos (dot > 0.35) para simular atracción gravitatoria suave
          if (dot > 0.35) {
            const score = dot - dist * 0.032;
            if (score > bestScore) {
              bestScore = score;
              bestDist = dist;
              bestTarget = f;
            }
          }
        }
        if (bestTarget) {
          toF.set(
            bestTarget.position.x - p.position.x,
            (bestTarget.position.y + 1.0) - p.position.y,
            bestTarget.position.z - p.position.z
          ).normalize();
          const gravPull = 2.4 + 1.8 * Math.max(0, 1 - bestDist / 13.5);
          curDir.lerp(toF, Math.min(0.35, gravPull * dt)).normalize();
          p.velocity.copy(curDir).multiplyScalar(curSpd);
        }

        trailT -= dt;
        if (trailT <= 0 && this.vfx) {
          trailT = 0.045;
          this.vfx.spawnDust(p.position, {
            count: 1,
            size: 0.28,
            speed: 0.5,
            life: 0.26,
            color: PSYCHIC_PALETTE.magenta,
            alpha: 0.75,
          });
        }
      },
      onImpact: (_hit, p) => {
        if (this.vfx) {
          this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 0.9, PSYCHIC_PALETTE.magenta);
        }
        orb.dispose();
      },
      onExpire: () => orb.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  2. Click Der — Pulso de Confusión (10 daño + applyConfusion 3.0s, 8.0s CD)
  // ============================================================
  trySecondary(customAimPoint = null) {
    if (this.cooldowns.confuse > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.confuse = 6.0 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.42);
    this.fighter.mesh.playAction('punch_left', 0.34);
    this.manager.notifyAbilityUsed('confuse', this.ownerId);
    if (this.sound && this.sound.playPsychicConfuse) this.sound.playPsychicConfuse();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.1);
    spawnPos.y = this.fighter.position.y + 1.32;

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();

    const pulse = createConfusionPulseMesh(0.32);
    pulse.group.position.copy(spawnPos);
    pulse.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(pulse.group);

    let trailT = 0;
    const proj = new Projectile({
      mesh: pulse.group,
      velocity: dir.multiplyScalar(48),
      radius: 0.36,
      gravity: 0,
      life: 1.5,
      damage: 10,
      knockback: 4.5,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'psychic_confuse',
      onUpdate: (dt, p) => {
        pulse.spiral.rotation.z += dt * 11.0;
        trailT -= dt;
        if (trailT <= 0 && this.vfx) {
          trailT = 0.035;
          this.vfx.spawnDust(p.position, {
            count: 2,
            size: 0.34,
            speed: 0.8,
            life: 0.3,
            color: PSYCHIC_PALETTE.glowPink,
            alpha: 0.8,
          });
        }
      },
      onImpact: (hit, p) => {
        if (hit && hit.type === 'fighter' && hit.fighter && hit.fighter.applyConfusion) {
          hit.fighter.applyConfusion(3.0, this.ownerId);
        }
        if (this.vfx) {
          this.vfx.spawnShockwave(p.position.clone().setY(Math.max(0.1, p.position.y)), 1.9, 0.32, PSYCHIC_PALETTE.magenta);
          this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 1.1, PSYCHIC_PALETTE.lavender);
        }
        pulse.dispose();
      },
      onExpire: () => pulse.dispose(),
    });
    this.manager.addProjectile(proj);
    return true;
  }

  // ============================================================
  //  3. Tecla Q — Onda Telequinética (domo 4.8u*areaMult, 12 daño, fuerte knockback, destruye proyectiles)
  // ============================================================
  trySkill1() {
    if (this.cooldowns.psiwave > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.psiwave = 5.5 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.42);
    this.fighter.mesh.playAction('guard_wall', 0.4);
    this.manager.notifyAbilityUsed('psiwave', this.ownerId);
    if (this.sound && this.sound.playPsychicWave) this.sound.playPsychicWave();

    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 4.8 * areaMult;
    const center = this.fighter.position.clone().setY(this.fighter.position.y + 0.9);

    // Domo visual expansivo de distorsión espacial Fresnel (sin bordes negros)
    const domeGeo = new THREE.SphereGeometry(1, 28, 18);
    const domeMat = createEnergyVFXMaterial({
      coreColor: '#3b0764',
      rimColor: PSYCHIC_PALETTE.glowPink,
      opacity: 0.68,
      additive: true,
      fresnelPower: 2.3,
      rimIntensity: 1.5,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(center);
    dome.scale.setScalar(0.2);
    dome.userData.noOutline = true;
    this.scene.add(dome);

    const waveRingGeo = new THREE.TorusGeometry(1, 0.045, 10, 42);
    waveRingGeo.rotateX(Math.PI * 0.5);
    const waveRingMat = createEnergyVFXMaterial({
      coreColor: PSYCHIC_PALETTE.lavender,
      rimColor: PSYCHIC_PALETTE.magenta,
      opacity: 0.9,
      additive: true,
      depthWrite: false,
    });
    const waveRing = new THREE.Mesh(waveRingGeo, waveRingMat);
    waveRing.position.copy(center);
    waveRing.rotation.z = 0.22;
    waveRing.scale.setScalar(0.2);
    waveRing.userData.noOutline = true;
    this.scene.add(waveRing);

    let age = 0;
    const fxDur = 0.36;
    const cleanup = () => {
      if (dome.parent) this.scene.remove(dome);
      if (waveRing.parent) this.scene.remove(waveRing);
      domeGeo.dispose();
      domeMat.dispose();
      waveRingGeo.dispose();
      waveRingMat.dispose();
    };
    this._cleanups.add(cleanup);
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / fxDur);
      const s = 0.2 + radius * (1 - (1 - t) * (1 - t));
      dome.scale.setScalar(s);
      waveRing.scale.setScalar(s * 1.06);
      waveRing.rotation.y += dt * 7;
      domeMat.opacity = 0.68 * (1 - t);
      waveRingMat.opacity = 0.9 * (1 - t);
      if (age >= fxDur) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      return true;
    });

    if (this.vfx) {
      this.vfx.spawnShockwave(this.fighter.position.clone().setY(this.fighter.position.y + 0.1), radius, 0.38, PSYCHIC_PALETTE.magenta);
      this.vfx.spawnShockwave(this.fighter.position.clone().setY(this.fighter.position.y + 0.14), radius * 0.7, 0.28, PSYCHIC_PALETTE.lavender);
    }

    // Destruye todos los proyectiles hostiles dentro del domo
    const radiusSq = radius * radius;
    for (const p of this.manager.projectiles) {
      if (!p.alive) continue;
      if (p.ownerId === this.ownerId) continue;
      const team = this.manager.getFighterTeam(p.ownerId);
      if (team && team === (this.fighter.team || this.ownerId)) continue;
      if (p.position.distanceToSquared(center) <= radiusSq) {
        p.alive = false;
        if (p.onExpire) p.onExpire(p);
        if (this.vfx) {
          this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 0.9, PSYCHIC_PALETTE.lavender);
        }
      }
    }

    // Empuje fuerte + daño a luchadores hostiles y torretas en radio
    this.manager.damageTurretsInSphere(center, radius, this.ownerId, 1);

    for (const f of this.manager.fighters) {
      if (!this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - center.x;
      const dy = (f.position.y + 0.9) - center.y;
      const dz = f.position.z - center.z;
      const maxR = radius + f.config.radius;
      if (dx * dx + dy * dy + dz * dz <= maxR * maxR) {
        const pushDir = new THREE.Vector3(dx, 0, dz);
        if (pushDir.lengthSq() < 1e-4) {
          pushDir.set(Math.sin(yaw), 0, Math.cos(yaw));
        }
        pushDir.normalize().setY(0.42).normalize();
        f.takeDamage(12, pushDir, 15.5, this.ownerId);
        if (this.vfx) {
          this.vfx.spawnHitSparks(f.position.clone().setY(f.position.y + 1.0), pushDir, 1.15, PSYCHIC_PALETTE.magenta);
        }
      }
    }

    return true;
  }

  // ============================================================
  //  4. Tecla E — Implosión Astral (vórtice 2.2s, radio 4.6u, atrae y detona 18 daño)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (this.cooldowns.implosion > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.implosion = 7.5 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.48);
    this.fighter.mesh.playAction('heavy_throw', 0.44);
    this.manager.notifyAbilityUsed('implosion', this.ownerId);
    if (this.sound && this.sound.playPsychicOrb) this.sound.playPsychicOrb();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.15);
    spawnPos.y = this.fighter.position.y + 1.38;

    const aim = customAimPoint && customAimPoint.isVector3
      ? customAimPoint.clone()
      : this.aimProvider.getAimPoint(80);
    const dir = aim.sub(spawnPos).normalize();

    const seedOrb = createPsychicOrbGroup(0.32, 2);
    seedOrb.group.position.copy(spawnPos);
    this.scene.add(seedOrb.group);

    let opened = false;
    const openSingularity = (pos) => {
      if (opened) return;
      opened = true;
      seedOrb.dispose();
      this._spawnGravityVortex(pos);
    };

    const proj = new Projectile({
      mesh: seedOrb.group,
      velocity: dir.multiplyScalar(32),
      radius: 0.34,
      gravity: 0.4,
      life: 0.625, // Alcance máximo 20 u antes de abrir el vórtice
      damage: 0,
      knockback: 0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'psychic_implosion_seed',
      onUpdate: (dt) => {
        for (const r of seedOrb.rings) r.rotation.y += dt * 7;
      },
      onImpact: (_hit, p) => openSingularity(p.position.clone()),
      onExpire: (p) => openSingularity(p.position.clone()),
    });
    this.manager.addProjectile(proj);
    return true;
  }

  _spawnGravityVortex(rawPos) {
    const areaMult = this.fighter.survivalMods?.areaMult || 1;
    const radius = 4.6 * areaMult;
    const arena = this.manager.arena || this.arena;
    const gy = arena && arena.getGroundHeightAt
      ? arena.getGroundHeightAt(rawPos.x, rawPos.y + 2.5, rawPos.z)
      : Math.max(0, rawPos.y);
    const center = new THREE.Vector3(
      rawPos.x,
      Number.isFinite(gy) && gy > -4 ? Math.max(gy + 1.05, rawPos.y) : Math.max(1.05, rawPos.y),
      rawPos.z
    );

    const vortex = createGravityVortexGroup(radius);
    vortex.group.position.copy(center);
    vortex.group.scale.setScalar(0.15);
    this.scene.add(vortex.group);

    if (this.sound && this.sound.playPsychicSingularity) this.sound.playPsychicSingularity(false);

    let age = 0;
    const duration = 2.2;
    let sparkT = 0;
    const pullVec = new THREE.Vector3();

    const cleanup = () => vortex.dispose();
    this._cleanups.add(cleanup);

    this._tasks.push((dt) => {
      age += dt;
      if (age < 0.22) {
        const s = 0.15 + (age / 0.22) * 0.85;
        vortex.group.scale.setScalar(s);
      } else {
        vortex.group.scale.setScalar(1 + 0.06 * Math.sin(age * 10));
      }

      vortex.orbitA.rotation.z += dt * 5.2;
      vortex.orbitA.rotation.x += dt * 2.1;
      vortex.orbitB.rotation.y -= dt * 4.8;
      vortex.core.rotation.y += dt * 3.8;
      if (vortex.fieldRing) vortex.fieldRing.rotation.y -= dt * 4.2;

      sparkT -= dt;
      if (sparkT <= 0 && this.vfx) {
        sparkT = 0.14;
        const a = Math.random() * Math.PI * 2;
        const rp = new THREE.Vector3(center.x + Math.cos(a) * radius * 0.75, center.y, center.z + Math.sin(a) * radius * 0.75);
        this.vfx.spawnDust(rp, {
          count: 1,
          size: 0.42,
          speed: 1.0,
          life: 0.35,
          color: PSYCHIC_PALETTE.magenta,
          alpha: 0.75,
        });
      }

      // Atracción gravitatoria suave hacia el centro del vórtice
      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f)) continue;
        if (f.isRooted || f.isFrozen) continue;
        pullVec.set(center.x - f.position.x, 0, center.z - f.position.z);
        const d = pullVec.length();
        if (d > 0.65 && d <= radius + 0.5) {
          pullVec.divideScalar(d);
          const pullStrength = 7.2;
          f.position.addScaledVector(pullVec, pullStrength * dt);
        }
      }

      if (age >= duration) {
        this._cleanups.delete(cleanup);
        cleanup();
        this._detonateImplosion(center, radius);
        return false;
      }
      return true;
    });
  }

  _detonateImplosion(center, radius) {
    if (this.sound && this.sound.playPsychicSingularity) this.sound.playPsychicSingularity(true);
    if (this.vfx) {
      this.vfx.spawnShockwave(center.clone().setY(Math.max(0.1, center.y - 0.85)), radius, 0.42, PSYCHIC_PALETTE.magenta);
      this.vfx.spawnShockwave(center.clone().setY(Math.max(0.14, center.y - 0.8)), radius * 0.6, 0.3, PSYCHIC_PALETTE.lavender);
      this.vfx.spawnHitSparks(center, new THREE.Vector3(0, 1, 0), 1.6, PSYCHIC_PALETTE.magenta);
    }

    this.manager.damageTurretsInSphere(center, radius, this.ownerId, 1);

    for (const f of this.manager.fighters) {
      if (!this.manager.isHostile(this.ownerId, f)) continue;
      const dx = f.position.x - center.x;
      const dy = (f.position.y + 0.9) - center.y;
      const dz = f.position.z - center.z;
      const maxR = radius + f.config.radius;
      if (dx * dx + dy * dy + dz * dz <= maxR * maxR) {
        const pushDir = new THREE.Vector3(dx, 0.35, dz);
        if (pushDir.lengthSq() < 1e-4) pushDir.set(0, 1, 0);
        else pushDir.normalize();
        f.takeDamage(18, pushDir, 7.2, this.ownerId);
      }
    }
  }
}
