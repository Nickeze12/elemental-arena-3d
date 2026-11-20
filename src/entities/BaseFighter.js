import * as THREE from 'three';
import { FighterMesh } from './FighterMesh.js';

/**
 * BaseFighter
 * ------------------------------------------------------------
 * Clase base compartida por el jugador (`Player`) y el rival IA (`EnemyFighter`).
 * Gestiona:
 *  - Identificador (`id`: 'player' | 'enemy'), salud (`hp = 100`, `maxHp = 100`) y estado `isAlive`.
 *  - Física horizontal, salto, dash, gravedad y colisiones con suelo, pilares y muros.
 *  - Daño y empuje dinámico estilo Pro-Bending (`takeDamage`), donde el empuje
 *    escala según la vida faltante: `knockbackScale = 1 + (1 - hp / maxHp) * 1.5`.
 *  - Detección de derrota por K.O. (`hp <= 0`) o Ring-Out (`y < -12`).
 */

export const FIGHTER_CONFIG = {
  radius: 0.42,
  runSpeed: 7.2,
  groundAccel: 14,
  airAccel: 3.5,
  gravity: 30,
  maxFallSpeed: 45,
  jumpSpeed: 10.5,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  dashSpeed: 26,
  dashDuration: 0.2,
  dashCooldown: 1.5,
  turnSpeed: 12,
  ringOutY: -12,
};

export const EARTH_ORBIT_ROCK_DURATION = 5.5;

export class BaseFighter {
  /**
   * @param {object} o
   * @param {string} o.id 'player' | 'enemy'
   * @param {string | object} [o.theme='player']
   * @param {THREE.Scene} o.scene
   * @param {import('../world/Arena.js').Arena} o.arena
   */
  constructor({ id, team = null, theme = 'player', scene, arena, customMesh = null, isMonster = false, knockbackMultiplier = 1 }) {
    this.id = id;
    this.team = team ?? id;
    this.scene = scene;
    this.arena = arena;
    this.config = { ...FIGHTER_CONFIG };
    this.isMonster = !!isMonster;
    this.knockbackMultiplier = knockbackMultiplier;
    this.survivalMods = null;

    this.maxHp = 100;
    this.hp = 100;
    this.isAlive = true;

    this.mesh = customMesh || new FighterMesh(theme);
    scene.add(this.mesh.root);

    /** Posición de los pies (comparte referencia con el mesh) */
    this.position = this.mesh.root.position;
    this.velocity = new THREE.Vector3();
    /** Orientación del cuerpo en radianes */
    this.yaw = 0;

    this.onGround = true;
    this._waterStepTimer = 0;
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._airJumpsUsed = 0;

    this.isDashing = false;
    this._dashTime = 0;
    this.dashCooldown = 0;
    this._dashCharges = 1;
    this._dashDir = new THREE.Vector3();

    /** Temporizador de orientación al atacar */
    this._combatTurnTimer = 0;
    this._combatTargetYaw = 0;

    /** Temporizador de aturdimiento por empuje (reduce el control de aceleración) */
    this._hitstunTimer = 0;
    /** Temporizador de invulnerabilidad breve tras reaparición por caída (1.2s) */
    this.invulnTimer = 0;
    /** Temporizador de estado alterado: Congelamiento (inmoviliza al luchador) */
    this.freezeTimer = 0;
    /** Temporizador de estado alterado: Quemadura (daño continuo sin hitstun) */
    this.burnTimer = 0;
    this._burnDps = 4.5;
    this._burnTickAccum = 0;
    this._burnSparkTimer = 0;
    /** Temporizador de estado alterado: Enredado (impide movimiento y salto) */
    this.rootTimer = 0;
    /** Temporizador de estado alterado: Veneno (daño continuo verde esmeralda) */
    this.poisonTimer = 0;
    this._poisonDps = 4.0;
    this._poisonTickAccum = 0;
    this._poisonSporeTimer = 0;
    this._poisonAttackerId = null;
    /** Temporizador de estado alterado: Confusión (controles invertidos / pavor en monstruos) */
    this.confusedTimer = 0;
    this._confusedAttackerId = null;
    /** Temporizador de estado alterado: Aturdimiento / Cegado (Destello Solar) */
    this.stunTimer = 0;
    /** Rocas flotantes acumuladas por Disco Roca (2.0s c/u) y Prisión de Roca (3.0s al llegar a 3) */
    this.earthRockTimers = [];
    this.earthTrapTimer = 0;
    /** Buff de Emboscada y camuflaje de Velo de Eclipse / Paso Sombrío */
    this.shadowAmbushTimer = 0;
    this.shadowStepVeilTimer = 0;
    this.inEclipseVeil = false;
    this._eclipseZone = null;
    this.shadowVeilSlowTimer = 0;
    /** Buff acumulable de velocidad (+30% por carga, máx. 2 cargas = +60%, 4.0s) por Tentáculos Oscuros */
    this.shadowSpeedBuffStacks = 0;
    this.shadowSpeedBuffTimer = 0;
    /** Forma de Niebla (Tormenta): flotación veloz e invulnerabilidad mientras se mantiene */
    this.isMistFormActive = false;
    this.mistFormTimer = 0;
    this.mistFormMaxDuration = 4.0;
    /** Estado inmortal de práctica en Modo Dojo (regenera a 100 HP tras 1.0s bajo 1 HP) */
    this.isDojoImmortal = false;
    this._dojoRegenTimer = 0;

    /** Regeneración periódica del aliado revivido en Supervivencia (+1 HP cada 2s) */
    this.allyRegenAmount = 0;
    this.allyRegenInterval = 2.0;
    this._allyRegenTimer = 0;

    /** Temporizador para espaciar partículas de estela durante el Dash */
    this._dashTrailTimer = 0;

    /** Gestor de combate asociado */
    this.combat = null;
    /** Referencias opcionales a VFX y Audio */
    this.vfx = null;
    this.sound = null;

    /** Controlador elemental propio (para Player o EnemyFighter) */
    this.elementController = null;

    /** Callback opcional al recibir Ceguera / Destello Solar siendo jugador */
    this.onSolarBlind = null;

    /** Callback al ser derrotado: `(fighter, reason: 'KO' | 'RING_OUT') => void` */
    this.onDefeated = null;

    /** Callback al recibir daño: `(fighter, amount, isHeavy) => void` */
    this.onDamaged = null;

    /** Callback al iniciar un Dash: `(fighter) => void` */
    this.onDashStart = null;

    /** Callback opcional al reaparecer por Reset */
    this.onRespawn = null;

    /** Callback opcional al reaparecer en el centro tras caída al abismo */
    this.onAbyssRespawn = null;

    /** Callback en Guest Online al cruzar el abismo para notificar penalización al Host */
    this.onLocalAbyssFall = null;
  }

  setArena(arena) {
    this.arena = arena;
  }

  /** Cantidad máxima de saltos extra en el aire permitidos */
  getMaxAirJumps() {
    if (!this.survivalMods) return 0;
    return (this.survivalMods.extraAirJumps || 0) + (this.survivalMods.auraAirJumps || 0);
  }

  /** Saltos aéreos disponibles en el aire actualmente */
  get airJumpsRemaining() {
    return Math.max(0, this.getMaxAirJumps() - this._airJumpsUsed);
  }

  /** Cargas máximas de Dash disponibles */
  getMaxDashCharges() {
    if (!this.survivalMods) return 1;
    return 1 + (this.survivalMods.extraDashCharges || 0) + (this.survivalMods.auraDashCharges || 0);
  }

  /** Duración efectiva de recarga por carga de Dash */
  getEffectiveDashCooldown() {
    return this.config.dashCooldown * (this.survivalMods?.dashCooldownMult || 1);
  }

  /** Progreso de recarga del dash en [0, 1] (1 = listo) */
  get dashReadiness() {
    if (this._dashCharges > 0) return 1;
    const cd = Math.max(0.1, this.getEffectiveDashCooldown());
    return Math.max(0, Math.min(1, 1 - this.dashCooldown / cd));
  }

  /** ¿Está el luchador actualmente congelado? */
  get isFrozen() {
    return this.freezeTimer > 0;
  }

  /** ¿Está el luchador actualmente quemándose? */
  get isBurning() {
    return this.burnTimer > 0;
  }

  get isRooted() {
    return this.rootTimer > 0;
  }

  get isPoisoned() {
    return this.poisonTimer > 0;
  }

  get isConfused() {
    return this.confusedTimer > 0;
  }

  get isFeared() {
    return !!this.isMonster && this.confusedTimer > 0;
  }

  get isStunned() {
    return this.stunTimer > 0;
  }

  get earthOrbitCount() {
    return this.earthRockTimers.length;
  }

  get isEarthTrapped() {
    return this.earthTrapTimer > 0;
  }

  get isShadowVeil() {
    return !!this.inEclipseVeil || this.shadowStepVeilTimer > 0;
  }

  get isInvulnerable() {
    return !!this.isMistFormActive || this.invulnTimer > 0 || this.shadowStepVeilTimer > 0;
  }

  /**
   * Emite una breve bocanada de niebla cuando la Forma de Niebla evade un impacto/estado.
   */
  _spawnMistEvadePuff() {
    if (this.vfx && this.vfx.spawnDust) {
      this.vfx.spawnDust(this.position.clone().setY(this.position.y + 0.9), {
        count: 6,
        size: 0.72,
        speed: 2.8,
        spread: 0.45,
        life: 0.38,
        color: '#e2e8f0',
      });
    }
  }

  /**
   * Aplica el estado alterado Congelamiento durante `duration` segundos.
   * Mientras dura, el luchador no puede moverse, saltar, hacer dash ni lanzar
   * habilidades, pero sí puede recibir daño y ser empujado.
   * @param {number} [duration=1.5]
   */
  _getAttackerSurvivalMods(attackerId) {
    if (!attackerId || !this.combat || !this.combat.fighters) return null;
    const attacker = this.combat.fighters.find((f) => f && f.id === attackerId);
    return attacker && attacker.survivalMods ? attacker.survivalMods : null;
  }

  applyFreeze(duration = 1.5, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    this.freezeTimer = Math.max(this.freezeTimer, duration * durScale);
    this.isDashing = false;
    this._dashTime = 0;
    this.mesh.setFrozen(true);
    if (this.sound && this.sound.playIceWall) {
      this.sound.playIceWall();
    }
    if (this.vfx && this.vfx.spawnIceShatter) {
      this.vfx.spawnIceShatter(this.position.clone().setY(this.position.y + 0.9), 12);
    }
    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: 0,
        knockback: null,
        isCrit: false,
        status: 'freeze',
        hp: this.hp,
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /**
   * Aplica el estado alterado Quemadura durante `duration` segundos.
   * Inflige daño periódico continuo cada 0.5s sin causar hitstun ni
   * interrumpir el movimiento del luchador.
   * @param {number} [duration=2.0]
   * @param {number} [damagePerSecond=4.5]
   */
  applyBurn(duration = 2.0, damagePerSecond = 4.5, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    const dmgScale = mods ? mods.burnDamageMult || 1 : 1;
    const wasBurning = this.burnTimer > 0;
    this.burnTimer = Math.max(this.burnTimer, duration * durScale);
    this._burnDps = Math.max(wasBurning ? this._burnDps : 0, damagePerSecond * dmgScale);
    if (attackerId && attackerId !== this.id) {
      this._burnAttackerId = attackerId;
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }
    if (!wasBurning) {
      this._burnTickAccum = 0.25; // Primer tick tras 0.25s, luego cada 0.5s
      this._burnSparkTimer = 0;
      if (this.sound && this.sound.playBurnSizzle) {
        this.sound.playBurnSizzle();
      }
      if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
        this.combat.onAuthoritativeCombatEvent({
          targetId: this.id,
          attackerId,
          damage: 0,
          knockback: null,
          isCrit: false,
          status: 'burn',
          hp: this.hp,
          maxHp: this.maxHp,
          isAlive: this.isAlive,
        });
      }
    }
    if (this.mesh && this.mesh.setBurning) {
      this.mesh.setBurning(true);
    }
  }

  /**
   * Aplica el estado alterado Enredado durante `duration` segundos.
   * Impide el desplazamiento horizontal, salto y dash mientras permite girar la cámara y defenderse.
   * @param {number} [duration=1.7]
   * @param {string|null} [attackerId=null]
   */
  applyRoot(duration = 1.7, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    if (attackerId && this.combat && !this.combat.isHostile(attackerId, this)) return;

    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    this.rootTimer = Math.max(this.rootTimer, duration * durScale);
    this.isDashing = false;
    this._dashTime = 0;
    this.velocity.x *= 0.1;
    this.velocity.z *= 0.1;
    if (attackerId && attackerId !== this.id && attackerId !== '__tornado_release__') {
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }
    if (this.mesh && this.mesh.setRooted) {
      this.mesh.setRooted(true);
    }
    if (this.sound && this.sound.playNatureRoot) {
      this.sound.playNatureRoot();
    }
    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: 0,
        knockback: null,
        isCrit: false,
        status: 'root',
        hp: this.hp,
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /**
   * Aplica el estado alterado Veneno durante `duration` segundos.
   * Aplica daño continuo verde esmeralda cada 0.5s sin hitstun.
   * @param {number} [duration=3.5]
   * @param {number} [damagePerSecond=4.0]
   * @param {string|null} [attackerId=null]
   */
  applyPoison(duration = 3.5, damagePerSecond = 4.0, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    if (attackerId && this.combat && !this.combat.isHostile(attackerId, this)) return;

    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    const dmgScale = mods ? mods.burnDamageMult || 1 : 1;
    const wasPoisoned = this.poisonTimer > 0;
    this.poisonTimer = Math.max(this.poisonTimer, duration * durScale);
    this._poisonDps = Math.max(wasPoisoned ? this._poisonDps : 0, damagePerSecond * dmgScale);
    if (attackerId && attackerId !== this.id) {
      this._poisonAttackerId = attackerId;
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }
    if (!wasPoisoned) {
      this._poisonTickAccum = 0.25;
      this._poisonSporeTimer = 0;
      if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
        this.combat.onAuthoritativeCombatEvent({
          targetId: this.id,
          attackerId,
          damage: 0,
          knockback: null,
          isCrit: false,
          status: 'poison',
          hp: this.hp,
          maxHp: this.maxHp,
          isAlive: this.isAlive,
        });
      }
    }
    if (this.mesh && this.mesh.setPoisoned) {
      this.mesh.setPoisoned(true);
    }
  }

  /**
   * Aplica Confusión (invierte controles de movimiento/cámara o aplica Pavor en monstruos).
   * @param {number} [duration=3.0]
   * @param {string|null} [attackerId=null]
   */
  applyConfusion(duration = 3.0, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    if (attackerId && this.combat && !this.combat.isHostile(attackerId, this)) return;

    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    const effDur = duration * durScale;
    this.confusedTimer = Math.max(this.confusedTimer, effDur);
    if (attackerId && attackerId !== this.id) {
      this._confusedAttackerId = attackerId;
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }
    if (this.mesh && this.mesh.setConfused) {
      this.mesh.setConfused(true);
    }
    if (this.sound && this.sound.playPsychicConfuse) {
      this.sound.playPsychicConfuse();
    }
    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: 0,
        knockback: null,
        isCrit: false,
        status: 'confused',
        duration: effDur,
        hp: this.hp,
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /**
   * Aplica Aturdimiento / Ceguera Solar (impide moverse, atacar o usar habilidades).
   * @param {number} [duration=1.1]
   * @param {string|null} [attackerId=null]
   */
  applyStun(duration = 1.1, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    if (attackerId && this.combat && !this.combat.isHostile(attackerId, this)) return;

    const mods = this._getAttackerSurvivalMods(attackerId);
    const durScale = mods ? mods.statusDurationMult || 1 : 1;
    const effDur = duration * durScale;
    this.stunTimer = Math.max(this.stunTimer, effDur);
    if (attackerId && attackerId !== this.id && attackerId !== '__tornado_release__') {
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }
    if (this.mesh && this.mesh.setStunned) {
      this.mesh.setStunned(true);
    }
    if (this.mesh && this.mesh.flash) {
      this.mesh.flash('#fef08a');
    }
    if (this.id === 'player' && this.onSolarBlind) {
      this.onSolarBlind(2.0);
    }
    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: 0,
        knockback: null,
        isCrit: false,
        status: 'stun',
        duration: effDur,
        hp: this.hp,
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /** Otorga 1 carga acumulable (máx. 2 cargas = +60%) de +30% velocidad de movimiento por `duration` s */
  applyShadowSpeedBuff(duration = 4.0) {
    if (!this.isAlive) return;
    this.shadowSpeedBuffStacks = Math.min(2, (this.shadowSpeedBuffStacks || 0) + 1);
    this.shadowSpeedBuffTimer = Math.max(this.shadowSpeedBuffTimer || 0, duration);
  }

  /**
   * Acumula una roca flotante por impacto de Disco Roca (dura 5.5s).
   * Al juntar 3 rocas al mismo tiempo atrapa al objetivo en roca de medio cuerpo e inmoviliza por 3.0s.
   */
  applyEarthRockHit(attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;
    if (attackerId && this.combat && !this.combat.isHostile(attackerId, this)) return;

    // Si ya está atrapado en roca, no apila orbes flotantes encima
    if (this.earthTrapTimer > 0) return;

    this.earthRockTimers.push(EARTH_ORBIT_ROCK_DURATION);
    if (this.earthRockTimers.length >= 3) {
      this.earthRockTimers.length = 0;
      const mods = this._getAttackerSurvivalMods(attackerId);
      const durScale = mods ? mods.statusDurationMult || 1 : 1;
      const effDur = 3.0 * durScale;
      this.earthTrapTimer = Math.max(this.earthTrapTimer, effDur);
      this.isDashing = false;
      this._dashTime = 0;
      this.velocity.x = 0;
      this.velocity.z = 0;
      if (this.mesh && this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(0);
      if (this.mesh && this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(true);
      if (this.sound && this.sound.playWallRaise) this.sound.playWallRaise();
      if (this.vfx && this.vfx.rockImpact) {
        this.vfx.rockImpact(this.position.clone().setY(this.position.y + 0.45), new THREE.Vector3(0, 1, 0), 1.35);
      }
      if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
        this.combat.onAuthoritativeCombatEvent({
          targetId: this.id,
          attackerId,
          damage: 0,
          knockback: null,
          isCrit: false,
          status: 'earth_trap',
          duration: effDur,
          hp: this.hp,
          maxHp: this.maxHp,
          isAlive: this.isAlive,
        });
      }
      return;
    }

    const count = this.earthRockTimers.length;
    if (this.mesh && this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(count);
    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: 0,
        knockback: null,
        isCrit: false,
        status: 'earth_orbit',
        count,
        hp: this.hp,
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /** Devuelve true si el luchador pisa agua del escenario o un charco activo de Maremoto */
  isOnWaterSurface() {
    if (this.combat && this.combat.isWaterAt) {
      return this.combat.isWaterAt(this.position.x, this.position.y, this.position.z);
    }
    return Boolean(this.arena && this.arena.isWaterAt && this.arena.isWaterAt(this.position.x, this.position.y, this.position.z));
  }

  /** Limpia todos los estados alterados activos */
  clearStatuses() {
    this.freezeTimer = 0;
    this.burnTimer = 0;
    this._burnDps = 0;
    this._burnTickAccum = 0;
    this._burnSparkTimer = 0;
    this._burnAttackerId = null;
    this.rootTimer = 0;
    this.poisonTimer = 0;
    this._poisonDps = 0;
    this._poisonTickAccum = 0;
    this._poisonSporeTimer = 0;
    this._poisonAttackerId = null;
    this.confusedTimer = 0;
    this._confusedAttackerId = null;
    this.stunTimer = 0;
    this.shadowAmbushTimer = 0;
    this.shadowStepVeilTimer = 0;
    this.inEclipseVeil = false;
    this._eclipseZone = null;
    this.shadowVeilSlowTimer = 0;
    this.shadowSpeedBuffStacks = 0;
    this.shadowSpeedBuffTimer = 0;
    this.earthRockTimers.length = 0;
    this.earthTrapTimer = 0;
    this.isMistFormActive = false;
    this.mistFormTimer = 0;
    this.lastAttackerId = null;
    this.lastAttackerTimer = 0;
    if (this.mesh && this.mesh.setFrozen) this.mesh.setFrozen(false);
    if (this.mesh && this.mesh.setBurning) this.mesh.setBurning(false);
    if (this.mesh && this.mesh.setRooted) this.mesh.setRooted(false);
    if (this.mesh && this.mesh.setPoisoned) this.mesh.setPoisoned(false);
    if (this.mesh && this.mesh.setConfused) this.mesh.setConfused(false);
    if (this.mesh && this.mesh.setStunned) this.mesh.setStunned(false);
    if (this.mesh && this.mesh.setMistForm) this.mesh.setMistForm(false);
    if (this.mesh && this.mesh.setShadowVeil) this.mesh.setShadowVeil(false);
    if (this.mesh && this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(0);
    if (this.mesh && this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(false);
  }

  setCombatManager(combat) {
    this.combat = combat;
    if (combat && combat.vfx && !this.vfx) this.vfx = combat.vfx;
    if (combat && combat.sound && !this.sound) this.sound = combat.sound;
  }

  /**
   * Orienta el cuerpo/torso hacia `yaw` durante `duration` segundos.
   */
  faceDirection(yaw, duration = 0.4) {
    this._combatTargetYaw = yaw;
    this._combatTurnTimer = Math.max(this._combatTurnTimer, duration);
  }

  /**
   * Ejecuta un Dash evasivo en la dirección indicada (o hacia donde mira si es nula).
   * @param {THREE.Vector3} [dir]
   * @returns {boolean} true si el dash se activó
   */
  triggerDash(dir) {
    if (this._dashCharges <= 0 || this.isDashing || !this.isAlive || this.isFrozen || this.isRooted || this.isStunned || this.isEarthTrapped) return false;
    this.isDashing = true;
    this._dashTime = this.config.dashDuration;
    this._dashCharges = Math.max(0, this._dashCharges - 1);
    if (this.dashCooldown <= 0) {
      this.dashCooldown = this.getEffectiveDashCooldown();
    }
    if (dir && dir.lengthSq() > 0.0001) {
      this._dashDir.set(dir.x, 0, dir.z).normalize();
    } else {
      this._dashDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }
    this.velocity.y = 0;
    this._dashTrailTimer = 0;
    if (this.sound) this.sound.playDash();
    if (this.vfx) {
      this.vfx.spawnDust(this.position, {
        count: 8,
        size: 0.65,
        speed: 2.6,
        spread: 0.25,
        life: 0.55,
      });
    }
    if (this.onDashStart) this.onDashStart(this);
    return true;
  }

  /**
   * Recibe daño y empuje dinámico estilo Pro-Bending.
   * @param {number} amount daño a restar
   * @param {THREE.Vector3} impulseDirection dirección del empuje
   * @param {number} baseKnockback magnitud base del empuje
   */
  takeDamage(amount, impulseDirection, baseKnockback = 6, attackerId = null) {
    if (!this.isAlive || this.isInvulnerable) {
      if (this.isAlive && this.isMistFormActive) this._spawnMistEvadePuff();
      return;
    }
    if (!this._netAllow && this.combat && this.combat.isAuthoritative === false) return;

    if (attackerId && attackerId !== this.id && attackerId !== '__tornado_release__') {
      this.lastAttackerId = attackerId;
      this.lastAttackerTimer = 6.0;
    }

    let finalAmount = amount;
    let finalKnockback = baseKnockback;
    let isCrit = false;
    let attacker = null;
    if (attackerId && this.combat && this.combat.fighters) {
      attacker = this.combat.fighters.find((f) => f && f.id === attackerId) || null;
      if (attacker && attacker.survivalMods) {
        const am = attacker.survivalMods;
        finalAmount *= (am.damageMult || 1) * (am.auraDamageMult || 1);
        finalKnockback *= (am.knockbackMult || 1) * (am.auraKnockbackMult || 1);
        if (am.critChance > 0 && Math.random() < am.critChance) {
          isCrit = true;
          finalAmount *= 1.75;
        }
        if (am.auraFireFury && attackerId !== this.id) {
          this.applyBurn(2.2, 4.5, attackerId);
        }
      }
    }

    // Defensa táctica dentro del domo de Velo de Eclipse (32% de reducción de daño)
    if (this.inEclipseVeil && finalAmount > 0) {
      finalAmount *= 0.68;
    }

    // Reducción defensiva de armadura y Aura de Tierra
    const rawIncoming = finalAmount;
    let knockbackTakenScale = 1;
    if (this.survivalMods) {
      const dm = this.survivalMods;
      finalAmount *= (dm.damageTakenMult || 1) * (dm.auraDamageTakenMult || 1);
      knockbackTakenScale = dm.auraKnockbackTakenMult ?? 1;
      if (dm.auraShieldHp > 0 && finalAmount > 0) {
        const absorbed = Math.min(dm.auraShieldHp, finalAmount);
        dm.auraShieldHp -= absorbed;
        finalAmount -= absorbed;
      }
      // Espinas Tectónicas: devuelve parte del daño bloqueado al atacante
      const blocked = Math.max(0, rawIncoming - finalAmount);
      if (dm.auraThornsRatio > 0 && blocked > 0.25 && attacker && attacker !== this && attacker.isAlive) {
        const reflected = Math.max(1, Math.round(blocked * dm.auraThornsRatio));
        attacker.hp = Math.max(0, attacker.hp - reflected);
        if (attacker.mesh && attacker.mesh.flashHit) attacker.mesh.flashHit();
        if (attacker.onDamaged) attacker.onDamaged(attacker, reflected, false, 'normal');
        if (attacker.hp <= 0 && !attacker.isDojoImmortal && attacker._defeat) {
          attacker._defeat('KO');
        }
      }
    }

    this.hp = Math.max(0, this.hp - finalAmount);
    this.mesh.flashHit();
    this.mesh.playAction('hit_react', 0.25);

    // Robo de vida (Vampirismo Espiritual) al dañar monstruos + Savia Vital (Nature Aura)
    if (attacker && attacker !== this && attacker.isAlive && finalAmount > 0) {
      if (this.isMonster && attacker.survivalMods?.lifesteal > 0) {
        const heal = finalAmount * attacker.survivalMods.lifesteal;
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
      }
      if (attacker.survivalMods?.auraNatureSap && this.isRooted) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + 4);
      }
    }

    const intensity = Math.min(1, finalAmount / 32);
    if (this.sound) this.sound.playHit(intensity);
    if (this.onDamaged) this.onDamaged(this, finalAmount, finalAmount >= 20 || isCrit, isCrit ? 'crit' : 'normal');

    // Multiplicador Pro-Bending según vida faltante y resistencia del arquetipo
    const knockbackScale = 1 + (1 - this.hp / this.maxHp) * 1.5;
    const totalKnockback = finalKnockback * knockbackScale * (this.knockbackMultiplier ?? 1) * knockbackTakenScale;

    // Interrumpe cualquier dash activo
    this.isDashing = false;
    this._dashTime = 0;
    this._hitstunTimer = Math.min(0.45, 0.16 + totalKnockback * 0.012);

    let kbVec = null;
    if (impulseDirection) {
      const horizDir = new THREE.Vector3(impulseDirection.x, 0, impulseDirection.z);
      if (horizDir.lengthSq() > 1e-5) horizDir.normalize();
      else horizDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));

      this.velocity.x = horizDir.x * totalKnockback;
      this.velocity.z = horizDir.z * totalKnockback;
      const upImpulse = Math.max(impulseDirection.y * totalKnockback * 0.55, Math.min(7.5, 2.2 + totalKnockback * 0.18));
      this.velocity.y = Math.max(this.velocity.y, upImpulse);
      this.onGround = false;
      kbVec = [
        Number(this.velocity.x.toFixed(2)),
        Number(this.velocity.y.toFixed(2)),
        Number(this.velocity.z.toFixed(2)),
      ];
    }

    if (this.hp <= 0) {
      if (this.isDojoImmortal) {
        if (this._dojoRegenTimer <= 0) this._dojoRegenTimer = 1.0;
      } else {
        this._defeat('KO');
      }
    } else if (this.isDojoImmortal && this.hp < 1 && this._dojoRegenTimer <= 0) {
      this._dojoRegenTimer = 1.0;
    }

    if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
      this.combat.onAuthoritativeCombatEvent({
        targetId: this.id,
        attackerId,
        damage: Math.round(finalAmount),
        knockback: kbVec,
        isCrit,
        status: null,
        hp: Math.round(this.hp),
        maxHp: this.maxHp,
        isAlive: this.isAlive,
      });
    }
  }

  /** Aplica evento COMBAT_EVENT recibido del Host en un cliente Guest */
  applyRemoteCombatEvent(ev) {
    if (!ev) return;
    if (typeof ev.hp === 'number') this.hp = ev.hp;
    if (typeof ev.maxHp === 'number') this.maxHp = ev.maxHp;
    if (typeof ev.isAlive === 'boolean') {
      this.isAlive = ev.isAlive;
      if (!this.isAlive && this.id !== 'player' && this.mesh && this.mesh.root) {
        this.mesh.root.visible = false;
      }
    }

    if (ev.status === 'freeze') {
      this.freezeTimer = Math.max(this.freezeTimer, 1.5);
      if (this.mesh) this.mesh.setFrozen(true);
      if (this.sound && this.sound.playIceWall) this.sound.playIceWall();
      if (this.vfx && this.vfx.spawnIceShatter) {
        this.vfx.spawnIceShatter(this.position.clone().setY(this.position.y + 0.9), 12);
      }
    } else if (ev.status === 'burn') {
      this.burnTimer = Math.max(this.burnTimer, 2.0);
      if (this.mesh && this.mesh.setBurning) this.mesh.setBurning(true);
    } else if (ev.status === 'root') {
      this.rootTimer = Math.max(this.rootTimer, 1.7);
      if (this.mesh && this.mesh.setRooted) this.mesh.setRooted(true);
    } else if (ev.status === 'poison') {
      this.poisonTimer = Math.max(this.poisonTimer, 3.5);
      if (this.mesh && this.mesh.setPoisoned) this.mesh.setPoisoned(true);
    } else if (ev.status === 'confused') {
      this.confusedTimer = Math.max(this.confusedTimer, ev.duration || 3.0);
      if (this.mesh && this.mesh.setConfused) this.mesh.setConfused(true);
      if (this.sound && this.sound.playPsychicConfuse) this.sound.playPsychicConfuse();
    } else if (ev.status === 'stun') {
      this.stunTimer = Math.max(this.stunTimer, ev.duration || 1.1);
      if (this.mesh && this.mesh.setStunned) this.mesh.setStunned(true);
      if (this.mesh && this.mesh.flash) this.mesh.flash('#fef08a');
      if (this.id === 'player' && this.onSolarBlind) {
        this.onSolarBlind(2.0);
      }
    } else if (ev.status === 'earth_orbit') {
      const cnt = Math.max(0, Math.min(2, ev.count || 1));
      this.earthRockTimers = Array(cnt).fill(EARTH_ORBIT_ROCK_DURATION);
      if (this.mesh && this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(cnt);
    } else if (ev.status === 'earth_trap') {
      this.earthRockTimers.length = 0;
      this.earthTrapTimer = Math.max(this.earthTrapTimer, ev.duration || 3.0);
      if (this.mesh && this.mesh.setEarthOrbitRocks) this.mesh.setEarthOrbitRocks(0);
      if (this.mesh && this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(true);
      if (this.sound && this.sound.playWallRaise) this.sound.playWallRaise();
      if (this.vfx && this.vfx.rockImpact) {
        this.vfx.rockImpact(this.position.clone().setY(this.position.y + 0.45), new THREE.Vector3(0, 1, 0), 1.35);
      }
    }

    const isDotTick = ev.status === 'burn_tick' || ev.status === 'poison_tick';
    if (ev.damage > 0) {
      if (this.mesh) {
        this.mesh.flashHit();
        if (!isDotTick) this.mesh.playAction('hit_react', 0.25);
      }
      if (this.sound && !isDotTick) {
        this.sound.playHit(Math.min(1, ev.damage / 32));
      }
      if (this.onDamaged) {
        const kind = ev.status === 'fall'
          ? 'fall'
          : ev.status === 'burn_tick'
            ? 'burn'
            : ev.status === 'poison_tick'
              ? 'poison'
              : ev.isCrit
                ? 'crit'
                : 'normal';
        this.onDamaged(this, ev.damage, ev.damage >= 20 || !!ev.isCrit, kind);
      }
    }

    if (Array.isArray(ev.knockback) && ev.knockback.length === 3 && this.id === 'player') {
      this.velocity.set(ev.knockback[0], Math.max(this.velocity.y, ev.knockback[1]), ev.knockback[2]);
      this.onGround = false;
      this.isDashing = false;
      this._dashTime = 0;
      this._hitstunTimer = 0.25;
    }
  }

  _defeat(reason) {
    if (!this.isAlive) return;
    this.isAlive = false;
    if (this.onDefeated) {
      this.onDefeated(this, reason);
    }
  }

  /** Actualiza temporizadores de estados alterados (hielo, enredo, confusión, quemadura y veneno) */
  stepStatusTimers(dt) {
    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      if (this.freezeTimer <= 0) {
        this.mesh.setFrozen(false);
        if (this.vfx && this.vfx.spawnIceShatter) {
          this.vfx.spawnIceShatter(this.position.clone().setY(this.position.y + 0.9), 18);
        }
        if (this.sound && this.sound.playIceSpears) {
          this.sound.playIceSpears();
        }
      }
    }

    if (this.rootTimer > 0) {
      this.rootTimer = Math.max(0, this.rootTimer - dt);
      if (this.rootTimer <= 0 && this.mesh && this.mesh.setRooted) {
        this.mesh.setRooted(false);
      }
    }

    if (this.confusedTimer > 0) {
      this.confusedTimer = Math.max(0, this.confusedTimer - dt);
      if (this.confusedTimer <= 0) {
        this._confusedAttackerId = null;
        if (this.mesh && this.mesh.setConfused) this.mesh.setConfused(false);
      }
    }

    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      if (this.stunTimer <= 0 && this.mesh && this.mesh.setStunned) {
        this.mesh.setStunned(false);
      }
    }

    if (this.earthRockTimers.length > 0) {
      const prevLen = this.earthRockTimers.length;
      for (let i = this.earthRockTimers.length - 1; i >= 0; i--) {
        this.earthRockTimers[i] -= dt;
        if (this.earthRockTimers[i] <= 0) {
          this.earthRockTimers.splice(i, 1);
        }
      }
      if (this.earthRockTimers.length !== prevLen && this.mesh && this.mesh.setEarthOrbitRocks) {
        this.mesh.setEarthOrbitRocks(this.earthRockTimers.length);
      }
    }

    if (this.earthTrapTimer > 0) {
      this.earthTrapTimer = Math.max(0, this.earthTrapTimer - dt);
      if (this.earthTrapTimer <= 0) {
        if (this.mesh && this.mesh.setEarthTrapped) this.mesh.setEarthTrapped(false);
        if (this.vfx && this.vfx.spawnDebris) {
          this.vfx.spawnDebris(this.position.clone().setY(this.position.y + 0.55), {
            count: 10,
            speed: 4.2,
            size: 0.09,
            upBias: 0.8,
            angular: true,
          });
        }
      }
    }

    if (this.shadowAmbushTimer > 0) {
      this.shadowAmbushTimer = Math.max(0, this.shadowAmbushTimer - dt);
    }
    if (this.shadowStepVeilTimer > 0) {
      this.shadowStepVeilTimer = Math.max(0, this.shadowStepVeilTimer - dt);
    }
    if (this.shadowVeilSlowTimer > 0) {
      this.shadowVeilSlowTimer = Math.max(0, this.shadowVeilSlowTimer - dt);
    }
    if (this.shadowSpeedBuffTimer > 0) {
      this.shadowSpeedBuffTimer = Math.max(0, this.shadowSpeedBuffTimer - dt);
      if (this.shadowSpeedBuffTimer <= 0) {
        this.shadowSpeedBuffStacks = 0;
      }
    }
    if (this.mesh && this.mesh.setShadowVeil) {
      this.mesh.setShadowVeil(this.isShadowVeil);
    }

    this._tickDotStatus(dt, {
      timerKey: 'burnTimer',
      dpsKey: '_burnDps',
      accumKey: '_burnTickAccum',
      fxKey: '_burnSparkTimer',
      attackerKey: '_burnAttackerId',
      kind: 'burn',
      netStatus: 'burn_tick',
      colors: ['#ff7b1c', '#ffe169'],
      onExpire: () => { if (this.mesh && this.mesh.setBurning) this.mesh.setBurning(false); },
    });
    this._tickDotStatus(dt, {
      timerKey: 'poisonTimer',
      dpsKey: '_poisonDps',
      accumKey: '_poisonTickAccum',
      fxKey: '_poisonSporeTimer',
      attackerKey: '_poisonAttackerId',
      kind: 'poison',
      netStatus: 'poison_tick',
      colors: ['#4ade80', '#a7f3d0'],
      onExpire: () => { if (this.mesh && this.mesh.setPoisoned) this.mesh.setPoisoned(false); },
    });
  }

  /**
   * Integra movimiento, salto, gravedad, colisiones y animaciones.
   * @param {number} dt
   * @param {object} moveParams
   * @param {THREE.Vector3} moveParams.wishDir vector horizontal normalizado deseado
   * @param {boolean} moveParams.wantsJump
   * @param {boolean} moveParams.wantsDash
   * @param {number} moveParams.aimYaw ángulo horizontal de referencia para encarar
   */
  stepPhysics(dt, { wishDir, wantsJump = false, wantsDash = false, aimYaw = this.yaw }) {
    const cfg = this.config;

    // --- Invulnerabilidad breve tras reaparecer (parpadeo visual) ---
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dt);
      if (this.mesh && this.mesh.root) {
        this.mesh.root.visible = this.invulnTimer <= 0 ? true : Math.floor(this.invulnTimer * 18) % 2 === 0;
      }
    }

    this.stepStatusTimers(dt);

    // --- Regeneración automática del Modo Dojo (si baja de 1 HP, restaura a 100 HP tras 1.0s) ---
    if (this.isDojoImmortal && this.isAlive) {
      if (this.hp < 1 && this._dojoRegenTimer <= 0) {
        this._dojoRegenTimer = 1.0;
      }
      if (this._dojoRegenTimer > 0) {
        this._dojoRegenTimer -= dt;
        if (this._dojoRegenTimer <= 0) {
          this._dojoRegenTimer = 0;
          this.hp = this.maxHp;
          if (this.mesh && this.mesh.flash) {
            this.mesh.flash('#8cff7a'); // Destello verde/dorado
          }
          if (this.vfx) {
            this.vfx.spawnShockwave(this.position, 2.3, 0.35, '#9bff7a');
            this.vfx.spawnDust(this.position.clone().setY(this.position.y + 0.6), {
              count: 10,
              size: 0.55,
              speed: 2.2,
              life: 0.6,
              color: '#f4cb6e',
            });
          }
        }
      }
    } else {
      this._dojoRegenTimer = 0;
    }

    const frozen = this.isFrozen;
    const rooted = this.isRooted;
    const stunned = this.isStunned;
    const trapped = this.isEarthTrapped;
    const canMove = !frozen && !rooted && !stunned && !trapped;
    const hasInput = canMove && wishDir && wishDir.lengthSq() > 0.0001;

    // --- Regeneración continua Chi (Supervivencia) ---
    if (this.isAlive && this.survivalMods && this.survivalMods.hpRegen > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.survivalMods.hpRegen * dt);
    }

    // --- Regeneración periódica de Aliado revivido en Supervivencia (+1 HP cada 2s) ---
    if (this.isAlive && this.allyRegenAmount > 0) {
      this._allyRegenTimer -= dt;
      if (this._allyRegenTimer <= 0) {
        this._allyRegenTimer += this.allyRegenInterval || 2.0;
        if (this.hp < this.maxHp) {
          this.hp = Math.min(this.maxHp, this.hp + this.allyRegenAmount);
        }
      }
    }

    // --- Temporizadores y recarga multicarga de Dash ---
    const maxDashCharges = this.getMaxDashCharges();
    if (this._dashCharges > maxDashCharges) this._dashCharges = maxDashCharges;
    if (this._dashCharges < maxDashCharges) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
      if (this.dashCooldown <= 0) {
        this._dashCharges += 1;
        if (this._dashCharges < maxDashCharges) {
          this.dashCooldown = this.getEffectiveDashCooldown();
        }
      }
    } else {
      this.dashCooldown = 0;
    }

    this._combatTurnTimer = Math.max(0, this._combatTurnTimer - dt);
    this._hitstunTimer = Math.max(0, this._hitstunTimer - dt);
    if (this.onGround) this._airJumpsUsed = 0;
    this._coyote = this.onGround ? cfg.coyoteTime : Math.max(0, this._coyote - dt);
    this._jumpBuffer = canMove && wantsJump ? cfg.jumpBuffer : Math.max(0, this._jumpBuffer - dt);

    // --- Dash ---
    if (canMove && wantsDash && this.isAlive) {
      this.triggerDash(hasInput ? wishDir : null);
    }

    if (this.isDashing) {
      this._dashTime -= dt;
      this._dashTrailTimer -= dt;
      if (this._dashTrailTimer <= 0 && this.vfx) {
        this._dashTrailTimer = 0.032;
        this.vfx.spawnDust(this.position.clone().setY(this.position.y + 0.35), {
          count: 3,
          size: 0.58,
          speed: 1.4,
          spread: 0.22,
          life: 0.45,
          alpha: 0.5,
          color: this.id !== 'player' ? '#b85a5e' : '#d6b882',
        });
      }
      const p = 1 - Math.max(0, this._dashTime) / cfg.dashDuration;
      const speed = cfg.dashSpeed * (1 - p * p * 0.6);
      this.velocity.x = this._dashDir.x * speed;
      this.velocity.z = this._dashDir.z * speed;
      this.velocity.y = 0;
      if (this._dashTime <= 0) {
        this.isDashing = false;
        this.velocity.x = this._dashDir.x * cfg.runSpeed * 1.2;
        this.velocity.z = this._dashDir.z * cfg.runSpeed * 1.2;
      }
    } else {
      // --- Movimiento horizontal (reducido durante hitstun para que el knockback desplace de verdad) ---
      let accel = this.onGround || this.isMistFormActive ? cfg.groundAccel : cfg.airAccel;
      if (this._hitstunTimer > 0) accel *= 0.18;
      if (rooted || trapped) accel = 32;
      const k = 1 - Math.exp(-accel * dt);
      const mistSpeedMult = this.isMistFormActive ? 1.55 : 1;
      const veilBuffMult = this.inEclipseVeil ? 1.25 : 1;
      const veilSlowMult = this.shadowVeilSlowTimer > 0 ? 0.7 : 1;
      const shadowStackMult =
        this.shadowSpeedBuffTimer > 0 && this.shadowSpeedBuffStacks > 0
          ? 1 + 0.3 * Math.min(2, this.shadowSpeedBuffStacks)
          : 1;
      const effSpeedMult = mistSpeedMult * veilBuffMult * veilSlowMult * shadowStackMult;
      const targetVx = hasInput && this.isAlive ? wishDir.x * cfg.runSpeed * effSpeedMult : 0;
      const targetVz = hasInput && this.isAlive ? wishDir.z * cfg.runSpeed * effSpeedMult : 0;
      this.velocity.x += (targetVx - this.velocity.x) * k;
      this.velocity.z += (targetVz - this.velocity.z) * k;

      // --- Salto (suelo/coyote o salto aéreo extra con Aura de Aire) ---
      const effectiveJumpSpeed = cfg.jumpSpeed * (this.survivalMods?.jumpMult || 1);
      if (this.isAlive && this._jumpBuffer > 0 && this._coyote > 0) {
        this.velocity.y = effectiveJumpSpeed;
        this.onGround = false;
        this._coyote = 0;
        this._jumpBuffer = 0;
        if (this.sound) this.sound.playJump();
        if (this.vfx) {
          this.vfx.spawnDust(this.position, { count: 6, size: 0.5, speed: 1.8, spread: 0.2, life: 0.5, ring: true });
        }
      } else if (this.isAlive && canMove && wantsJump && !this.onGround && this._airJumpsUsed < this.getMaxAirJumps()) {
        this.velocity.y = effectiveJumpSpeed * 0.96;
        this._airJumpsUsed += 1;
        this._jumpBuffer = 0;
        if (this.sound) this.sound.playJump();
        if (this.vfx) {
          this.vfx.spawnShockwave(this.position, 2.2, 0.28, '#c6f6ff');
          this.vfx.spawnDust(this.position, { count: 6, size: 0.55, speed: 2.2, spread: 0.35, life: 0.45, color: '#e6fbff' });
        }
      }

      // --- Gravedad / Flotación en Forma de Niebla ---
      if (this.isMistFormActive) {
        const hoverGround = this.arena.getGroundHeightAt
          ? this.arena.getGroundHeightAt(this.position.x, this.position.y, this.position.z)
          : this.arena.getGroundHeight(this.position.x, this.position.z, this.position.y);
        const hoverY = hoverGround > -5 ? hoverGround + 0.9 : Math.max(0.9, this.position.y);
        const dy = hoverY - this.position.y;
        this.velocity.y = THREE.MathUtils.clamp(dy * 9.5, -6, 9);
      } else {
        this.velocity.y = Math.max(this.velocity.y - cfg.gravity * dt, -cfg.maxFallSpeed);
      }
    }

    // --- Integración y colisiones ---
    const wasOnGround = this.onGround;
    const fallSpeedBefore = -this.velocity.y;
    const prevY = this.position.y;
    this.position.addScaledVector(this.velocity, dt);

    // Un Dash ofensivo atraviesa y rompe barriles de madera
    if (this.isDashing && this.arena.damageBarrelsInSphere) {
      this.arena.damageBarrelsInSphere(this.position, cfg.radius + 0.45, 15);
    }

    this.arena.resolveCollisions(this.position, cfg.radius, prevY, this.velocity);

    const ground = this.arena.getGroundHeightAt
      ? this.arena.getGroundHeightAt(this.position.x, prevY, this.position.z)
      : this.arena.getGroundHeight(this.position.x, this.position.z, prevY);
    if (this.isMistFormActive) {
      if (ground > -5 && this.position.y < ground + 0.35) {
        this.position.y = ground + 0.35;
      }
      this.onGround = false;
    } else if (this.position.y <= ground && this.velocity.y <= 0) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
      // Salpicaduras en canales de agua somera o charcos de Maremoto
      const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.isOnWaterSurface() && hSpeed > 1.6) {
        this._waterStepTimer = (this._waterStepTimer || 0) - dt;
        if (this._waterStepTimer <= 0) {
          this._waterStepTimer = this.isDashing ? 0.08 : 0.22;
          if (this.vfx) {
            this.vfx.spawnWaterSplash(this.position.clone().setY(0.18), this.isDashing ? 9 : 5);
            this.vfx.spawnWaterWake(this.position, this.isDashing ? 1.4 : 0.9, 0.55, this.yaw);
          }
        }
      }
      // Aterrizaje desde un salto o caída: anillo de polvo + micro-shake + sonido
      if (!wasOnGround && fallSpeedBefore > 5.5) {
        const landScale = THREE.MathUtils.clamp(fallSpeedBefore / 14, 0.5, 1.3);
        if (this.sound) this.sound.playLand(landScale);
        if (this.vfx) {
          this.vfx.spawnDust(this.position, {
            count: Math.round(8 * landScale),
            size: 0.62 * landScale,
            speed: 2.4 * landScale,
            spread: 0.25,
            life: 0.65,
            ring: true,
          });
          if (this.id === 'player' || landScale > 0.85) {
            this.vfx.addTrauma(0.09 * landScale);
          }
        }
      }
    } else {
      this.onGround = false;
    }

    // --- Regla de caída al abismo (Arena Clásica) ---
    if (this.arena.hasAbyss !== false && this.position.y < cfg.ringOutY && this.isAlive) {
      if (this.combat && this.combat.isAuthoritative === false) {
        const safePos = this.arena.getSafeRespawnPosition
          ? this.arena.getSafeRespawnPosition(this.combat.fighters || [], this.id)
          : new THREE.Vector3(0, 0.65, 0);
        this.position.copy(safePos);
        this.velocity.set(0, 0, 0);
        this.isDashing = false;
        this._dashTime = 0;
        this._hitstunTimer = 0;
        this.onGround = true;
        if (this.onLocalAbyssFall) this.onLocalAbyssFall();
        return;
      }
      if (this.isMonster) {
        // Los monstruos eliminados por Ring-Out mueren al instante y otorgan bonus de puntos
        this.hp = 0;
        this.clearStatuses();
        if (this.sound && this.sound.playAbyssPenalty) this.sound.playAbyssPenalty();
        this._defeat('RING_OUT');
        return;
      }
      this.hp = Math.max(0, this.hp - 20);
      this.clearStatuses();
      if (this.sound && this.sound.playAbyssPenalty) {
        this.sound.playAbyssPenalty();
      }
      if (this.hp <= 0 && !this.isDojoImmortal) {
        if (this.onDamaged) this.onDamaged(this, 20, true, 'fall');
        if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
          this.combat.onAuthoritativeCombatEvent({
            targetId: this.id,
            attackerId: this.lastAttackerId || null,
            damage: 20,
            knockback: null,
            isCrit: false,
            status: 'fall',
            hp: 0,
            maxHp: this.maxHp,
            isAlive: false,
          });
        }
        this._defeat('RING_OUT');
      } else {
        if (this.isDojoImmortal && this.hp < 1 && this._dojoRegenTimer <= 0) {
          this._dojoRegenTimer = 1.0;
        }
        const fighters = this.combat ? this.combat.fighters : [];
        const safePos = this.isDojoImmortal
          ? new THREE.Vector3(0, 0.65, 0)
          : this.arena.getSafeRespawnPosition
            ? this.arena.getSafeRespawnPosition(fighters, this.id)
            : new THREE.Vector3(0, 0.65, 0);
        this.position.copy(safePos);
        this.velocity.set(0, 0, 0);
        this.isDashing = false;
        this._dashTime = 0;
        this._hitstunTimer = 0;
        this.onGround = true;
        this.invulnTimer = 1.2;
        if (this.mesh) {
          this.mesh.flashHit();
          this.mesh.root.visible = true;
        }
        if (this.vfx) {
          this.vfx.spawnGroundCrater(safePos, 1.4, 1.3);
          this.vfx.spawnDust(safePos, { count: 14, size: 0.78, speed: 3.2, ring: true });
        }
        if (this.onDamaged) this.onDamaged(this, 20, true, 'fall');
        if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
          this.combat.onAuthoritativeCombatEvent({
            targetId: this.id,
            attackerId: this.lastAttackerId || null,
            damage: 20,
            knockback: null,
            isCrit: false,
            status: 'fall',
            hp: Math.round(this.hp),
            maxHp: this.maxHp,
            isAlive: this.isAlive,
          });
        }
        if (this.onAbyssRespawn) this.onAbyssRespawn(this);
      }
    }

    // --- Rotación suave del cuerpo (bloqueada si está congelado) ---
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!frozen) {
      let targetYaw = this.yaw;
      let turnRate = cfg.turnSpeed;
      if (this.isDashing) {
        targetYaw = Math.atan2(this._dashDir.x, this._dashDir.z);
      } else if (this._combatTurnTimer > 0) {
        targetYaw = this._combatTargetYaw;
        turnRate = 24;
      } else if (hasInput && horizSpeed > 0.5) {
        targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
      } else if (this.isAlive) {
        targetYaw = aimYaw;
      }
      this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-turnRate * dt));
      this.mesh.root.rotation.y = this.yaw;
    }

    // --- Estado de animación ---
    let state = 'idle';
    if (this.isDashing) state = 'dash';
    else if (!this.onGround) state = 'jump';
    else if (horizSpeed > 0.6) state = 'run';
    this.mesh.update(dt, { state, speed: horizSpeed, verticalVelocity: this.velocity.y });
  }

  /**
   * Restaura vida, velocidad y coloca al luchador en `spawnPos` mirando a `spawnYaw`.
   * @param {THREE.Vector3} [spawnPos]
   * @param {number} [spawnYaw=0]
   * @param {boolean} [withEffect=false]
   */
  resetFighter(spawnPos = new THREE.Vector3(0, 0, 0), spawnYaw = 0, withEffect = false) {
    this.hp = this.maxHp;
    this.isAlive = true;
    this.position.copy(spawnPos);
    this.velocity.set(0, 0, 0);
    this.yaw = spawnYaw;
    this.mesh.root.rotation.y = spawnYaw;
    this.isDashing = false;
    this._dashTime = 0;
    this.dashCooldown = 0;
    this._dashCharges = this.getMaxDashCharges();
    this._airJumpsUsed = 0;
    this._combatTurnTimer = 0;
    this._hitstunTimer = 0;
    this.invulnTimer = 0;
    this._dojoRegenTimer = 0;
    this.clearStatuses();
    this.onGround = true;
    this.mesh.action = null;
    if (this.mesh && this.mesh.root) this.mesh.root.visible = true;
    if (this.elementController) {
      this.elementController.reset();
    }
    if (withEffect) {
      this.mesh.flash();
      if (this.onRespawn) this.onRespawn();
    }
  }

  /** Reinicia el estado completo del luchador (vida, estados alterados y controlador) */
  reset(spawnPos, spawnYaw = this.yaw) {
    this.clearStatuses();
    if (spawnPos) {
      this.resetFighter(spawnPos, spawnYaw, false);
    } else if (this.elementController) {
      this.elementController.reset();
    }
  }

  /** Procesa ticks periódicos de Quemadura o Veneno cada 0.5s compartiendo lógica */
  _tickDotStatus(dt, cfg) {
    if (this[cfg.timerKey] <= 0) return;
    this[cfg.timerKey] = Math.max(0, this[cfg.timerKey] - dt);
    const canTick = !this.combat || this.combat.isAuthoritative !== false;
    if (this.isAlive && canTick) {
      this[cfg.accumKey] += dt;
      if (this[cfg.accumKey] >= 0.5) {
        this[cfg.accumKey] -= 0.5;
        const tickDmg = Math.max(1, Math.round(this[cfg.dpsKey] * 0.5));
        const attackerId = this[cfg.attackerKey] || null;
        if (attackerId && attackerId !== this.id) {
          this.lastAttackerId = attackerId;
          this.lastAttackerTimer = 6.0;
        }
        this.hp = Math.max(0, this.hp - tickDmg);
        if (this.onDamaged) this.onDamaged(this, tickDmg, false, cfg.kind);
        if (this.hp < 1) {
          if (this.isDojoImmortal) {
            if (this._dojoRegenTimer <= 0) this._dojoRegenTimer = 1.0;
          } else if (this.hp <= 0) {
            this._defeat('KO');
          }
        }
        if (this.combat && this.combat.isAuthoritative && this.combat.onAuthoritativeCombatEvent) {
          this.combat.onAuthoritativeCombatEvent({
            targetId: this.id,
            attackerId,
            damage: tickDmg,
            knockback: null,
            isCrit: false,
            status: cfg.netStatus,
            hp: Math.round(this.hp),
            maxHp: this.maxHp,
            isAlive: this.isAlive,
          });
        }
      }
      this[cfg.fxKey] -= dt;
      if (this[cfg.fxKey] <= 0 && this.vfx) {
        this[cfg.fxKey] = 0.1;
        this.vfx.spawnDust(this.position.clone().setY(this.position.y + 1.05), {
          count: 2,
          size: 0.34,
          speed: 1.6,
          life: 0.38,
          spread: 0.24,
          color: Math.random() > 0.45 ? cfg.colors[0] : cfg.colors[1],
          alpha: 0.85,
        });
      }
    }
    if (this[cfg.timerKey] <= 0) {
      this[cfg.dpsKey] = 0;
      this[cfg.accumKey] = 0;
      if (cfg.onExpire) cfg.onExpire();
    }
  }
}

/** Interpola ángulos por el camino más corto */
export function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
