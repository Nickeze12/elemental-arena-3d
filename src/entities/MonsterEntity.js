import * as THREE from 'three';
import { BaseFighter, FIGHTER_CONFIG, lerpAngle } from './BaseFighter.js';
import { MonsterMesh } from './MonsterMesh.js';
import { Projectile } from '../combat/Projectile.js';
import { createEnergyVFXMaterial } from '../utils/ToonMaterial.js';
import { createRuggedBoulder } from '../utils/RockGeometry.js';
import { createLayeredFlame } from '../utils/FlameGeometry.js';
import { createWaterCometOrb } from '../utils/WaterGeometry.js';
import { createHorizontalVortexMesh } from '../utils/AirGeometry.js';
import { createPsychicOrbGroup } from '../utils/PsychicGeometry.js';
import { createStormBoltGroup } from '../utils/StormGeometry.js';
import { createPhotonBeamGroup } from '../utils/LightGeometry.js';
import { createShadowLanceGroup } from '../utils/ShadowGeometry.js';

const ARCHETYPES = {
  spirit: {
    label: 'Espíritu Elemental',
    maxHp: 50,
    knockbackMultiplier: 1.1,
    runSpeed: 8.4,
    radius: 0.45,
    scoreValue: 100,
  },
  golem: {
    label: 'Gólem de Granito',
    maxHp: 130,
    knockbackMultiplier: 0.45,
    runSpeed: 4.6,
    radius: 0.72,
    scoreValue: 250,
  },
  colossus: {
    label: 'Coloso Elemental',
    maxHp: 250,
    knockbackMultiplier: 0.3,
    runSpeed: 5.4,
    radius: 0.95,
    scoreValue: 650,
  },
};

const DIFFICULTY_SCALING = {
  apprentice: { cdMult: 1.38, lead: 0.1, speedMult: 0.88 },
  master: { cdMult: 1.0, lead: 0.45, speedMult: 1.0 },
  grandmaster: { cdMult: 0.68, lead: 0.85, speedMult: 1.14 },
};

const _toTarget = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _strafe = new THREE.Vector3();

/**
 * MonsterEntity
 * ------------------------------------------------------------
 * Monstruo elemental PvE para el Modo Supervivencia por Oleadas.
 * Extiende `BaseFighter` con `team = 'monsters'` y `isMonster = true` para
 * recibir daño, empujes, congelamiento, quemaduras y Ring-Out nativamente.
 */
export class MonsterEntity extends BaseFighter {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {'spirit'|'golem'|'colossus'} [o.monsterType='spirit']
   * @param {'fire'|'water'|'earth'|'air'} [o.element='fire']
   * @param {THREE.Scene} o.scene
   * @param {object} o.arena
   * @param {import('../combat/CombatManager.js').CombatManager} o.combat
   */
  constructor({ id, monsterType = 'spirit', element = 'fire', scene, arena, combat }) {
    const spec = ARCHETYPES[monsterType] || ARCHETYPES.spirit;
    const customMesh = new MonsterMesh({ type: monsterType, element });

    super({
      id,
      team: 'monsters',
      theme: element,
      scene,
      arena,
      customMesh,
      isMonster: true,
      knockbackMultiplier: spec.knockbackMultiplier,
    });

    this.monsterType = monsterType;
    this.element = element;
    this.displayName = spec.label;
    this.scoreValue = spec.scoreValue;
    this.combat = combat;
    this.vfx = combat ? combat.vfx : null;
    this.sound = combat ? combat.sound : null;
    this.combatEnabled = true;

    this.maxHp = spec.maxHp;
    this.hp = spec.maxHp;
    this.config = {
      ...FIGHTER_CONFIG,
      radius: spec.radius,
      runSpeed: spec.runSpeed,
      dashSpeed: 18,
      dashDuration: 0.16,
      dashCooldown: 2.2,
    };

    this.difficulty = 'master';
    this._diffSpec = DIFFICULTY_SCALING.master;
    this._strafeSign = Math.random() > 0.5 ? 1 : -1;
    this._zigTimer = 0.8 + Math.random() * 0.8;
    this._attackTimer = 0.6 + Math.random() * 0.8;
    this._burstLeft = 0;
    this._colossusStep = 0;

    // Estado de telegrafía de golpe radial (Gólem / Coloso)
    this._telegraph = null;
    // Estado de embestida pesada (Coloso)
    this._charge = null;

    // Modo visual sincronizado por red (para clientes Guest en Supervivencia Coop)
    this.isRemoteVisual = false;
    this._netPos = new THREE.Vector3();
    this._netYaw = 0;
    this._netAnimState = 'idle';
    this._netSpeed = 0;
    this._hasSnapshot = false;
    this._lastNetAction = '';
    this._netActionNonce = 0;
    this._lastSentActionRef = null;

    this.setDifficulty('master');
  }

  /** Serializa el estado del monstruo para el WORLD_SNAPSHOT del Host */
  serializeNetworkState() {
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let action = '';
    let actionDur = 0.45;
    if (this.mesh && this.mesh.action) {
      if (this.mesh.action !== this._lastSentActionRef) {
        this._lastSentActionRef = this.mesh.action;
        this._netActionNonce += 1;
      }
      action = `${this.mesh.action.name}:${this._netActionNonce}`;
      actionDur = this.mesh.action.duration || 0.45;
    } else {
      this._lastSentActionRef = null;
    }
    return {
      id: this.id,
      type: this.monsterType,
      element: this.element,
      pos: [Number(this.position.x.toFixed(3)), Number(this.position.y.toFixed(3)), Number(this.position.z.toFixed(3))],
      yaw: Number((this.yaw || 0).toFixed(4)),
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      isAlive: !!this.isAlive,
      isFrozen: !!this.isFrozen,
      isBurning: !!this.isBurning,
      isRooted: !!this.isRooted,
      isPoisoned: !!this.isPoisoned,
      isConfused: !!this.isConfused,
      isStunned: !!this.isStunned,
      earthOrbitCount: this.earthOrbitCount,
      isEarthTrapped: !!this.isEarthTrapped,
      animState: horizSpeed > 0.6 ? 'run' : 'idle',
      speed: Number(horizSpeed.toFixed(2)),
      action,
      actionDur,
    };
  }

  /** Limpia la malla del monstruo de la escena (usado en cleanup de Guests) */
  dispose() {
    if (this.mesh && this.mesh.root && this.mesh.root.parent) {
      this.mesh.root.parent.remove(this.mesh.root);
    }
  }

  /** Aplica snapshot de red en un cliente Guest (sin ejecutar IA local) */
  applyNetworkState(s) {
    if (!s) return;
    if (Array.isArray(s.pos) && s.pos.length === 3) {
      this._netPos.set(s.pos[0], s.pos[1], s.pos[2]);
      if (!this._hasSnapshot || this.position.distanceToSquared(this._netPos) > 64) {
        this.position.copy(this._netPos);
      }
      this._hasSnapshot = true;
    }
    if (typeof s.yaw === 'number') {
      this._netYaw = s.yaw;
      if (!this._hasSnapshot) {
        this.yaw = s.yaw;
        this.mesh.root.rotation.y = s.yaw;
      }
    }
    if (typeof s.hp === 'number') this.hp = s.hp;
    if (typeof s.maxHp === 'number') this.maxHp = s.maxHp;
    if (typeof s.isAlive === 'boolean') {
      this.isAlive = s.isAlive;
      this.mesh.root.visible = this.isAlive;
    }
    if (typeof s.isFrozen === 'boolean') {
      this.freezeTimer = s.isFrozen ? 1 : 0;
      this.mesh.setFrozen(s.isFrozen);
    }
    if (typeof s.isBurning === 'boolean') {
      this.burnTimer = s.isBurning ? 1 : 0;
      this.mesh.setBurning(s.isBurning);
    }
    if (typeof s.isRooted === 'boolean') {
      this.rootTimer = s.isRooted ? 1 : 0;
      if (this.mesh.setRooted) this.mesh.setRooted(s.isRooted);
    }
    if (typeof s.isPoisoned === 'boolean') {
      this.poisonTimer = s.isPoisoned ? 1 : 0;
      if (this.mesh.setPoisoned) this.mesh.setPoisoned(s.isPoisoned);
    }
    if (typeof s.isConfused === 'boolean') {
      this.confusedTimer = s.isConfused ? 1 : 0;
      if (this.mesh.setConfused) this.mesh.setConfused(s.isConfused);
    }
    if (typeof s.isStunned === 'boolean') {
      this.stunTimer = s.isStunned ? 1 : 0;
      if (this.mesh.setStunned) this.mesh.setStunned(s.isStunned);
    }
    if (typeof s.earthOrbitCount === 'number' && this.mesh.setEarthOrbitRocks) {
      this.mesh.setEarthOrbitRocks(s.earthOrbitCount);
    }
    if (typeof s.isEarthTrapped === 'boolean') {
      this.earthTrapTimer = s.isEarthTrapped ? 1 : 0;
      if (this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(s.isEarthTrapped);
    }
    if (s.animState) this._netAnimState = s.animState;
    if (typeof s.speed === 'number') this._netSpeed = s.speed;
    if (s.action && s.action !== this._lastNetAction) {
      this._lastNetAction = s.action;
      this.mesh.playAction(String(s.action).split(':')[0], s.actionDur || 0.45);
    } else if (!s.action) {
      this._lastNetAction = '';
    }
  }

  setDifficulty(level = 'master') {
    const d = DIFFICULTY_SCALING[level] || DIFFICULTY_SCALING.master;
    this.difficulty = level;
    this._diffSpec = d;
    const baseSpec = ARCHETYPES[this.monsterType] || ARCHETYPES.spirit;
    this.config.runSpeed = baseSpec.runSpeed * d.speedMult;
  }

  /** Selecciona objetivo vivo más cercano (priorizando Espejismos cercanos como distracción táctica) */
  _findTarget() {
    if (!this.combat || !this.combat.fighters) return null;
    let best = null;
    let bestScore = Infinity;
    for (const f of this.combat.fighters) {
      if (!f || !f.isAlive || (f.team || f.id) === 'monsters') continue;
      if (this.combat.isTargetHiddenFrom && this.combat.isTargetHiddenFrom(this, f)) continue;
      const dx = f.position.x - this.position.x;
      const dz = f.position.z - this.position.z;
      const d2 = dx * dx + dz * dz;
      const bias = f.isMirage && d2 <= 18 * 18 ? 0.14 : 1.0;
      const score = d2 * bias;
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  _clearTelegraph() {
    if (this.mesh && this.mesh.setTelegraphCharge) {
      this.mesh.setTelegraphCharge(0);
    }
    if (this._telegraph) {
      if (this._telegraph.group.parent) this.scene.remove(this._telegraph.group);
      this._telegraph.outerGeo.dispose();
      this._telegraph.chargeRingGeo.dispose();
      this._telegraph.fillGeo.dispose();
      this._telegraph.outerMat.dispose();
      this._telegraph.chargeRingMat.dispose();
      this._telegraph.fillMat.dispose();
      this._telegraph = null;
    }
  }

  _startRadialTelegraph({ radius, duration, damage, knockback }) {
    this._clearTelegraph();

    const group = new THREE.Group();
    const floorY = Math.max(0.06, this.position.y + 0.06);
    group.position.set(this.position.x, floorY, this.position.z);

    const warnCore = this.monsterType === 'colossus' ? '#ff4d6d' : '#ff9f43';
    const warnRim = this.monsterType === 'colossus' ? '#ffbe3b' : '#ff5a1f';

    const outerGeo = new THREE.RingGeometry(radius - 0.18, radius, 48);
    outerGeo.rotateX(-Math.PI / 2);
    const outerMat = createEnergyVFXMaterial({
      coreColor: '#ffffff',
      rimColor: warnCore,
      opacity: 0.92,
      additive: true,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.userData.noOutline = true;

    const chargeRingGeo = new THREE.RingGeometry(radius * 0.72, radius * 0.88, 48);
    chargeRingGeo.rotateX(-Math.PI / 2);
    const chargeRingMat = createEnergyVFXMaterial({
      coreColor: warnRim,
      rimColor: warnCore,
      opacity: 0.75,
      additive: true,
      depthWrite: false,
    });
    const chargeRingMesh = new THREE.Mesh(chargeRingGeo, chargeRingMat);
    chargeRingMesh.scale.setScalar(0.12);
    chargeRingMesh.userData.noOutline = true;

    const fillGeo = new THREE.CircleGeometry(radius, 48);
    fillGeo.rotateX(-Math.PI / 2);
    const fillMat = createEnergyVFXMaterial({
      coreColor: warnCore,
      rimColor: warnRim,
      opacity: 0.24,
      softEdge: true,
      additive: true,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.scale.setScalar(0.08);
    fillMesh.userData.noOutline = true;

    group.add(outerMesh, chargeRingMesh, fillMesh);
    this.scene.add(group);

    this.mesh.playAction('stomp_seismic', duration + 0.2);

    this._telegraph = {
      group,
      outerGeo,
      chargeRingGeo,
      fillGeo,
      outerMat,
      chargeRingMat,
      fillMat,
      chargeRingMesh,
      fillMesh,
      radius,
      duration,
      elapsed: 0,
      damage,
      knockback,
    };
  }

  _executeRadialSlam(tel) {
    const origin = this.position.clone();
    const radius = tel.radius;

    if (this.sound && this.sound.playColossusSlam) {
      this.sound.playColossusSlam();
    }
    if (this.vfx) {
      this.vfx.spawnGroundCrater(origin, radius * 0.6, 2.2);
      const shockColor = this.monsterType === 'colossus' ? '#ff3b4e' : '#ff9429';
      this.vfx.spawnShockwave(origin, radius * 1.18, 0.45, shockColor);
      if (this.monsterType === 'colossus') {
        this.vfx.spawnShockwave(origin, radius * 0.75, 0.34, '#ffe18c');
      }
      this.vfx.spawnDust(origin, { count: 16, size: 1.0, speed: 4.5, spread: 0.7, ring: true });
      this.vfx.addTrauma(this.monsterType === 'colossus' ? 0.52 : 0.32);
    }

    if (this.combat && this.combat.fighters) {
      for (const f of this.combat.fighters) {
        if (!this.combat.isHostile(this.id, f)) continue;
        const dx = f.position.x - origin.x;
        const dz = f.position.z - origin.z;
        const d = Math.hypot(dx, dz);
        const heightDelta = f.position.y - origin.y;
        // Onda expansiva de suelo: el jugador puede alejarse o saltar por encima del pulso
        if (d <= radius + f.config.radius && heightDelta < 1.35) {
          const pushDir = new THREE.Vector3(dx, 0, dz);
          if (pushDir.lengthSq() < 1e-4) pushDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          pushDir.normalize();
          pushDir.y = 0.35;
          pushDir.normalize();

          f.takeDamage(tel.damage, pushDir, tel.knockback, this.id);
          if (this.vfx) {
            this.vfx.spawnHitSparks(f.position.clone().setY(f.position.y + 0.9), pushDir, 1.35);
          }
        }
      }
    }
  }

  _spawnMonsterProjectile({ target, damage, knockback, speed = 22, angleOffset = 0, heavy = false }) {
    if (!this.combat) return;

    const origin = this.position.clone();
    origin.y += this.monsterType === 'colossus' ? 1.85 : this.monsterType === 'golem' ? 1.4 : 1.25;

    const aimTarget = target.position.clone();
    aimTarget.y += 1.0;
    const dist = origin.distanceTo(aimTarget);
    const leadTime = Math.min(0.45, dist / speed) * this._diffSpec.lead;
    aimTarget.addScaledVector(target.velocity, leadTime);

    const dir = aimTarget.sub(origin).normalize();
    if (angleOffset !== 0) {
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
    }

    let mesh;
    let disposeFn = () => {};
    let radius = 0.34;
    let gravity = 0;

    let updateFn = null;

    if (heavy || this.element === 'earth') {
      const boulder = createRuggedBoulder(heavy ? 0.56 : 0.38, Math.random() * 100);
      mesh = boulder.group;
      radius = heavy ? 0.54 : 0.38;
      gravity = heavy ? 7.5 : 4.2;
      disposeFn = () => boulder.dispose();
    } else if (this.element === 'fire') {
      const flame = createLayeredFlame(0.24, 0.72, Math.random() * 10, 0.14);
      flame.group.rotation.x = Math.PI * 0.5;
      mesh = flame.group;
      let age = 0;
      updateFn = (dt) => {
        age += dt;
        flame.update(age);
      };
      disposeFn = () => flame.dispose();
    } else if (this.element === 'water') {
      const orb = createWaterCometOrb(0.24);
      mesh = orb.group;
      let age = 0;
      updateFn = (dt) => {
        age += dt;
        orb.update(dt, age);
      };
      disposeFn = () => orb.dispose();
    } else if (this.element === 'psychic') {
      const orb = createPsychicOrbGroup(0.24, 2);
      mesh = orb.group;
      updateFn = (dt) => {
        for (let i = 0; i < orb.rings.length; i++) {
          orb.rings[i].rotation.x += dt * (4 + i * 2);
          orb.rings[i].rotation.y += dt * 5;
        }
      };
      disposeFn = () => orb.dispose();
    } else if (this.element === 'storm') {
      const bolt = createStormBoltGroup(0.95, 0.068, false);
      mesh = bolt.group;
      mesh.lookAt(origin.clone().addScaledVector(dir, 3));
      updateFn = (dt) => {
        bolt.group.rotation.z += dt * 14;
      };
      disposeFn = () => bolt.dispose();
    } else if (this.element === 'light') {
      const beam = createPhotonBeamGroup(1.15, 0.075);
      mesh = beam.group;
      mesh.lookAt(origin.clone().addScaledVector(dir, 3));
      let age = 0;
      updateFn = (dt) => {
        age += dt;
        beam.update(dt, age);
      };
      disposeFn = () => beam.dispose();
    } else if (this.element === 'shadow') {
      const lance = createShadowLanceGroup(1.2, 0.08, false, true);
      mesh = lance.group;
      mesh.lookAt(origin.clone().addScaledVector(dir, 3));
      let age = 0;
      updateFn = (dt) => {
        age += dt;
        lance.update(dt, age);
      };
      disposeFn = () => lance.dispose();
    } else {
      const vortex = createHorizontalVortexMesh();
      vortex.group.scale.setScalar(0.65);
      mesh = vortex.group;
      updateFn = (dt) => vortex.update(dt);
      disposeFn = () => vortex.dispose();
    }

    mesh.position.copy(origin).addScaledVector(dir, 0.85);
    if (this.sound) this.sound.playHit(0.3);

    const proj = new Projectile({
      mesh,
      velocity: dir.clone().multiplyScalar(speed),
      radius,
      gravity,
      life: 3.0,
      damage,
      knockback,
      owner: this,
      ownerId: this.id,
      tag: `monster_${this.monsterType}`,
      onUpdate: updateFn,
      onImpact: (hit) => {
        if (this.vfx) {
          this.vfx.spawnHitSparks(hit.point, hit.normal, heavy ? 1.4 : 0.9);
        }
        disposeFn();
      },
      onExpire: disposeFn,
    });

    this.combat.addProjectile(proj);
  }

  update(dt) {
    if (!this.isAlive) {
      this._clearTelegraph();
      this._charge = null;
      return;
    }

    if (this.isRemoteVisual) {
      if (this._hasSnapshot) {
        this.position.lerp(this._netPos, 1 - Math.exp(-16 * dt));
        this.yaw = lerpAngle(this.yaw, this._netYaw, 1 - Math.exp(-18 * dt));
        this.mesh.root.rotation.y = this.yaw;
      }
      this.mesh.update(dt, { state: this._netAnimState, speed: this._netSpeed });
      return;
    }

    const target = this._findTarget();
    _wish.set(0, 0, 0);

    // Si está congelado o aturdido/cegado, cancela progreso de telegrafía/embestida
    if (this.isFrozen || this.isStunned || !this.combatEnabled || !target) {
      if ((this.isFrozen || this.isStunned) && this._telegraph) this._clearTelegraph();
      if (this.isFrozen || this.isStunned) this._charge = null;
      this.stepPhysics(dt, { wishDir: _wish, wantsJump: false, wantsDash: false, aimYaw: this.yaw });
      return;
    }

    // Pavor (Confusión sobre monstruo): deja de atacar por completo y huye en dirección opuesta al atacante
    if (this.isFeared) {
      if (this._telegraph) this._clearTelegraph();
      this._charge = null;
      const fearSource = (this._confusedAttackerId && this.combat?.fighters?.find((f) => f && f.id === this._confusedAttackerId)) || target;
      const awayX = this.position.x - fearSource.position.x;
      const awayZ = this.position.z - fearSource.position.z;
      const awayLen = Math.hypot(awayX, awayZ) || 1;
      const hasAbyss = this.arena && this.arena.hasAbyss !== false;
      const arenaR = this.arena && this.arena.getBoundsRadius ? this.arena.getBoundsRadius() : 30;
      const radialDist = hasAbyss
        ? Math.hypot(this.position.x, this.position.z)
        : Math.max(Math.abs(this.position.x), Math.abs(this.position.z));
      if (radialDist > arenaR - 3.8) {
        // Bordeando hacia adentro para no caerse al abismo en pánico
        _wish.set(-this.position.x, 0, -this.position.z).normalize();
      } else {
        _wish.set(awayX / awayLen, 0, awayZ / awayLen);
      }
      const fleeYaw = Math.atan2(_wish.x, _wish.z);
      this.stepPhysics(dt, { wishDir: _wish, wantsJump: false, wantsDash: false, aimYaw: fleeYaw });
      return;
    }

    // Si está telegrafiando un Golpe Sísmico / Onda Expansiva Radial
    if (this._telegraph) {
      const tel = this._telegraph;
      tel.elapsed += dt;
      tel.group.position.set(this.position.x, Math.max(0.06, this.position.y + 0.06), this.position.z);
      const t = Math.min(1, tel.elapsed / tel.duration);
      tel.fillMesh.scale.setScalar(0.08 + t * 0.92);
      tel.chargeRingMesh.scale.setScalar(0.15 + t * 0.95);
      tel.chargeRingMesh.rotation.y += dt * 4.5;
      tel.outerMat.opacity = 0.65 + 0.35 * Math.sin(t * Math.PI * 6);
      tel.fillMat.opacity = 0.16 + 0.22 * t;
      if (this.mesh && this.mesh.setTelegraphCharge) {
        this.mesh.setTelegraphCharge(t);
      }

      if (tel.elapsed >= tel.duration) {
        this._clearTelegraph();
        this._executeRadialSlam(tel);
        this._attackTimer = (this.monsterType === 'colossus' ? 1.45 : 1.55) * this._diffSpec.cdMult;
      }

      this.stepPhysics(dt, { wishDir: _wish, wantsJump: false, wantsDash: false, aimYaw: this.yaw });
      return;
    }

    _toTarget.subVectors(target.position, this.position);
    _toTarget.y = 0;
    const dist = _toTarget.length() || 0.001;
    const dir = _toTarget.clone().divideScalar(dist);
    const aimYaw = Math.atan2(dir.x, dir.z);

    // Si el Coloso está ejecutando embestida pesada
    if (this._charge) {
      this._charge.time -= dt;
      const chargeSpeed = 15.5;
      this.velocity.x = this._charge.dir.x * chargeSpeed;
      this.velocity.z = this._charge.dir.z * chargeSpeed;

      if (!this._charge.hitDone && dist <= this.config.radius + target.config.radius + 0.65) {
        this._charge.hitDone = true;
        const pushDir = this._charge.dir.clone().setY(0.32).normalize();
        target.takeDamage(16, pushDir, 14.0, this.id);
        if (this.vfx) {
          this.vfx.spawnHitSparks(target.position.clone().setY(target.position.y + 1.0), pushDir, 1.5);
          this.vfx.addTrauma(0.3);
        }
        this._charge.time = 0;
      }
      if (this._charge.time <= 0) {
        this._charge = null;
        this._attackTimer = 1.15 * this._diffSpec.cdMult;
      }
      this.stepPhysics(dt, { wishDir: _wish, wantsJump: false, wantsDash: false, aimYaw });
      return;
    }

    this._attackTimer = Math.max(0, this._attackTimer - dt);
    this._zigTimer -= dt;
    if (this._zigTimer <= 0) {
      this._zigTimer = 0.65 + Math.random() * 0.7;
      this._strafeSign *= -1;
    }

    const hasAbyss = this.arena && this.arena.hasAbyss !== false;
    const arenaR = this.arena && this.arena.getBoundsRadius ? this.arena.getBoundsRadius() : 30;
    const dangerR = hasAbyss ? arenaR - 4.2 : arenaR - 2.5;
    const radialDist = hasAbyss
      ? Math.hypot(this.position.x, this.position.z)
      : Math.max(Math.abs(this.position.x), Math.abs(this.position.z));

    let wantsDash = false;

    if (radialDist > dangerR) {
      // Prioriza no caerse al abismo por cuenta propia
      _wish.set(-this.position.x, 0, -this.position.z).normalize();
    } else if (this.monsterType === 'spirit') {
      // Espíritu: se mantiene entre 8 y 14u haciendo zigzags rápidos y dashes evasivos
      if (dist < 7.5) _wish.addScaledVector(dir, -0.9);
      else if (dist > 14.0) _wish.addScaledVector(dir, 0.95);
      _strafe.set(-dir.z * this._strafeSign, 0, dir.x * this._strafeSign);
      _wish.addScaledVector(_strafe, 1.15);

      if (this.dashCooldown <= 0 && dist < 13 && Math.random() < 0.025) {
        wantsDash = true;
      }

      if (this._attackTimer <= 0 && dist <= 24) {
        this.mesh.playAction('punch_right', 0.28);
        this._spawnMonsterProjectile({ target, damage: 8, knockback: 5.5, speed: 24 });
        if (this._burstLeft > 0) {
          this._burstLeft--;
          this._attackTimer = 0.26 * this._diffSpec.cdMult;
        } else {
          this._burstLeft = this.difficulty === 'grandmaster' ? 2 : 1;
          this._attackTimer = (1.55 + Math.random() * 0.45) * this._diffSpec.cdMult;
        }
      }
    } else if (this.monsterType === 'golem') {
      // Gólem: avanza implacable; lanza roca pesada a media distancia y Golpe Sísmico < 4.5u
      if (dist > 3.2) {
        _wish.addScaledVector(dir, 1.0);
      }
      if (this._attackTimer <= 0) {
        if (dist < 4.5) {
          this._startRadialTelegraph({ radius: 4.6, duration: 0.65, damage: 18, knockback: 14.5 });
        } else if (dist <= 21) {
          this.mesh.playAction('heavy_throw', 0.42);
          this._spawnMonsterProjectile({ target, damage: 12, knockback: 9.0, speed: 20, heavy: true });
          this._attackTimer = (1.9 + Math.random() * 0.4) * this._diffSpec.cdMult;
        }
      }
    } else {
      // Coloso Elemental (Jefe): alterna 3 proyectiles en abanico, Onda Expansiva Radial y embestida
      if (dist > 4.2) _wish.addScaledVector(dir, 0.92);
      _strafe.set(-dir.z * this._strafeSign, 0, dir.x * this._strafeSign);
      _wish.addScaledVector(_strafe, 0.35);

      if (this._attackTimer <= 0) {
        const pattern = this._colossusStep % 3;
        this._colossusStep++;
        if (pattern === 0 || dist > 15) {
          this.mesh.playAction('heavy_throw', 0.45);
          for (const ang of [-0.26, 0, 0.26]) {
            this._spawnMonsterProjectile({ target, damage: 12, knockback: 8.5, speed: 22, angleOffset: ang });
          }
          this._attackTimer = 1.65 * this._diffSpec.cdMult;
        } else if (pattern === 1 && dist < 8.5) {
          this._startRadialTelegraph({ radius: 6.2, duration: 0.85, damage: 22, knockback: 16.0 });
        } else {
          // Embestida pesada
          this.mesh.playAction('punch_right', 0.48);
          this._charge = { dir: dir.clone(), time: 0.48, hitDone: false };
        }
      }
    }

    // Evita chocar contra pilares / muros del mapa
    if (this.arena && this.arena.pillars) {
      for (const p of this.arena.pillars) {
        const dx = this.position.x - p.x;
        const dz = this.position.z - p.z;
        const d = Math.hypot(dx, dz);
        const safe = p.radius + this.config.radius + 1.2;
        if (d < safe && d > 1e-4) {
          _wish.x += (dx / d) * 1.4;
          _wish.z += (dz / d) * 1.4;
        }
      }
    }

    if (_wish.lengthSq() > 0.0001) _wish.normalize();
    this.stepPhysics(dt, {
      wishDir: _wish,
      wantsJump: false,
      wantsDash,
      aimYaw,
    });
  }

  dispose() {
    this._clearTelegraph();
    this._charge = null;
    if (this.mesh && this.mesh.root && this.mesh.root.parent) {
      this.mesh.root.parent.remove(this.mesh.root);
    }
    if (this.mesh && this.mesh.dispose) {
      this.mesh.dispose();
    }
  }
}
