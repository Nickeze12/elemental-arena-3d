import * as THREE from 'three';
import { BaseFighter, EARTH_ORBIT_ROCK_DURATION, lerpAngle } from './BaseFighter.js';
import { createElementController } from '../combat/ElementFactory.js';

/**
 * RemoteFighter
 * ------------------------------------------------------------
 * Representa a otro jugador conectado vía P2P (Host o Invitado)
 * extendiendo `BaseFighter` con interpolación suave de posición,
 * rotación, animaciones, acciones y estados elementales visuales.
 */
export class RemoteFighter extends BaseFighter {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {string} [o.name='Maestro']
   * @param {'earth'|'fire'|'water'|'air'} [o.element='earth']
   * @param {string} [o.team]
   * @param {THREE.Scene} o.scene
   * @param {object} o.arena
   */
  constructor({ id, name = 'Maestro', element = 'earth', team = null, scene, arena }) {
    super({ id, team: team || id, theme: element, scene, arena });
    this.displayName = name;
    this.element = element;
    this.isRemote = true;
    this.combatEnabled = true;

    this.animState = 'idle';
    this.auraActive = false;

    this.aimYaw = 0;
    this.aimPoint = new THREE.Vector3(0, 1.2, 0);
    this.elementController = null;
    this.cooldownBonus = 0;

    this._netPos = new THREE.Vector3();
    this._netVel = new THREE.Vector3();
    this._netYaw = 0;
    this._hasSnapshot = false;
    this._prevAnimState = 'idle';
    this._lastActionNonce = '';
    this._dashFxTimer = 0;
  }

  /** Crea y registra el controlador elemental oficial para replicar habilidades */
  initCombat(combat, isAllyRing = false) {
    if (!combat) return;
    this.combat = combat;
    this.vfx = combat.vfx;
    this.sound = combat.sound;
    this.elementController = createElementController(
      this.element,
      combat,
      this,
      {
        getAimYaw: () => this.aimYaw,
        getAimPoint: () => this.aimPoint.clone(),
      },
      0
    );
    combat.registerFighter(this, this.elementController);
    if (isAllyRing && this.mesh && this.mesh.setTeamRing) {
      this.mesh.setTeamRing('ally');
    }
  }

  /** Ejecuta una habilidad elemental replicada por red (ABILITY_CAST) */
  castNetworkSkill({ slot, origin, aimPoint, yaw }, validateCooldown = false) {
    if (!this.elementController || !this.isAlive) return false;

    if (typeof yaw === 'number') {
      this.aimYaw = yaw;
      this.yaw = yaw;
      this.mesh.root.rotation.y = yaw;
    }
    const readVec = (v) => (
      Array.isArray(v) && v.length === 3
        ? v
        : v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number'
          ? [v.x, v.y, v.z]
          : null
    );
    const aimArr = readVec(aimPoint);
    if (aimArr) {
      this.aimPoint.set(aimArr[0], aimArr[1], aimArr[2]);
    }
    const origArr = readVec(origin);
    if (origArr) {
      const distSq =
        (this.position.x - origArr[0]) ** 2 +
        (this.position.y - origArr[1]) ** 2 +
        (this.position.z - origArr[2]) ** 2;
      if (distSq < 9) {
        this.position.set(origArr[0], origArr[1], origArr[2]);
      }
    }

    if (!validateCooldown && this.elementController.cooldowns) {
      for (const k of Object.keys(this.elementController.cooldowns)) {
        this.elementController.cooldowns[k] = 0;
      }
    }

    if (slot === 'mist_end' && this.elementController && typeof this.elementController.endMistForm === 'function') {
      return !!this.elementController.endMistForm();
    }

    const map = {
      primary: 'tryPrimary',
      secondary: 'trySecondary',
      skill1: 'trySkill1',
      skill2: 'trySkill2',
    };
    const fn = map[slot];
    if (!fn || typeof this.elementController[fn] !== 'function') return false;
    return !!this.elementController[fn](this.aimPoint.clone());
  }

  setElement(element = 'earth') {
    this.element = element;
    if (this.combat && this.elementController) {
      this.elementController = this.combat.setFighterElement(this, element);
      if (this.elementController) {
        this.elementController.aimProvider = {
          getAimYaw: () => this.aimYaw,
          getAimPoint: () => this.aimPoint.clone(),
        };
        this.elementController.cooldownBonus = 0;
      }
      if (this.mesh && this.mesh.setTheme) {
        this.mesh.setTheme(element);
      }
    } else if (this.mesh && this.mesh.setTheme) {
      this.mesh.setTheme(element);
    }
  }

  /**
   * Coloca al jugador remoto en su punto inicial de aparición.
   */
  resetFighter(spawnPos = new THREE.Vector3(0, 0, 0), spawnYaw = 0, withEffect = false) {
    super.resetFighter(spawnPos, spawnYaw, withEffect);
    this._netPos.copy(spawnPos);
    this._netVel.set(0, 0, 0);
    this._netYaw = spawnYaw;
    this._hasSnapshot = true;
    this.animState = 'idle';
    this._prevAnimState = 'idle';
    this.auraActive = false;
    this.isMistFormActive = false;
    this.mistFormTimer = 0;
    this.shadowStepVeilTimer = 0;
    this.inEclipseVeil = false;
    this.shogunArmorTimer = 0;
    this.attackSlowTimer = 0;
    this.slowTimer = 0;
    if (this.mesh && this.mesh.setMistForm) {
      this.mesh.setMistForm(false);
    }
    if (this.mesh && this.mesh.setShadowVeil) {
      this.mesh.setShadowVeil(false);
    }
    if (this.mesh && this.mesh.setShogunArmor) {
      this.mesh.setShogunArmor(false);
    }
    if (this.mesh && this.mesh.setAttackSlowed) {
      this.mesh.setAttackSlowed(false);
    }
    if (this.mesh && this.mesh.setElementalAura) {
      this.mesh.setElementalAura(this.element, false);
    }
  }

  /**
   * Aplica un estado proveniente de `PLAYER_INPUT_STATE` o `WORLD_SNAPSHOT`.
   * Cuando `acceptAuthority` es `false` (ej. Host leyendo input de un Guest),
   * ignora campos autoritativos (HP, vida y estados alterados) para no pisar la autoridad del Host.
   * @param {object} s
   * @param {boolean} [acceptAuthority=true]
   */
  applyNetworkState(s, acceptAuthority = true) {
    if (!s) return;
    if (s.name) this.displayName = s.name;
    if (s.element && s.element !== this.element) {
      this.setElement(s.element);
    }

    if (Array.isArray(s.pos) && s.pos.length === 3) {
      this._netPos.set(s.pos[0], s.pos[1], s.pos[2]);
      if (!this._hasSnapshot || this.position.distanceToSquared(this._netPos) > 64) {
        this.position.copy(this._netPos);
      }
      this._hasSnapshot = true;
    }

    if (Array.isArray(s.vel) && s.vel.length === 3) {
      this._netVel.set(s.vel[0], s.vel[1], s.vel[2]);
      this.velocity.copy(this._netVel);
    }

    if (typeof s.yaw === 'number') {
      this._netYaw = s.yaw;
      if (!this._hasSnapshot) {
        this.yaw = s.yaw;
        this.mesh.root.rotation.y = s.yaw;
      }
    }

    if (s.animState) {
      if (s.animState !== this._prevAnimState) {
        if (s.animState === 'jump' && this.vfx) {
          this.vfx.spawnDust(this.position, { count: 6, size: 0.5, speed: 1.8, spread: 0.2, life: 0.45, ring: true });
        } else if (s.animState === 'dash' && this.vfx) {
          this.vfx.spawnDust(this.position, { count: 8, size: 0.65, speed: 2.4, spread: 0.25, life: 0.5 });
        }
        this._prevAnimState = s.animState;
      }
      this.animState = s.animState;
      this.isDashing = s.animState === 'dash';
      this.onGround = s.animState !== 'jump' && s.animState !== 'fall';
    }

    if (s.action && s.action !== this._lastActionNonce) {
      this._lastActionNonce = s.action;
      const actionName = String(s.action).split(':')[0];
      this.mesh.playAction(actionName, s.actionDur || 0.35);
    } else if (!s.action) {
      this._lastActionNonce = '';
    }

    if (acceptAuthority) {
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
      if (typeof s.earthOrbitCount === 'number') {
        this.earthRockTimers = Array(Math.max(0, Math.min(2, s.earthOrbitCount))).fill(EARTH_ORBIT_ROCK_DURATION);
        if (this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(s.earthOrbitCount);
      }
      if (typeof s.isEarthTrapped === 'boolean') {
        this.earthTrapTimer = s.isEarthTrapped ? 1 : 0;
        if (this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(s.isEarthTrapped);
      }
      if (typeof s.isMistForm === 'boolean') {
        this.isMistFormActive = s.isMistForm;
        if (!s.isMistForm) this.mistFormTimer = 0;
        if (this.mesh.setMistForm) this.mesh.setMistForm(s.isMistForm);
      }
      if (typeof s.isShadowVeil === 'boolean') {
        this.shadowStepVeilTimer = s.isShadowVeil ? Math.max(this.shadowStepVeilTimer || 0, 0.25) : 0;
        if (this.mesh.setShadowVeil) this.mesh.setShadowVeil(s.isShadowVeil || this.inEclipseVeil);
      }
      if (typeof s.isShogunArmor === 'boolean') {
        this.shogunArmorTimer = s.isShogunArmor ? Math.max(this.shogunArmorTimer || 0, 0.25) : 0;
        if (this.mesh.setShogunArmor) this.mesh.setShogunArmor(s.isShogunArmor);
      }
      if (typeof s.isAttackSlowed === 'boolean') {
        this.attackSlowTimer = s.isAttackSlowed ? Math.max(this.attackSlowTimer || 0, 0.25) : 0;
        if (this.mesh.setAttackSlowed) this.mesh.setAttackSlowed(s.isAttackSlowed);
      }
      if (typeof s.auraActive === 'boolean' && s.auraActive !== this.auraActive) {
        this.auraActive = s.auraActive;
        if (this.mesh.setElementalAura) {
          this.mesh.setElementalAura(this.element, s.auraActive, 1);
        }
      }
    }
  }

  /** Interpola suavemente posición, orientación y animación */
  update(dt) {
    if (this.combat && this.combat.isAuthoritative) {
      this.stepStatusTimers(dt);
    }
    if (this._hasSnapshot) {
      const kPos = 1 - Math.exp(-18 * dt);
      this.position.lerp(this._netPos, kPos);

      const kYaw = 1 - Math.exp(-20 * dt);
      this.yaw = lerpAngle(this.yaw, this._netYaw, kYaw);
      this.mesh.root.rotation.y = this.yaw;
    }

    if (this.isDashing && this.vfx) {
      this._dashFxTimer -= dt;
      if (this._dashFxTimer <= 0) {
        this._dashFxTimer = 0.045;
        this.vfx.spawnDust(this.position.clone().setY(this.position.y + 0.35), {
          count: 2,
          size: 0.5,
          speed: 1.2,
          life: 0.35,
          alpha: 0.45,
        });
      }
    }

    const horizSpeed = Math.hypot(this._netVel.x, this._netVel.z);
    const meshState = this.animState === 'fall' ? 'jump' : (this.animState || 'idle');
    this.mesh.update(dt, {
      state: meshState,
      speed: horizSpeed,
      verticalVelocity: this._netVel.y,
    });
  }

  dispose() {
    if (this.mesh && this.mesh.root && this.mesh.root.parent) {
      this.mesh.root.parent.remove(this.mesh.root);
    }
  }
}
