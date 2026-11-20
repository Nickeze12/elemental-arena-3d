import * as THREE from 'three';

/**
 * EnemyAI
 * ------------------------------------------------------------
 * Máquina de estados tácticos para bots controlados por IA:
 *  - Selección dinámica de objetivo: ataca al luchador vivo más cercano
 *    (`player` u otro bot en Etapa 2 Batalla Campal).
 *  - Conciencia espacial para Arena de radio 30 (`peligro > 25.5`): prioriza
 *    volver al centro al borde, rodea pilares, muros, barriles (o los rompe
 *    si bloquean su disparo), plataformas/rampas y peligros de Fuego/Aire.
 *  - Dificultad equilibrada: pausas tácticas entre ráfagas de `1.8s` a `2.6s`,
 *    reacción defensiva moderada y `+0.95s` de recarga extra en habilidades.
 */

const _toPlayer = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _strafe = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _projRel = new THREE.Vector3();

export const DIFFICULTY_PROFILES = {
  apprentice: {
    id: 'apprentice',
    label: 'Aprendiz',
    cooldownBonus: 1.5,
    burstPauseRange: [2.4, 3.4],
    aimSpread: 1.55,
    predictionFactor: 0.1,
    defenseChance: 0.4,
    decisionInterval: 0.35,
  },
  master: {
    id: 'master',
    label: 'Maestro',
    cooldownBonus: 0.85,
    burstPauseRange: [1.6, 2.3],
    aimSpread: 0.85,
    predictionFactor: 0.45,
    defenseChance: 0.75,
    decisionInterval: 0.18,
  },
  grandmaster: {
    id: 'grandmaster',
    label: 'Gran Maestro',
    cooldownBonus: 0.25,
    burstPauseRange: [0.8, 1.3],
    aimSpread: 0.22,
    predictionFactor: 0.92,
    defenseChance: 0.95,
    decisionInterval: 0.05,
  },
};

export class EnemyAI {
  /**
   * @param {object} o
   * @param {import('../entities/EnemyFighter.js').EnemyFighter} o.enemy
   * @param {import('../entities/Player.js').Player} o.player
   * @param {import('../world/Arena.js').Arena} o.arena
   * @param {import('../combat/CombatManager.js').CombatManager} o.combat
   */
  constructor({ enemy, player, arena, combat }) {
    this.enemy = enemy;
    this.player = player;
    this.arena = arena;
    this.combat = combat;
    this.target = player;
    if (enemy) enemy.ai = this;

    this.state = 'POSITIONING';
    /** Comportamiento en Modo Dojo: 'active' | 'passive' | 'defensive' */
    this.behaviorMode = 'active';
    this.difficulty = 'master';
    this.cooldownBonus = DIFFICULTY_PROFILES.master.cooldownBonus;
    this.burstPauseRange = [...DIFFICULTY_PROFILES.master.burstPauseRange];
    this.aimSpread = DIFFICULTY_PROFILES.master.aimSpread;
    this.predictionFactor = DIFFICULTY_PROFILES.master.predictionFactor;
    this.defenseChance = DIFFICULTY_PROFILES.master.defenseChance;
    this.decisionInterval = DIFFICULTY_PROFILES.master.decisionInterval;

    this._strafeSign = Math.random() > 0.5 ? 1 : -1;
    this._strafeTimer = 1.2 + Math.random() * 1.4;
    this._attackPause = 0.55;
    this.decisionTimer = 0.4;
    this._defendCooldown = 0;

    // Sistema de ráfagas humanas con pausa según dificultad
    this._burstCount = 0;
    this._burstMax = 2 + (Math.random() > 0.5 ? 1 : 0);

    this._aimErrorOffset = new THREE.Vector3();
    this._errorTimer = 0;

    // Sistema anti-atasco y navegación por puntos de interés
    this.stuckTimer = 0;
    this._lastProgressPos = new THREE.Vector3();
    this._stuckInitialized = false;
    this._unblockTimer = 0;
    this.hasLineOfSight = true;

    this.setDifficulty('master');
  }

  /**
   * Configura los parámetros tácticos según nivel ('apprentice' | 'master' | 'grandmaster').
   * @param {'apprentice'|'master'|'grandmaster'} level
   */
  setDifficulty(level = 'master') {
    const profile = DIFFICULTY_PROFILES[level] || DIFFICULTY_PROFILES.master;
    this.difficulty = profile.id;
    this.cooldownBonus = profile.cooldownBonus;
    this.burstPauseRange = [...profile.burstPauseRange];
    this.aimSpread = profile.aimSpread;
    this.predictionFactor = profile.predictionFactor;
    this.defenseChance = profile.defenseChance;
    this.decisionInterval = profile.decisionInterval;

    if (this.enemy) {
      this.enemy.difficulty = profile.id;
      this.enemy.cooldownBonus = profile.cooldownBonus;
      if (this.enemy.elementController) {
        this.enemy.elementController.cooldownBonus = profile.cooldownBonus;
      }
    }
  }

  /**
   * Establece comportamiento para el Modo Dojo ('passive' | 'defensive' | 'active').
   * @param {'passive'|'defensive'|'active'} mode
   */
  setBehaviorMode(mode = 'active') {
    this.behaviorMode = mode === 'passive' || mode === 'defensive' ? mode : 'active';
    if (this.behaviorMode === 'passive' && this.enemy) {
      this.enemy.aiWishDir.set(0, 0, 0);
      this.enemy.aiWantsJump = false;
      this.enemy.aiWantsDash = false;
    }
  }

  reset() {
    this.state = 'POSITIONING';
    this.target = this.player;
    this._strafeSign = Math.random() > 0.5 ? 1 : -1;
    this._strafeTimer = 1.2;
    this._attackPause = 0.65;
    this.decisionTimer = 0.5;
    this._defendCooldown = 0;
    this._burstCount = 0;
    this._burstMax = 2 + (Math.random() > 0.5 ? 1 : 0);
    this.stuckTimer = 0;
    this._stuckInitialized = false;
    this._unblockTimer = 0;
    this.hasLineOfSight = true;
    this._mistHoldTimer = 0;
  }

  setArena(arena) {
    this.arena = arena;
  }

  /** Selecciona al luchador vivo enemigo más cercano (y coordina foco en 2v2 si es aliado) */
  _selectTarget() {
    const fighters = this.combat && this.combat.fighters ? this.combat.fighters : [this.player];
    const pos = this.enemy.position;
    const selfTeam = this.enemy.team || this.enemy.id;
    const isBlueAlly = selfTeam === 'team_blue' && this.enemy.id !== 'player';
    const playerFocusEnemy = isBlueAlly ? this._findPlayerFocusEnemy(fighters, selfTeam) : null;

    let best = null;
    let bestD2 = Infinity;

    for (const f of fighters) {
      if (!f || !f.isAlive || f.id === this.enemy.id) continue;
      if ((f.team || f.id) === selfTeam) continue;
      if (this.combat?.isTargetHiddenFrom && this.combat.isTargetHiddenFrom(this.enemy, f)) continue;
      const dx = f.position.x - pos.x;
      const dz = f.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      let bias = f === this.target ? 0.85 : 1.0;
      if (f.isMirage && d2 <= 18 * 18) {
        bias = 0.14;
      } else if (playerFocusEnemy && f === playerFocusEnemy && d2 < 26 * 26) {
        bias *= 0.62;
      }
      if (d2 * bias < bestD2) {
        bestD2 = d2 * bias;
        best = f;
      }
    }
    this.target = best;
    return best;
  }

  /** Detecta qué enemigo vivo está atacando o encarando el jugador (para flanqueo aliado 2v2) */
  _findPlayerFocusEnemy(fighters, selfTeam) {
    if (!this.player || !this.player.isAlive) return null;
    const p = this.player;
    const fwdX = Math.sin(p.yaw);
    const fwdZ = Math.cos(p.yaw);
    let best = null;
    let bestScore = Infinity;

    for (const f of fighters) {
      if (!f || !f.isAlive || (f.team || f.id) === selfTeam) continue;
      const dx = f.position.x - p.position.x;
      const dz = f.position.z - p.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 34) continue;
      const dot = dist > 0.01 ? (dx * fwdX + dz * fwdZ) / dist : 1;
      const recentHit = f.lastAttackerId === 'player' && (f.lastAttackerTimer || 0) > 1.0;
      const score = dist * (recentHit ? 0.45 : dot > 0.6 ? 0.72 : 1.15);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  /**
   * Evalúa el entorno y actualiza intenciones de movimiento y combate del rival.
   * @param {number} dt
   */
  update(dt) {
    const enemy = this.enemy;
    const target = this._selectTarget();

    if (!enemy.isAlive || !enemy.combatEnabled || enemy.isFrozen || enemy.isStunned || !target || !target.isAlive) {
      enemy.aiWishDir.set(0, 0, 0);
      return;
    }

    // Modo Dojo Pasivo: quieto para probar rangos, daño y estados alterados
    if (this.behaviorMode === 'passive') {
      this.state = 'PASSIVE';
      enemy.aiWishDir.set(0, 0, 0);
      enemy.aiWantsJump = false;
      enemy.aiWantsDash = false;
      return;
    }

    // --- Temporizadores tácticos ---
    this._strafeTimer -= dt;
    if (this._strafeTimer <= 0) {
      this._strafeSign = Math.random() > 0.35 ? -this._strafeSign : this._strafeSign;
      this._strafeTimer = 1.2 + Math.random() * 1.6;
    }

    this._attackPause = Math.max(0, this._attackPause - dt);
    this.decisionTimer = Math.max(0, this.decisionTimer - dt);
    this._defendCooldown = Math.max(0, this._defendCooldown - dt);
    if (enemy.isMistFormActive) {
      this._mistHoldTimer -= dt;
      if (this._mistHoldTimer <= 0 && enemy.elementController && enemy.elementController.endMistForm) {
        enemy.elementController.endMistForm();
      }
    }
    this._errorTimer -= dt;
    if (this._errorTimer <= 0) {
      this._errorTimer = 0.28 + Math.random() * 0.3;
      const spread = this.aimSpread * (enemy.isConfused ? 3.8 : 1);
      this._aimErrorOffset.set(
        (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * spread * 0.38,
        (Math.random() - 0.5) * spread * 2
      );
    }

    // --- Vectores espaciales ---
    const pos = enemy.position;
    const hasAbyss = this.arena.hasAbyss !== false;
    const arenaR = this.arena.getBoundsRadius ? this.arena.getBoundsRadius() : 30;
    const dangerR = hasAbyss ? arenaR - 4.5 : arenaR - 2.5;
    const criticalR = hasAbyss ? arenaR - 2.4 : arenaR - 1.2;
    const radiusFromCenter = hasAbyss ? Math.hypot(pos.x, pos.z) : Math.max(Math.abs(pos.x), Math.abs(pos.z));

    _toPlayer.subVectors(target.position, pos);
    _toPlayer.y = 0;
    const distToPlayer = _toPlayer.length() || 0.001;
    const dirToPlayer = _toPlayer.clone().divideScalar(distToPlayer);

    // Ángulo y punto de mira hacia el objetivo actual según predictionFactor + aimSpread
    const leadTime = Math.min(0.46, distToPlayer / 36);
    const predictedTarget = enemy.aimPoint
      .copy(target.position)
      .addScaledVector(target.velocity, leadTime * this.predictionFactor)
      .add(this._aimErrorOffset);
    predictedTarget.y = Math.max(0.7, target.position.y + 1.1);
    enemy.aimYaw = Math.atan2(predictedTarget.x - pos.x, predictedTarget.z - pos.z);

    // --- 1. Detección de amenazas entrantes según `defenseChance` (o 100% en Dojo Defensivo) ---
    if (this._defendCooldown <= 0) {
      const threat = this._detectIncomingThreat();
      if (threat) {
        const reactProb = this.behaviorMode === 'defensive' ? 1.0 : this.defenseChance;
        if (Math.random() <= reactProb) {
          this.state = 'DEFEND_OR_EVADE';
          this._defendCooldown = this.behaviorMode === 'defensive' ? 0.55 : 0.95 + Math.random() * 0.3;
          this._handleThreat(threat, radiusFromCenter, dangerR);
          return;
        }
        this._defendCooldown = 0.85;
      }
    }

    // Modo Dojo Defensivo: mantiene distancia segura y reacciona defensivamente sin atacar
    if (this.behaviorMode === 'defensive') {
      this.state = 'DEFENSIVE';
      _wish.set(0, 0, 0);
      if (radiusFromCenter > dangerR) {
        _toCenter.set(-pos.x, 0, -pos.z).normalize();
        _wish.addScaledVector(_toCenter, 1.5);
      } else {
        if (distToPlayer < 7.5) _wish.addScaledVector(dirToPlayer, -0.8);
        else if (distToPlayer > 14.0) _wish.addScaledVector(dirToPlayer, 0.5);
        _strafe.set(-dirToPlayer.z * this._strafeSign, 0, dirToPlayer.x * this._strafeSign);
        _wish.addScaledVector(_strafe, 0.75);
      }
      this._applyObstacleAvoidance(_wish);
      if (_wish.lengthSq() > 0.0001) _wish.normalize();
      enemy.aiWishDir.copy(_wish);
      return;
    }

    // --- 2. Línea de Visión y selección entre POSITIONING y ATTACK ---
    const ctrl = enemy.elementController;
    const hasLOS = this.arena.hasLineOfSight ? this.arena.hasLineOfSight(pos, target.position) : true;
    const teammateBlocking = this._isTeammateInFiringLine(distToPlayer);
    this.hasLineOfSight = hasLOS;
    const canAttack =
      hasLOS &&
      !teammateBlocking &&
      !enemy.isMistFormActive &&
      this._attackPause <= 0 &&
      this.decisionTimer <= 0 &&
      (ctrl.isReady('primary') || ctrl.isReady('secondary') || ctrl.isReady('skill1') || ctrl.isReady('skill2'));

    this.state = canAttack ? 'ATTACK' : 'POSITIONING';

    // --- 3. Cálculo de movimiento (POSITIONING + Patrulla + Flanqueo + Conciencia espacial) ---
    _wish.set(0, 0, 0);
    const elem = ctrl.element || 'earth';
    const minOpt = elem === 'water' ? 3.8 : elem === 'fire' ? 5.4 : elem === 'air' ? 8.5 : 9.5;
    const maxOpt = elem === 'water' ? 6.4 : elem === 'fire' ? 10.2 : elem === 'air' ? 14.8 : 16.0;

    if (this._unblockTimer > 0) this._unblockTimer = Math.max(0, this._unblockTimer - dt);

    // Si está cerca del borde peligroso, prioriza volver hacia el interior
    if (radiusFromCenter > dangerR) {
      _toCenter.set(-pos.x, 0, -pos.z).normalize();
      const urgency = THREE.MathUtils.clamp((radiusFromCenter - dangerR) / 3.5, 0.7, 1.0);
      _wish.addScaledVector(_toCenter, urgency * 1.7);
      if (hasAbyss && radiusFromCenter > criticalR && enemy.dashCooldown <= 0) {
        enemy.triggerDash(_toCenter);
      }
    } else if (distToPlayer > 38 && this.arena.getPatrolPoints) {
      // Navegación por puntos de interés cuando no hay rivales cercanos
      const waypoint = this._pickPatrolWaypoint(pos, target.position);
      const wpDx = waypoint.x - pos.x;
      const wpDz = waypoint.z - pos.z;
      const wpDist = Math.hypot(wpDx, wpDz) || 1;
      _wish.set(wpDx / wpDist, 0, wpDz / wpDist);
    } else if (!hasLOS || teammateBlocking) {
      // Sin línea de visión directa o con un compañero delante: flanquea lateralmente alrededor del obstáculo/aliado
      _strafe.set(-dirToPlayer.z * this._strafeSign, 0, dirToPlayer.x * this._strafeSign);
      _wish.addScaledVector(dirToPlayer, teammateBlocking ? 0.25 : 0.55);
      _wish.addScaledVector(_strafe, 1.35);
    } else {
      if (distToPlayer < minOpt) {
        _wish.addScaledVector(dirToPlayer, -0.95);
      } else if (distToPlayer > maxOpt) {
        _wish.addScaledVector(dirToPlayer, 0.95);
      } else if (distToPlayer > (minOpt + maxOpt) * 0.55) {
        _wish.addScaledVector(dirToPlayer, 0.25);
      } else if (distToPlayer < (minOpt + maxOpt) * 0.45) {
        _wish.addScaledVector(dirToPlayer, -0.25);
      }

      _strafe.set(-dirToPlayer.z * this._strafeSign, 0, dirToPlayer.x * this._strafeSign);
      if (radiusFromCenter > dangerR - 3.0) {
        const nextR = hasAbyss
          ? Math.hypot(pos.x + _strafe.x * 2, pos.z + _strafe.z * 2)
          : Math.max(Math.abs(pos.x + _strafe.x * 2), Math.abs(pos.z + _strafe.z * 2));
        if (nextR > radiusFromCenter) {
          this._strafeSign *= -1;
          _strafe.negate();
        }
      }
      _wish.addScaledVector(_strafe, this._unblockTimer > 0 ? 1.45 : 0.85);
    }

    // Esquiva de pilares, muros, barriles, plataformas elevadas y peligros activos
    this._applyObstacleAvoidance(_wish);

    // --- Sistema Anti-Atasco (`stuckTimer`): si avanza > 0.8s con < 0.4 u de progreso, flanquea o salta/dashea ---
    if (!this._stuckInitialized) {
      this._lastProgressPos.copy(pos);
      this._stuckInitialized = true;
      this.stuckTimer = 0;
    } else if (_wish.lengthSq() > 0.08 && !enemy.isFrozen) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= 0.8) {
        const moved = Math.hypot(pos.x - this._lastProgressPos.x, pos.z - this._lastProgressPos.z);
        this.stuckTimer = 0;
        this._lastProgressPos.copy(pos);
        if (moved < 0.4) {
          this._strafeSign *= -1;
          this._unblockTimer = 0.7;
          _strafe.set(-dirToPlayer.z * this._strafeSign, 0, dirToPlayer.x * this._strafeSign);
          _wish.copy(_strafe);
          if (enemy.dashCooldown <= 0 && !hasLOS) {
            enemy.triggerDash(_strafe);
          } else {
            enemy.aiWantsJump = true;
          }
        }
      }
    } else {
      this.stuckTimer = 0;
      this._lastProgressPos.copy(pos);
    }

    if (_wish.lengthSq() > 0.0001) _wish.normalize();
    if (enemy.isConfused) _wish.negate();
    enemy.aiWishDir.copy(_wish);

    // --- 4. Ejecución de ataques (solo con línea de visión directa hacia el rival) ---
    if (this.state === 'ATTACK' && hasLOS && (!hasAbyss || radiusFromCenter < dangerR + 1.5)) {
      this._executeAttackDecision(distToPlayer, target);
    }
  }

  /** Elige el punto de interés que acerque al bot al centro o hacia su objetivo lejano */
  _pickPatrolWaypoint(pos, targetPos) {
    const pts = this.arena.getPatrolPoints();
    if (!pts || pts.length === 0) return targetPos;

    let best = targetPos;
    let bestScore = Infinity;
    const distSelfToTarget = Math.hypot(targetPos.x - pos.x, targetPos.z - pos.z);

    for (const wp of pts) {
      const dToSelf = Math.hypot(wp.x - pos.x, wp.z - pos.z);
      if (dToSelf < 3.2) continue;
      const dToTarget = Math.hypot(wp.x - targetPos.x, wp.z - targetPos.z);
      // Solo considera nodos que acerquen al bot hacia el objetivo o al centro
      if (dToTarget > distSelfToTarget + 6) continue;
      const score = dToSelf * 0.45 + dToTarget;
      if (score < bestScore) {
        bestScore = score;
        best = wp;
      }
    }
    return best;
  }

  /** Busca proyectiles enemigos cercanos (< 6.4u) que vuelen hacia el bot */
  _detectIncomingThreat() {
    const pos = this.enemy.position;
    for (const p of this.combat.projectiles) {
      if (!p.alive || this.combat.isSameTeamIds(this.enemy.id, p.ownerId)) continue;
      _projRel.subVectors(pos, p.position);
      _projRel.y = 0;
      const dist = _projRel.length();
      if (dist > 6.4 || dist < 0.25) continue;

      const vel2D = new THREE.Vector3(p.velocity.x, 0, p.velocity.z);
      if (vel2D.lengthSq() < 0.01) continue;
      vel2D.normalize();

      const toEnemyDir = _projRel.clone().divideScalar(dist);
      if (vel2D.dot(toEnemyDir) > 0.78) {
        return {
          position: p.position,
          direction: vel2D,
          distance: dist,
        };
      }
    }
    return null;
  }

  _handleThreat(threat, radiusFromCenter, dangerR = 25.5) {
    const enemy = this.enemy;
    const ctrl = enemy.elementController;

    const toThreatYaw = Math.atan2(
      threat.position.x - enemy.position.x,
      threat.position.z - enemy.position.z
    );

    if (
      ctrl.element === 'storm' &&
      !enemy.isMistFormActive &&
      ctrl.isReady('secondary') &&
      radiusFromCenter < dangerR + 1.0
    ) {
      ctrl.trySecondary();
      this._mistHoldTimer = 1.4 + Math.random() * 1.0;
      this._attackPause = 0.45;
      return;
    }

    if (
      ctrl.element !== 'fire' &&
      ctrl.element !== 'air' &&
      ctrl.element !== 'storm' &&
      ctrl.element !== 'light' &&
      ctrl.element !== 'shadow' &&
      ctrl.isReady('secondary') &&
      threat.distance > 2.2 &&
      radiusFromCenter < dangerR + 1.0
    ) {
      enemy.aimYaw = toThreatYaw;
      ctrl.trySecondary(toThreatYaw);
      this._attackPause = 0.55;
      return;
    }

    const perpA = new THREE.Vector3(-threat.direction.z, 0, threat.direction.x);
    const perpB = new THREE.Vector3(threat.direction.z, 0, -threat.direction.x);
    const pos = enemy.position;
    const rA = Math.hypot(pos.x + perpA.x * 4, pos.z + perpA.z * 4);
    const rB = Math.hypot(pos.x + perpB.x * 4, pos.z + perpB.z * 4);
    const evadeDir = rA <= rB ? perpA : perpB;

    enemy.aiWishDir.copy(evadeDir);
    if (enemy.dashCooldown <= 0 && Math.random() > 0.25) {
      enemy.triggerDash(evadeDir);
    }
  }

  _executeAttackDecision(distToPlayer, target) {
    const enemy = this.enemy;
    const ctrl = enemy.elementController;
    const elem = ctrl.element || 'earth';
    const hasAbyss = this.arena.hasAbyss !== false;
    const arenaR = this.arena.getBoundsRadius ? this.arena.getBoundsRadius() : 30;

    // Si un barril bloquea justo la línea frontal, lo rompe con ataque básico
    if (this._isBarrelBlockingFront(4.2) && ctrl.isReady('primary')) {
      ctrl.tryPrimary(enemy.aimPoint);
      this.decisionTimer = 0.55;
      this._attackPause = 0.55;
      return;
    }

    const clearLine = !this._isBlockedInFront(3.8);
    const targetEdgeDist = Math.hypot(target.position.x, target.position.z);

    const s2Min = elem === 'fire' ? 6.0 : elem === 'water' ? 4.2 : elem === 'air' ? 5.5 : elem === 'nature' ? 4.5 : elem === 'psychic' ? 5.0 : elem === 'storm' ? 5.0 : elem === 'light' ? 4.5 : elem === 'shadow' ? 0.0 : 8.5;
    const s2Max = elem === 'fire' ? 17.5 : elem === 'water' ? 16.0 : elem === 'air' ? 16.5 : elem === 'nature' ? 20.0 : elem === 'psychic' ? 20.0 : elem === 'storm' ? 20.0 : elem === 'light' ? 18.0 : elem === 'shadow' ? 11.5 : 25.0;
    const s1Max = elem === 'fire' ? 9.0 : elem === 'water' ? 23.0 : elem === 'air' ? 13.0 : elem === 'nature' ? 20.0 : elem === 'psychic' ? 4.8 : elem === 'storm' ? 23.0 : elem === 'light' ? 4.6 : elem === 'shadow' ? 18.0 : 13.5;
    const primaryMax = elem === 'water' ? 6.5 : elem === 'fire' ? 11.4 : 29.0;
    const [pauseMin, pauseMax] = this.burstPauseRange;
    const nextBurstPause = () => pauseMin + Math.random() * Math.max(0.05, pauseMax - pauseMin);
    const isGrandmaster = this.difficulty === 'grandmaster';

    // Gran Maestro: encadenamiento de combos letales y presión hacia bordes
    if (isGrandmaster) {
      // Agua: congelar con Q y encadenar inmediatamente Maremoto (E)
      if (elem === 'water' && target.isFrozen && ctrl.isReady('skill2') && distToPlayer <= s2Max && clearLine) {
        ctrl.trySkill2(enemy.aimPoint);
        this._attackPause = this.decisionInterval;
        this.decisionTimer = this.decisionInterval;
        return;
      }
      if (elem === 'water' && !target.isFrozen && ctrl.isReady('skill1') && distToPlayer <= s1Max && clearLine) {
        ctrl.trySkill1(enemy.aimPoint);
        this._attackPause = 0.25;
        this.decisionTimer = 0.25;
        return;
      }
      // Naturaleza: enredar con Q y castigar con Tormenta de Esporas (E) sobre objetivo inmovilizado
      if (elem === 'nature' && target.isRooted && ctrl.isReady('skill2') && distToPlayer <= s2Max && clearLine) {
        ctrl.trySkill2(enemy.aimPoint);
        this._attackPause = this.decisionInterval;
        this.decisionTimer = this.decisionInterval;
        return;
      }
      if (elem === 'nature' && !target.isRooted && ctrl.isReady('skill1') && distToPlayer <= s1Max && clearLine) {
        ctrl.trySkill1(enemy.aimPoint);
        this._attackPause = 0.25;
        this.decisionTimer = 0.25;
        return;
      }
      // Empuje agresivo hacia bordes si la arena tiene abismo y el rival está cerca del límite
      if (hasAbyss && targetEdgeDist > arenaR - 9.0 && clearLine) {
        if (ctrl.isReady('skill1') && enemy.onGround && distToPlayer <= s1Max) {
          ctrl.trySkill1(enemy.aimPoint);
          this._attackPause = 0.35;
          this.decisionTimer = 0.35;
          return;
        }
        if (ctrl.isReady('skill2') && distToPlayer <= s2Max) {
          ctrl.trySkill2(enemy.aimPoint);
          this._attackPause = 0.4;
          this.decisionTimer = 0.4;
          return;
        }
      }
    }

    // 0a. Fuego: encadena su combo de 3 pasos con pausa según dificultad al terminarlo
    if (elem === 'fire' && ctrl.comboStep > 0 && ctrl.isReady('primary') && distToPlayer <= primaryMax) {
      ctrl.tryPrimary(enemy.aimPoint);
      if (ctrl.comboStep === 0) {
        this._burstCount = 0;
        this.decisionTimer = nextBurstPause();
        this._attackPause = this.decisionTimer;
        this._strafeSign *= -1;
      } else {
        const stepDelay = isGrandmaster ? 0.08 : 0.16;
        this.decisionTimer = stepDelay;
        this._attackPause = stepDelay;
      }
      return;
    }

    // 0b. Agua: Gotas Orbitales a corta/media distancia
    if (elem === 'water' && ctrl.isReady('secondary') && distToPlayer <= 6.2) {
      ctrl.trySecondary();
      this._attackPause = isGrandmaster ? 0.2 : 0.45;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0c. Fuego: Muro Bajo de Fuego entre el bot y el objetivo
    if (elem === 'fire' && ctrl.isReady('secondary') && distToPlayer >= 4.2 && distToPlayer <= 9.5 && clearLine) {
      ctrl.trySecondary(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.2 : 0.45;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0d. Aire: prioriza Ráfaga Concussiva (Q) si el objetivo está cerca del borde (o en corta/media distancia en Santuario)
    if (elem === 'air' && ctrl.isReady('skill1') && ((!hasAbyss && distToPlayer <= 10.5) || targetEdgeDist > arenaR - 8.0) && distToPlayer <= 13.0 && clearLine) {
      ctrl.trySkill1(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.35 : 0.75;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0e. Aire: Vórtice Zigzag (Click Der) a media distancia
    if (elem === 'air' && ctrl.isReady('secondary') && distToPlayer >= 4.5 && distToPlayer <= 16.5 && clearLine) {
      ctrl.trySecondary(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.22 : 0.45;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0f. Naturaleza: invoca Brote Escupesemillas en un flanco cercano al rival para fuego cruzado
    if (elem === 'nature' && ctrl.isReady('secondary') && distToPlayer <= 16.5 && clearLine) {
      const toTgtX = target.position.x - enemy.position.x;
      const toTgtZ = target.position.z - enemy.position.z;
      const len = Math.hypot(toTgtX, toTgtZ) || 1;
      const perpX = (-toTgtZ / len) * (this._strafeSign || 1);
      const perpZ = (toTgtX / len) * (this._strafeSign || 1);
      const flankPoint = new THREE.Vector3(
        target.position.x + perpX * 4.2,
        target.position.y,
        target.position.z + perpZ * 4.2
      );
      ctrl.trySecondary(flankPoint);
      this._attackPause = isGrandmaster ? 0.24 : 0.48;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0g. Psíquico: Onda Telequinética para repeler rival cercano / proyectiles o Pulso de Confusión a media distancia
    if (elem === 'psychic' && ctrl.isReady('skill1') && (distToPlayer <= 4.6 || this._detectIncomingThreat())) {
      ctrl.trySkill1();
      this._attackPause = isGrandmaster ? 0.28 : 0.55;
      this.decisionTimer = this._attackPause;
      return;
    }
    if (elem === 'psychic' && ctrl.isReady('secondary') && !target.isConfused && distToPlayer <= 21.0 && clearLine) {
      ctrl.trySecondary(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.25 : 0.5;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0h. Tormenta: usa Forma de Niebla tácticamente si está herido a rango cercano y despliega Nube de Trueno + Relámpago Encadenado
    if (elem === 'storm' && ctrl.isReady('secondary') && !enemy.isMistFormActive && enemy.hp < enemy.maxHp * 0.48 && distToPlayer < 8.5) {
      ctrl.trySecondary();
      this._mistHoldTimer = 1.45 + Math.random() * 0.85;
      this._attackPause = 0.4;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0i. Luz: Destello Solar si el rival se acerca demasiado, Espejismo para distraer y Prisma Refractario
    if (elem === 'light' && ctrl.isReady('skill1') && distToPlayer <= 4.5) {
      ctrl.trySkill1();
      this._attackPause = isGrandmaster ? 0.3 : 0.6;
      this.decisionTimer = this._attackPause;
      return;
    }
    if (elem === 'light' && ctrl.isReady('secondary') && distToPlayer <= 16.5 && (distToPlayer < 9.0 || Math.random() < 0.45)) {
      ctrl.trySecondary();
      this._attackPause = isGrandmaster ? 0.25 : 0.5;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 0j. Sombra: Paso Sombrío tras el objetivo + remate de Emboscada con Lanza Umbría, Zarcillos al perder vida y Velo de Eclipse en combate cercano
    if (elem === 'shadow' && (enemy.shadowAmbushTimer || 0) > 0 && ctrl.isReady('primary') && distToPlayer <= 16.0) {
      ctrl.tryPrimary(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.16 : 0.35;
      this.decisionTimer = this._attackPause;
      return;
    }
    if (elem === 'shadow' && ctrl.isReady('secondary') && distToPlayer >= 3.2 && distToPlayer <= 15.5) {
      ctrl.trySecondary(target.position.clone().setY(target.position.y + 1.0));
      this._attackPause = isGrandmaster ? 0.08 : 0.22;
      this.decisionTimer = this._attackPause;
      return;
    }
    if (elem === 'shadow' && ctrl.isReady('skill1') && distToPlayer <= 17.5 && (enemy.hp < enemy.maxHp * 0.85 || distToPlayer > 5.0)) {
      ctrl.trySkill1(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.28 : 0.55;
      this.decisionTimer = this._attackPause;
      return;
    }
    if (elem === 'shadow' && ctrl.isReady('skill2') && distToPlayer <= 7.5 && !enemy.inEclipseVeil) {
      ctrl.trySkill2(enemy.position.clone().lerp(target.position, 0.35));
      this._attackPause = isGrandmaster ? 0.3 : 0.6;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 1. Habilidad E
    if (ctrl.isReady('skill2') && distToPlayer >= s2Min && distToPlayer <= s2Max && clearLine) {
      ctrl.trySkill2(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.45 : 0.95;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 2. Habilidad Q
    if (ctrl.isReady('skill1') && enemy.onGround && distToPlayer <= s1Max && clearLine) {
      ctrl.trySkill1(enemy.aimPoint);
      this._attackPause = isGrandmaster ? 0.38 : 0.85;
      this.decisionTimer = this._attackPause;
      return;
    }

    // 3. Ataque Básico en ráfagas con pausa controlada por perfil de dificultad
    if (ctrl.isReady('primary') && distToPlayer <= primaryMax) {
      let aimForPrimary = enemy.aimPoint;
      if (elem === 'light' && this.combat?.lightPrisms?.length) {
        const prism = this.combat.lightPrisms.find(
          (pr) =>
            pr.alive &&
            pr.refractCd <= 0 &&
            (pr.ownerId === enemy.id || pr.team === (enemy.team || enemy.id)) &&
            pr.center.distanceTo(target.position) <= 15.5
        );
        if (prism) {
          aimForPrimary = prism.center.clone();
          enemy.aimYaw = Math.atan2(prism.center.x - enemy.position.x, prism.center.z - enemy.position.z);
        }
      }
      ctrl.tryPrimary(aimForPrimary);
      if (elem === 'fire') {
        if (ctrl.comboStep === 0) {
          this._burstCount = 0;
          this.decisionTimer = nextBurstPause();
          this._attackPause = this.decisionTimer;
          this._strafeSign *= -1;
        } else {
          const stepDelay = isGrandmaster ? 0.08 : 0.16;
          this.decisionTimer = stepDelay;
          this._attackPause = stepDelay;
        }
        return;
      }

      this._burstCount++;
      if (this._burstCount >= this._burstMax) {
        this._burstCount = 0;
        this._burstMax = isGrandmaster ? 3 : 2 + (Math.random() > 0.5 ? 1 : 0);
        this.decisionTimer = nextBurstPause();
        this._attackPause = this.decisionTimer;
        this._strafeSign *= -1;
      } else {
        this.decisionTimer = this.decisionInterval + Math.random() * 0.15;
        this._attackPause = this.decisionTimer;
      }
    }
  }

  _isBarrelBlockingFront(checkDist = 4.2) {
    if (!this.arena.barrels) return false;
    const pos = this.enemy.position;
    const fx = Math.sin(this.enemy.aimYaw);
    const fz = Math.cos(this.enemy.aimYaw);
    for (const b of this.arena.barrels) {
      if (!b.alive) continue;
      const dx = b.position.x - pos.x;
      const dz = b.position.z - pos.z;
      const proj = dx * fx + dz * fz;
      if (proj > 0.4 && proj < checkDist) {
        const perp = Math.abs(-dx * fz + dz * fx);
        if (perp <= b.radius + 0.55) return true;
      }
    }
    return false;
  }

  /** Evita disparar contra la espalda de un aliado si está justo en la línea de tiro */
  _isTeammateInFiringLine(distToTarget) {
    if (!this.combat || !this.combat.fighters) return false;
    const pos = this.enemy.position;
    const fx = Math.sin(this.enemy.aimYaw);
    const fz = Math.cos(this.enemy.aimYaw);
    const selfTeam = this.enemy.team || this.enemy.id;
    for (const f of this.combat.fighters) {
      if (!f || !f.isAlive || f.id === this.enemy.id) continue;
      if ((f.team || f.id) !== selfTeam) continue;
      const dx = f.position.x - pos.x;
      const dz = f.position.z - pos.z;
      const proj = dx * fx + dz * fz;
      if (proj > 0.3 && proj < Math.min(distToTarget, 8.5)) {
        const perp = Math.abs(-dx * fz + dz * fx);
        if (perp <= 0.85) return true;
      }
    }
    return false;
  }

  _isBlockedInFront(checkDist = 3.5) {
    const pos = this.enemy.position;
    const fx = Math.sin(this.enemy.aimYaw);
    const fz = Math.cos(this.enemy.aimYaw);
    const tx = pos.x + fx * checkDist;
    const tz = pos.z + fz * checkDist;
    if (this.arena.getPillarAt(tx, tz, 0.8)) return true;
    for (const w of this.combat.getActiveWalls()) {
      if (w.containsPoint2D(tx, tz, 0.5)) return true;
    }
    return false;
  }

  _applyObstacleAvoidance(wish) {
    const pos = this.enemy.position;
    // Evita los 4 pilares
    for (const p of this.arena.pillars) {
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const safeRadius = p.radius + 2.1;
      if (d < safeRadius && d > 1e-4) {
        const weight = (safeRadius - d) / safeRadius;
        wish.x += (dx / d) * weight * 1.8;
        wish.z += (dz / d) * weight * 1.8;
      }
    }
    // Rodea barriles destructibles intactos
    if (this.arena.barrels) {
      for (const b of this.arena.barrels) {
        if (!b.alive) continue;
        const dx = pos.x - b.position.x;
        const dz = pos.z - b.position.z;
        const d = Math.hypot(dx, dz);
        const safeRadius = b.radius + 1.45;
        if (d < safeRadius && d > 1e-4) {
          const weight = (safeRadius - d) / safeRadius;
          wish.x += (dx / d) * weight * 1.4;
          wish.z += (dz / d) * weight * 1.4;
        }
      }
    }
    // Navega alrededor de los bordes verticales de plataformas laterales / edificios
    if (this.arena.platforms) {
      for (const pl of this.arena.platforms) {
        if (pos.y >= pl.height - 0.35) continue;
        const lx = pos.x - pl.cx;
        const lz = pos.z - (pl.cz || 0);
        const az = Math.abs(lz);
        // Si está frente a los costados largos (fuera de rampas), empuja hacia afuera para rodear sin atascarse
        if (Math.abs(lx) <= pl.halfX + 1.35 && az <= pl.halfZ + 1.1) {
          const outX = lx >= 0 ? 1 : -1;
          const outZ = lz >= 0 ? 1 : -1;
          wish.x += outX * 1.35;
          wish.z += outZ * 0.95;
        }
      }
    }
    // Evita cajas sólidas extra en Santuario (murallas / muros de cobertura)
    if (this.arena.boxColliders) {
      for (const box of this.arena.boxColliders) {
        if (!box.blocksProjectile || pos.y >= box.maxY - 0.35) continue;
        const pad = 1.65;
        if (pos.x >= box.minX - pad && pos.x <= box.maxX + pad && pos.z >= box.minZ - pad && pos.z <= box.maxZ + pad) {
          const cx = (box.minX + box.maxX) * 0.5;
          const cz = (box.minZ + box.maxZ) * 0.5;
          const dx = pos.x - cx;
          const dz = pos.z - cz;
          const len = Math.hypot(dx, dz) || 1;
          wish.x += (dx / len) * 1.45;
          wish.z += (dz / len) * 1.45;
        }
      }
    }
    // Evita muros activos
    for (const w of this.combat.getActiveWalls()) {
      const dx = pos.x - w.position.x;
      const dz = pos.z - w.position.z;
      const d = Math.hypot(dx, dz);
      const safeRadius = 2.8;
      if (d < safeRadius && d > 1e-4) {
        const weight = (safeRadius - d) / safeRadius;
        wish.x += (dx / d) * weight * 1.5;
        wish.z += (dz / d) * weight * 1.5;
      }
    }
    // Evita Muros de Fuego enemigos activos
    if (this.combat.getActiveFireWalls) {
      for (const fw of this.combat.getActiveFireWalls()) {
        if (this.combat.isSameTeamIds(this.enemy.id, fw.ownerId)) continue;
        const dx = pos.x - fw.position.x;
        const dz = pos.z - fw.position.z;
        const d = Math.hypot(dx, dz);
        const safeRadius = (fw.halfWidth || 2.2) + 1.25;
        if (d < safeRadius && d > 1e-4) {
          const weight = (safeRadius - d) / safeRadius;
          wish.x += (dx / d) * weight * 1.9;
          wish.z += (dz / d) * weight * 1.9;
        }
      }
    }
    // Separación suave entre aliados para no empujarse en 2v2
    if (this.combat && this.combat.fighters) {
      const selfTeam = this.enemy.team || this.enemy.id;
      for (const f of this.combat.fighters) {
        if (!f || !f.isAlive || f.id === this.enemy.id) continue;
        if ((f.team || f.id) !== selfTeam) continue;
        const dx = pos.x - f.position.x;
        const dz = pos.z - f.position.z;
        const d = Math.hypot(dx, dz);
        const safeRadius = 2.6;
        if (d < safeRadius && d > 1e-4) {
          const weight = (safeRadius - d) / safeRadius;
          wish.x += (dx / d) * weight * 1.65;
          wish.z += (dz / d) * weight * 1.65;
        }
      }
    }
    // Rodea Tornados Errantes enemigos activos
    if (this.combat.getActiveTornadoes) {
      for (const t of this.combat.getActiveTornadoes()) {
        if (this.combat.isSameTeamIds(this.enemy.id, t.ownerId)) continue;
        const dx = pos.x - t.position.x;
        const dz = pos.z - t.position.z;
        const d = Math.hypot(dx, dz);
        const safeRadius = (t.radius || 1.85) + 2.4;
        if (d < safeRadius && d > 1e-4) {
          const weight = (safeRadius - d) / safeRadius;
          wish.x += (dx / d) * weight * 2.1;
          wish.z += (dz / d) * weight * 2.1;
        }
      }
    }
  }
}
