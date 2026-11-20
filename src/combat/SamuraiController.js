import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import {
  SAMURAI_PALETTE,
  createSlashArcGroup,
  createChainedKunaiGroup,
  createDynamicChainMesh,
  updateChainMesh,
  createChainWrapGroup,
  createBladeWaveGroup,
} from '../utils/SamuraiGeometry.js';

/**
 * SamuraiController
 * ----------------------------------------------------------------------
 * Implementa el kit del 10.º Personaje Jugable (El Samurái — sin elemento):
 *  - Pasiva (`Paso Ligero`): +12% velocidad base de movimiento (en BaseFighter).
 *  1. Click Izq (`katana`) — Combo de Katana de 3 golpes (`0.36s` CD, reinicio 1.2s):
 *     - Golpe 1: Tajo Horizontal (`11` daño, `3.6 u`, cono `115°`)
 *     - Golpe 2: Corte Ascendente (`12` daño, `3.7 u`, impulso frontal)
 *     - Golpe 3: Tajo Giratorio 360° (`16` daño, `4.2 u`, destruye proyectiles básicos)
 *  2. Click Der (`kunai`)  — Cadena Kunai (`8.0s` CD, alcance `18 u`):
 *     - Clava kunai + cadena dinámica, inflige `10` daño, atrae a `2.2 u` frente al
 *       Samurái y aplica ralentización de movimiento (`-40%`) y de ataque (`-40%`) `2.2s`.
 *  3. Tecla Q (`falcon`)   — Salto del Halcón (`8.0s` CD, alcance `15 u`):
 *     - Salto acrobático parabólico + tajo descendente en área (`3.6 u`, `14` daño + knockup).
 *  4. Tecla E (`shogun`)   — Armadura del Shōgun (`13.0s` CD, dura `6.0s`):
 *     - Equipa armadura 3D (`-45%` daño recibido, inmunidad a knockback y aturdimiento,
 *       `+30%` alcance katana, `+4` daño por golpe y onda cortante en el 3.º golpe).
 */

const ABILITIES = [
  { id: 'katana', slot: 'primary', name: 'Combo Katana', key: 'Click Izq', cooldown: 0.36 },
  { id: 'kunai', slot: 'secondary', name: 'Cadena Kunai', key: 'Click Der', cooldown: 8.0 },
  { id: 'falcon', slot: 'skill1', name: 'Salto del Halcón', key: 'Q', cooldown: 8.0 },
  { id: 'shogun', slot: 'skill2', name: 'Armadura Shōgun', key: 'E', cooldown: 13.0 },
];

const KUNAI_MAX_RANGE = 18.0;
const FALCON_MAX_RANGE = 15.0;
const SHOGUN_DURATION = 6.0;
const CONE_COS_HALF = Math.cos((57.5 * Math.PI) / 180); // arco frontal 115°

export class SamuraiController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'samurai';
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
      katana: 0,
      kunai: 0,
      falcon: 0,
      shogun: 0,
    };

    this.comboStep = 0;
    this._comboResetTimer = 0;
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

  _getEffectiveCd(abId) {
    const ab = ABILITIES.find((a) => a.id === abId);
    if (!ab) return 1;
    const mods = this.fighter.survivalMods;
    if (abId === 'katana') {
      const atkSpd = mods?.auraAttackSpeedMult || 1;
      return (ab.cooldown + (this.cooldownBonus || 0) * 0.2) / atkSpd;
    }
    if (abId === 'kunai') {
      return (ab.cooldown + (this.cooldownBonus || 0)) * (mods?.samuraiChainCdMult || 1);
    }
    if (abId === 'shogun') {
      return Math.max(4.0, ab.cooldown + (this.cooldownBonus || 0) - (mods?.samuraiShogunBonus || 0));
    }
    return ab.cooldown + (this.cooldownBonus || 0);
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      const total = this._getEffectiveCd(ab.id);
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

  /** Helper para obtener yaw/dirección horizontal hacia `aimPoint` */
  _getFlatForward(customAimPoint = null) {
    const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
    const origin = this.fighter.position.clone().setY(this.fighter.position.y + 1.1);
    const dir = aimPoint.clone().sub(origin);
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) {
      const yaw = this.aimProvider.getAimYaw();
      dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    } else {
      dir.normalize();
    }
    return { aimPoint, dir, yaw: Math.atan2(dir.x, dir.z) };
  }

  /** Clampa una posición XZ dentro de los límites de la arena y fuera de pilares */
  _clampSafeGroundPos(x, z, radius = 0.45) {
    const maxR = (this.arena?.getBoundsRadius ? this.arena.getBoundsRadius() : 28) - radius - 0.6;
    const d = Math.hypot(x, z);
    if (d > maxR && d > 1e-4) {
      x = (x / d) * maxR;
      z = (z / d) * maxR;
    }
    if (this.arena && this.arena.pillars) {
      for (const p of this.arena.pillars) {
        const dx = x - p.x;
        const dz = z - p.z;
        const pd = Math.hypot(dx, dz);
        const minD = p.radius + radius + 0.15;
        if (pd < minD && pd > 1e-4) {
          x = p.x + (dx / pd) * minD;
          z = p.z + (dz / pd) * minD;
        }
      }
    }
    const gy = this.arena?.getGroundHeightAt ? this.arena.getGroundHeightAt(x, z, 99) : 0;
    return new THREE.Vector3(x, gy > -10 ? gy + 0.04 : 0.04, z);
  }

  // ============================================================
  //  1. Click Izq - Combo de Katana (3 pasos)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (!this.isReady('primary')) return false;
    this.cooldowns.katana = this._getEffectiveCd('katana');
    const step = this.comboStep;
    this.comboStep = (this.comboStep + 1) % 3;
    this._comboResetTimer = 1.2;

    const { aimPoint, dir, yaw } = this._getFlatForward(customAimPoint);
    this.fighter.yaw = yaw;

    const mods = this.fighter.survivalMods;
    const isShogun = this.fighter.isShogunArmor;
    const reachScale = (isShogun ? 1.3 : 1.0) * (mods?.areaMult || 1);
    const meleeBonus = isShogun ? 4 : 0;
    const meleeMult = mods?.auraMeleeMult || 1;
    const isSpin = step === 2;

    const baseReach = step === 0 ? 3.6 : step === 1 ? 3.7 : 4.2;
    const baseDmg = step === 0 ? 11 : step === 1 ? 12 : 16;
    const reach = baseReach * reachScale;
    const damage = (baseDmg + meleeBonus) * meleeMult;
    const knockback = step === 0 ? 5.2 : step === 1 ? 6.0 : 10.5;

    const anim = step === 0 ? 'katana_slash1' : step === 1 ? 'katana_slash2' : 'katana_spin';
    this.fighter.mesh.playAction(anim, step === 2 ? 0.42 : 0.3);
    if (this.sound && this.sound.playKatanaSlash) this.sound.playKatanaSlash(step);

    // Golpe 2 aplica ligero impulso frontal
    if (step === 1 && !this.fighter.isRooted && !this.fighter.isEarthTrapped) {
      this.fighter.velocity.x += dir.x * 4.5;
      this.fighter.velocity.z += dir.z * 4.5;
    }

    // Estela de corte 3D (EnergyVFX, sin contorno negro)
    this._spawnSlashVFX(dir, yaw, reach, step, isShogun);

    // Impactos cuerpo a cuerpo (autoritativo)
    let monsterHits = 0;
    if (this.manager.isAuthoritative !== false) {
      const myPos = this.fighter.position;
      for (const target of this.manager.fighters) {
        if (!target || target === this.fighter || !target.isAlive) continue;
        if (!this.manager.isHostile(this.ownerId, target)) continue;
        const dx = target.position.x - myPos.x;
        const dz = target.position.z - myPos.z;
        const dy = Math.abs((target.position.y || 0) - myPos.y);
        const horizDist = Math.hypot(dx, dz);
        const maxDist = reach + (target.config?.radius || 0.45);
        if (horizDist > maxDist || dy > 2.6) continue;

        if (!isSpin && horizDist > 0.2) {
          const dot = (dx * dir.x + dz * dir.z) / horizDist;
          if (dot < CONE_COS_HALF) continue;
        }

        const pushDir =
          horizDist > 0.05
            ? new THREE.Vector3(dx / horizDist, isSpin ? 0.34 : 0.16, dz / horizDist).normalize()
            : dir.clone().setY(0.2).normalize();
        target.takeDamage(damage, pushDir, knockback, this.ownerId);
        if (target.isMonster) monsterHits += 1;

        if (this.vfx) {
          this.vfx.spawnHitSparks(
            target.position.clone().setY(target.position.y + 1.05),
            pushDir,
            isSpin ? 1.4 : 1.0,
            isShogun ? SAMURAI_PALETTE.gold : SAMURAI_PALETTE.brightCrimson
          );
        }
      }

      // Sed de Acero / Espíritu Bushidō: curación por golpe sobre monstruos
      if (monsterHits > 0 && mods?.auraSamuraiHealPerHit > 0 && this.fighter.isAlive) {
        this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + monsterHits * mods.auraSamuraiHealPerHit);
      }

      // Golpe 3 (Tajo Giratorio 360°): destruye proyectiles básicos enemigos en radio
      if (isSpin && this.manager.projectiles) {
        const center = myPos.clone().setY(myPos.y + 1.0);
        for (const p of this.manager.projectiles) {
          if (!p || !p.alive || p.isTornadoHazard || p.isChainedKunai) continue;
          if (this.manager.isSameTeamIds(this.ownerId, p.ownerId)) continue;
          if (p.position.distanceTo(center) <= reach + (p.radius || 0.35)) {
            p.alive = false;
            if (p.onExpire) p.onExpire(p);
            if (this.vfx) {
              this.vfx.spawnHitSparks(p.position, new THREE.Vector3(0, 1, 0), 1.0, SAMURAI_PALETTE.brightSteel);
            }
          }
        }
      }
    }

    // Onda cortante a distancia (en 3.º golpe con Armadura del Shōgun, o en cada corte con Espíritu Bushidō)
    if ((isSpin && isShogun) || mods?.auraBushido) {
      this._fireBladeWave(dir, yaw, aimPoint, isShogun);
    }

    return true;
  }

  _spawnSlashVFX(dir, yaw, radius, step, isShogun) {
    const arcAngle = step === 2 ? Math.PI * 1.92 : Math.PI * 0.72;
    const slash = createSlashArcGroup(radius * 0.92, arcAngle, !isShogun || step === 2, step === 2);
    const group = slash.group;
    group.position.copy(this.fighter.position).addScaledVector(dir, step === 2 ? 0.0 : 0.45);
    group.position.y += 1.08;
    group.rotation.y = yaw;
    if (step === 0) group.rotation.z = 0.14;
    else if (step === 1) group.rotation.z = -0.68;

    this.scene.add(group);
    const cleanup = () => {
      if (group.parent) group.parent.remove(group);
      slash.dispose();
    };
    this._cleanups.add(cleanup);

    let age = 0;
    const life = step === 2 ? 0.3 : 0.22;
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / life);
      if (step === 2) group.rotation.y += dt * 16;
      else group.rotation.y = yaw + (step === 0 ? -0.5 + t * 1.1 : 0.35 - t * 0.8);
      slash.mat.opacity = 0.92 * (1 - t);
      group.scale.setScalar(0.88 + t * 0.22);
      if (age >= life) {
        this._cleanups.delete(cleanup);
        cleanup();
        return false;
      }
      return true;
    });
  }

  _fireBladeWave(dir, yaw, aimPoint, isShogun) {
    const mods = this.fighter.survivalMods;
    const voidEdge = !!mods?.auraVoidEdge;
    const width = voidEdge ? 4.8 : 2.5;
    const dmg = voidEdge ? 24 : 12;
    const visual = createBladeWaveGroup(width, !isShogun);

    const start = this.fighter.position.clone().setY(this.fighter.position.y + 1.05).addScaledVector(dir, 0.9);
    const waveDir = aimPoint ? aimPoint.clone().sub(start) : dir.clone();
    waveDir.y = THREE.MathUtils.clamp(waveDir.y, -0.25, 0.25);
    if (waveDir.lengthSq() < 1e-4) waveDir.copy(dir);
    waveDir.normalize();

    visual.group.position.copy(start);
    visual.group.rotation.y = Math.atan2(waveDir.x, waveDir.z);
    this.scene.add(visual.group);

    const speed = 26;
    const handleWaveHit = (hit) => {
      if (!hit || hit.type !== 'fighter' || !hit.fighter) return;
      const target = hit.fighter;
      if (this.vfx) {
        this.vfx.spawnHitSparks(
          target.position.clone().setY(target.position.y + 1.0),
          waveDir,
          1.15,
          SAMURAI_PALETTE.gold
        );
      }
      if (mods?.auraSamuraiHealPerHit > 0 && target.isMonster && this.fighter.isAlive) {
        this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + mods.auraSamuraiHealPerHit);
      }
    };

    const proj = new Projectile({
      mesh: visual.group,
      velocity: waveDir.clone().multiplyScalar(speed),
      radius: width * 0.42,
      gravity: 0,
      life: 11.0 / speed,
      damage: dmg,
      knockback: 7.5,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'samurai_blade_wave',
      piercing: true,
      onPierceHit: handleWaveHit,
      onImpact: (hit) => {
        handleWaveHit(hit);
        visual.dispose();
      },
      onExpire: () => visual.dispose(),
    });
    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  2. Click Der - Cadena Kunai (atracción + ralentización)
  // ============================================================
  trySecondary(customAimPoint = null) {
    if (!this.isReady('secondary')) return false;
    this.cooldowns.kunai = this._getEffectiveCd('kunai');

    const { aimPoint, dir, yaw } = this._getFlatForward(customAimPoint);
    this.fighter.yaw = yaw;
    this.fighter.mesh.playAction('heavy_throw', 0.36);
    if (this.sound && this.sound.playChainThrow) this.sound.playChainThrow();

    const start = this.fighter.position.clone().setY(this.fighter.position.y + 1.12).addScaledVector(dir, 0.65);
    const shotDir = aimPoint.clone().sub(start);
    if (shotDir.lengthSq() < 1e-4) shotDir.copy(dir);
    shotDir.normalize();

    const isRival = this.fighter.themeName?.includes('rival');
    const kunaiVisual = createChainedKunaiGroup(isRival);
    kunaiVisual.group.position.copy(start);
    kunaiVisual.group.lookAt(start.clone().add(shotDir));
    this.scene.add(kunaiVisual.group);

    const chainData = createDynamicChainMesh(18);
    this.scene.add(chainData.group);
    let chainCleared = false;
    const clearChain = () => {
      if (chainCleared) return;
      chainCleared = true;
      if (chainData.group.parent) chainData.group.parent.remove(chainData.group);
      chainData.dispose();
    };
    this._cleanups.add(clearChain);

    const handOrigin = () => this.fighter.position.clone().setY(this.fighter.position.y + 1.08);
    let hitDone = false;
    let age = 0;
    const speed = 38;

    const proj = new Projectile({
      mesh: kunaiVisual.group,
      velocity: shotDir.clone().multiplyScalar(speed),
      radius: 0.42,
      gravity: 0,
      life: KUNAI_MAX_RANGE / speed,
      damage: this.manager.isAuthoritative === false ? 0 : 10,
      knockback: 0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'samurai_kunai',
      onUpdate: (pdt, p) => {
        age += pdt;
        updateChainMesh(chainData, handOrigin(), p.position, age, 0.06);
      },
      onImpact: (hit, p) => {
        kunaiVisual.dispose();
        if (hit && hit.type === 'fighter' && hit.fighter && !hitDone) {
          hitDone = true;
          if (this.sound && this.sound.playChainHitPull) this.sound.playChainHitPull();
          if (this.manager.isAuthoritative !== false) {
            this._pullTargetWithChain(hit.fighter, chainData, clearChain, dir);
          } else {
            this._retractChainVisual((hit.point || p.position).clone(), chainData, clearChain);
          }
          return;
        }
        if (!hitDone) {
          hitDone = true;
          this._retractChainVisual((hit?.point || p.position).clone(), chainData, clearChain);
        }
      },
      onExpire: (p) => {
        kunaiVisual.dispose();
        if (!hitDone) {
          hitDone = true;
          this._retractChainVisual(p.position.clone(), chainData, clearChain);
        }
      },
    });
    proj.isChainedKunai = true;
    this.manager.addProjectile(proj);
    return true;
  }

  _retractChainVisual(fromPos, chainData, clearChain) {
    let age = 0;
    const dur = 0.2;
    const cur = new THREE.Vector3();
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / dur);
      const hand = this.fighter.position.clone().setY(this.fighter.position.y + 1.08);
      cur.lerpVectors(fromPos, hand, t);
      updateChainMesh(chainData, hand, cur, age, 0.12 * (1 - t));
      if (age >= dur) {
        this._cleanups.delete(clearChain);
        clearChain();
        return false;
      }
      return true;
    });
  }

  _pullTargetWithChain(primaryTarget, chainData, clearChain, castDir) {
    const mods = this.fighter.survivalMods;
    const targets = [primaryTarget];

    // Cadena Segadora (Supervivencia): atrae hasta 3 monstruos cercanos
    if (mods?.samuraiChainReaper && primaryTarget) {
      for (const f of this.manager.fighters) {
        if (targets.length >= 3) break;
        if (!f || f === primaryTarget || f === this.fighter || !f.isAlive || !f.isMonster) continue;
        if (!this.manager.isHostile(this.ownerId, f)) continue;
        if (f.position.distanceTo(primaryTarget.position) <= 4.5) {
          targets.push(f);
        }
      }
    }

    const samPos = this.fighter.position;
    const wraps = [];
    const entries = targets.map((tgt, idx) => {
      // Aplica ralentización de movimiento (-40%) y de ataques (-40%) por 2.2s
      if (tgt.applySlow) tgt.applySlow(2.2, 0.4, this.ownerId);
      if (tgt.applyAttackSlow) tgt.applyAttackSlow(2.2, 0.4, this.ownerId);
      tgt._hitstunTimer = Math.max(tgt._hitstunTimer || 0, 0.4);
      tgt.isDashing = false;
      tgt._dashTime = 0;

      const wrap = createChainWrapGroup(tgt.isMonster && tgt.monsterType === 'colossus' ? 1.65 : 1.0);
      wrap.group.position.copy(tgt.position);
      this.scene.add(wrap.group);
      wraps.push(wrap);

      // Destino seguro a 2.2u frente al Samurái (espaciando si hay múltiples monstruos)
      const sideOff = idx === 0 ? 0 : (idx === 1 ? -1.1 : 1.1);
      const destX = samPos.x + castDir.x * 2.2 - castDir.z * sideOff;
      const destZ = samPos.z + castDir.z * 2.2 + castDir.x * sideOff;
      const dest = this._clampSafeGroundPos(destX, destZ, tgt.config?.radius || 0.45);
      return {
        tgt,
        startPos: tgt.position.clone(),
        destPos: dest,
        wrap,
      };
    });

    const cleanupAll = () => {
      this._cleanups.delete(clearChain);
      clearChain();
      for (const w of wraps) {
        if (w.group.parent) w.group.parent.remove(w.group);
        w.dispose();
      }
    };
    this._cleanups.add(cleanupAll);

    let age = 0;
    const pullDur = 0.26;
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / pullDur);
      const ease = 1 - Math.pow(1 - t, 2.2);

      for (const e of entries) {
        if (!e.tgt.isAlive) continue;
        // Respetar Armadura del Shōgun enemiga (inmune a desplazamiento)
        if (!e.tgt.isShogunArmor) {
          const nx = THREE.MathUtils.lerp(e.startPos.x, e.destPos.x, ease);
          const nz = THREE.MathUtils.lerp(e.startPos.z, e.destPos.z, ease);
          const gy = this.arena?.getGroundHeightAt ? this.arena.getGroundHeightAt(nx, nz, e.startPos.y + 2) : 0;
          const baseGround = gy > -10 ? gy + 0.04 : 0.04;
          const arcY = Math.sin(t * Math.PI) * 0.45;
          e.tgt.position.set(nx, Math.max(baseGround, THREE.MathUtils.lerp(e.startPos.y, e.destPos.y, ease) + arcY), nz);
          e.tgt.velocity.set(0, 0, 0);
        }
        e.wrap.group.position.copy(e.tgt.position);
        e.wrap.group.rotation.y += dt * 9;
      }

      const hand = this.fighter.position.clone().setY(this.fighter.position.y + 1.08);
      const tip = primaryTarget.position.clone().setY(primaryTarget.position.y + 1.05);
      updateChainMesh(chainData, hand, tip, age, 0.03);

      if (age >= pullDur) {
        // Notifica en Online si el Host atrajo a un jugador remoto
        if (this.manager.isAuthoritative && this.manager.onAuthoritativeCombatEvent) {
          for (const e of entries) {
            if (!e.tgt.isMonster && !e.tgt.isShogunArmor) {
              this.manager.onAuthoritativeCombatEvent({
                targetId: e.tgt.id,
                attackerId: this.ownerId,
                damage: 0,
                knockback: null,
                isCrit: false,
                status: 'samurai_pull',
                targetPos: [
                  Number(e.tgt.position.x.toFixed(3)),
                  Number(e.tgt.position.y.toFixed(3)),
                  Number(e.tgt.position.z.toFixed(3)),
                ],
                hp: e.tgt.hp,
                maxHp: e.tgt.maxHp,
                isAlive: e.tgt.isAlive,
              });
            }
          }
        }
        this._cleanups.delete(cleanupAll);
        cleanupAll();
        return false;
      }
      return true;
    });
  }

  // ============================================================
  //  3. Tecla Q - Salto del Halcón (parabólico + área + knockup)
  // ============================================================
  trySkill1(customAimPoint = null) {
    if (!this.isReady('skill1')) return false;
    this.cooldowns.falcon = this._getEffectiveCd('falcon');

    const { aimPoint, dir, yaw } = this._getFlatForward(customAimPoint);
    this.fighter.yaw = yaw;
    this.fighter.mesh.playAction('falcon_leap', 0.48);
    if (this.sound && this.sound.playFalconLeap) this.sound.playFalconLeap();

    const startPos = this.fighter.position.clone();
    const toAim = aimPoint.clone().sub(startPos);
    const horizDist = Math.hypot(toAim.x, toAim.z);
    const travelDist = Math.min(FALCON_MAX_RANGE, Math.max(3.5, horizDist));
    const endRawX = startPos.x + dir.x * travelDist;
    const endRawZ = startPos.z + dir.z * travelDist;
    const endPos = this._clampSafeGroundPos(endRawX, endRawZ, this.fighter.config?.radius || 0.42);
    const peakY = Math.max(startPos.y, endPos.y) + 3.2;

    if (this.vfx) {
      this.vfx.spawnDust(startPos, { count: 8, size: 0.7, speed: 2.6, spread: 0.3, life: 0.45, ring: true });
    }

    let age = 0;
    const dur = 0.46;
    const mods = this.fighter.survivalMods;
    const areaRadius = 3.6 * (mods?.areaMult || 1);

    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) return false;
      age += dt;
      const t = Math.min(1, age / dur);

      const nx = THREE.MathUtils.lerp(startPos.x, endPos.x, t);
      const nz = THREE.MathUtils.lerp(startPos.z, endPos.z, t);
      const baseY = THREE.MathUtils.lerp(startPos.y, endPos.y, t);
      const arc = 4 * t * (1 - t) * (peakY - (startPos.y + endPos.y) * 0.5);
      this.fighter.position.set(nx, baseY + arc, nz);
      this.fighter.velocity.set(0, 0, 0);
      this.fighter.onGround = t >= 1;

      if (age >= dur) {
        this._executeFalconSlam(endPos, areaRadius);
        return false;
      }
      return true;
    });

    return true;
  }

  _executeFalconSlam(center, radius) {
    if (this.vfx) {
      this.vfx.spawnShockwave(center, radius * 1.15, 0.36, SAMURAI_PALETTE.brightCrimson);
      this.vfx.spawnShockwave(center, radius * 0.75, 0.26, SAMURAI_PALETTE.gold);
      this.vfx.spawnDust(center, { count: 12, size: 0.85, speed: 3.4, spread: 0.35, life: 0.55, ring: true });
      this.vfx.addTrauma(0.24);
    }

    const slash = createSlashArcGroup(radius * 0.85, Math.PI * 1.85, true, true);
    slash.group.position.copy(center).setY(center.y + 0.35);
    this.scene.add(slash.group);
    const clean = () => {
      if (slash.group.parent) slash.group.parent.remove(slash.group);
      slash.dispose();
    };
    this._cleanups.add(clean);
    let sAge = 0;
    this._tasks.push((dt) => {
      sAge += dt;
      const p = Math.min(1, sAge / 0.25);
      slash.mat.opacity = 0.9 * (1 - p);
      slash.group.scale.setScalar(0.85 + p * 0.35);
      if (sAge >= 0.25) {
        this._cleanups.delete(clean);
        clean();
        return false;
      }
      return true;
    });

    if (this.manager.isAuthoritative === false) return;
    const mods = this.fighter.survivalMods;
    const dmg = 14 * (mods?.auraMeleeMult || 1);
    let monsterHits = 0;
    for (const target of this.manager.fighters) {
      if (!target || target === this.fighter || !target.isAlive) continue;
      if (!this.manager.isHostile(this.ownerId, target)) continue;
      const dx = target.position.x - center.x;
      const dz = target.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius + (target.config?.radius || 0.45) && Math.abs(target.position.y - center.y) <= 2.8) {
        const pushDir =
          dist > 0.1
            ? new THREE.Vector3((dx / dist) * 0.35, 0.94, (dz / dist) * 0.35).normalize()
            : new THREE.Vector3(0, 1, 0);
        target.takeDamage(dmg, pushDir, 11.5, this.ownerId);
        target._hitstunTimer = Math.max(target._hitstunTimer || 0, 0.45);
        if (target.isMonster) monsterHits += 1;
      }
    }
    if (monsterHits > 0 && mods?.auraSamuraiHealPerHit > 0 && this.fighter.isAlive) {
      this.fighter.hp = Math.min(this.fighter.maxHp, this.fighter.hp + monsterHits * mods.auraSamuraiHealPerHit);
    }
  }

  // ============================================================
  //  4. Tecla E - Armadura del Shōgun (6.0s)
  // ============================================================
  trySkill2() {
    if (!this.isReady('skill2')) return false;
    this.cooldowns.shogun = this._getEffectiveCd('shogun');

    const mods = this.fighter.survivalMods;
    const dur = SHOGUN_DURATION + (mods?.samuraiShogunBonus || 0);
    if (this.fighter.setShogunArmor) {
      this.fighter.setShogunArmor(dur);
    }
    this.fighter.mesh.playAction('guard_wall', 0.38);
    this.fighter.mesh.flash(SAMURAI_PALETTE.gold);
    if (this.sound && this.sound.playShogunArmor) this.sound.playShogunArmor();
    if (this.vfx) {
      this.vfx.spawnShockwave(this.fighter.position, 3.2, 0.38, SAMURAI_PALETTE.gold);
      this.vfx.spawnHitSparks(this.fighter.position.clone().setY(this.fighter.position.y + 1.1), new THREE.Vector3(0, 1, 0), 1.4, SAMURAI_PALETTE.brightCrimson);
    }
    return true;
  }

  /** Replica lanzamientos en clientes remotos P2P */
  castAbilityFromNetwork(slot, aimPoint = null) {
    this.clearCooldowns();
    if (slot === 'primary') return this.tryPrimary(aimPoint);
    if (slot === 'secondary') return this.trySecondary(aimPoint);
    if (slot === 'skill1') return this.trySkill1(aimPoint);
    if (slot === 'skill2') return this.trySkill2();
    return false;
  }

  clearCooldowns() {
    this.cooldowns.katana = 0;
    this.cooldowns.kunai = 0;
    this.cooldowns.falcon = 0;
    this.cooldowns.shogun = 0;
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    if (this._comboResetTimer > 0) {
      this._comboResetTimer -= dt;
      if (this._comboResetTimer <= 0) this.comboStep = 0;
    }
    for (let i = this._tasks.length - 1; i >= 0; i--) {
      const alive = this._tasks[i](dt);
      if (alive === false) this._tasks.splice(i, 1);
    }
  }

  reset() {
    this.clearCooldowns();
    this.comboStep = 0;
    this._comboResetTimer = 0;
    this._tasks.length = 0;
    for (const c of this._cleanups) {
      try {
        c();
      } catch (_) {}
    }
    this._cleanups.clear();
  }

  dispose() {
    this.reset();
  }
}
