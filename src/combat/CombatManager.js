import * as THREE from 'three';
import { createElementController } from './ElementFactory.js';

/**
 * CombatManager
 * ------------------------------------------------------------
 * Orquestador del combate:
 *  - Mantiene los luchadores registrados y sus controladores elementales.
 *  - Actualiza proyectiles (con sub-pasos y colisiones contra luchadores
 *    oponentes, muros, pilares y suelo), muros temporales, peligros (hazards)
 *    y partículas.
 *  - Expone `getActiveHitboxes()` y `getActiveWalls()` y permite limpiar
 *    toda la arena con `clearAll()` al reiniciar un duelo.
 */

const MAX_WALLS = 4;
const _step = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hitDir = new THREE.Vector3();

export class CombatManager {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {Arena} o.arena
   * @param {import('../entities/Player.js').Player} o.player
   * @param {import('../core/ThirdPersonCamera.js').ThirdPersonCamera} o.camera
   * @param {import('./VFXManager.js').VFXManager} o.vfx
   */
  constructor({ scene, arena, player, camera, vfx, sound = null }) {
    this.scene = scene;
    this.arena = arena;
    this.player = player;
    this.camera = camera;
    this.vfx = vfx;
    this.sound = sound;
    if (arena && arena.setEffects) arena.setEffects(vfx, sound);
    if (vfx && vfx.setArena) vfx.setArena(arena);

    /** Callback opcional para congelar brevemente el impacto (hitstop): `(duration:number) => void` */
    this.onHitstop = null;
    /** Callback opcional cuando un luchador recibe daño: `(fighter, damage, point) => void` */
    this.onFighterHit = null;

    /** Luchadores registrados en el duelo */
    this.fighters = [];
    /** Controladores elementales activos */
    this.controllers = [];

    /** @type {import('./Projectile.js').Projectile[]} */
    this.projectiles = [];
    /** @type {import('./EarthWall.js').EarthWall[]} */
    this.walls = [];
    /** Muros bajos de fuego activos (trampas zonales, no bloquean proyectiles) */
    this.fireWalls = [];
    /** Peligros temporales (p. ej. pinchos sísmicos) */
    this.hazards = [];
    /** Plantas torreta destructibles activas (Brote Escupesemillas de Naturaleza) */
    this.turrets = [];
    /** Prismas refractarios activos del Maestro de Luz */
    this.lightPrisms = [];
    /** Zonas activas de Velo de Eclipse (Maestro Sombra) */
    this.eclipseZones = [];
    /** Charcos de agua temporales dejados por Maremoto (Maestro Agua, 3.0s) */
    this.waterPuddles = [];

    /** Callback opcional al usar una habilidad el jugador: (id) => void */
    this.onAbilityUsed = null;

    /** Modo Dojo: elimina cooldowns del jugador en cada frame */
    this.instantPlayerCooldowns = false;
    /** Autoridad de combate (Host/Offline = true; Guest = false sólo visual) */
    this.isAuthoritative = true;
    /** Callback al lanzar habilidad localmente en modo Online */
    this.onLocalAbilityCast = null;
    /** Callback al producirse daño/estado autoritativo para replicar COMBAT_EVENT */
    this.onAuthoritativeCombatEvent = null;

    /** Controlador elemental del jugador */
    this.controller = createElementController('earth', this, player);
    player.element = 'earth';
    player.elementController = this.controller;
    this.registerFighter(player, this.controller);

    this._hitboxes = [];
    this._wallMeshes = [];
    this._aimTargetCache = [];
  }

  /**
   * Registra un luchador y opcionalmente su controlador elemental.
   * @param {import('../entities/BaseFighter.js').BaseFighter} fighter
   * @param {object} [controller]
   */
  registerFighter(fighter, controller = null) {
    if (!this.fighters.includes(fighter)) {
      this.fighters.push(fighter);
    }
    if (this.vfx && !fighter.vfx) fighter.vfx = this.vfx;
    if (this.sound && !fighter.sound) fighter.sound = this.sound;
    if (controller && !this.controllers.includes(controller)) {
      this.controllers.push(controller);
    }
  }

  /**
   * Desregistra un luchador y su controlador elemental (p. ej. al volver de Etapa 2 a Etapa 1).
   * @param {import('../entities/BaseFighter.js').BaseFighter} fighter
   */
  removeFighter(fighter) {
    if (!fighter) return;
    const fIdx = this.fighters.indexOf(fighter);
    if (fIdx >= 0) this.fighters.splice(fIdx, 1);
    if (fighter.elementController) {
      fighter.elementController.reset();
      const cIdx = this.controllers.indexOf(fighter.elementController);
      if (cIdx >= 0) this.controllers.splice(cIdx, 1);
    }
  }

  /**
   * Asigna o cambia el elemento de un luchador ('earth' | 'fire' | 'water' | 'air'),
   * actualizando su controlador elemental y la paleta Cel-Shaded de su malla.
   * @param {import('../entities/BaseFighter.js').BaseFighter} fighter
   * @param {'earth'|'fire'|'water'|'air'} element
   */
  setFighterElement(fighter, element) {
    const prevCtrl = fighter.elementController;
    const aimProvider = prevCtrl ? prevCtrl.aimProvider : null;
    const cooldownBonus =
      fighter.id === 'player'
        ? 0
        : fighter.cooldownBonus !== undefined
          ? fighter.cooldownBonus
          : prevCtrl
            ? prevCtrl.cooldownBonus
            : 0.85;

    if (prevCtrl) {
      prevCtrl.reset();
      const idx = this.controllers.indexOf(prevCtrl);
      if (idx >= 0) this.controllers.splice(idx, 1);
    }

    const newCtrl = createElementController(element, this, fighter, aimProvider, cooldownBonus);
    fighter.element = element;
    fighter.elementController = newCtrl;
    this.controllers.push(newCtrl);

    if (fighter.id === 'player' || fighter.team === 'team_blue') {
      if (fighter.id === 'player') this.controller = newCtrl;
      if (fighter.mesh && fighter.mesh.setTheme) {
        fighter.mesh.setTheme(element);
      }
    } else if (fighter.mesh && fighter.mesh.setTheme) {
      fighter.mesh.setTheme(`${element}_rival`);
    }

    return newCtrl;
  }

  /** Devuelve el equipo de un luchador por ID */
  getFighterTeam(fighterId) {
    if (!fighterId) return null;
    const f = this.fighters.find((item) => item && item.id === fighterId);
    return f ? f.team || f.id : fighterId;
  }

  /** Devuelve true si ambos IDs pertenecen al mismo equipo (incluyendo sí mismo) */
  isSameTeamIds(idA, idB) {
    if (!idA || !idB) return false;
    if (idA === idB) return true;
    return this.getFighterTeam(idA) === this.getFighterTeam(idB);
  }

  /** Devuelve true si `targetFighter` está vivo y es enemigo de `ownerId` */
  isHostile(ownerId, targetFighter) {
    if (!targetFighter || !targetFighter.isAlive) return false;
    if (!ownerId || ownerId === '__tornado_release__') return true;
    if (targetFighter.id === ownerId) return false;
    return this.getFighterTeam(ownerId) !== (targetFighter.team || targetFighter.id);
  }

  // ============================================================
  //  Entrada y bucle
  // ============================================================

  /** Delegado desde Player.update() */
  processInput(input) {
    if (this.instantPlayerCooldowns) {
      this.clearPlayerCooldowns();
    }
    if (!this.onLocalAbilityCast) {
      this.controller.handleInput(input);
      return;
    }

    if (!input.isLocked || !this.player.isAlive || this.player.isFrozen || this.player.isStunned) {
      if (this.player.isMistFormActive && this.controller.endMistForm) {
        if (this.controller.endMistForm()) {
          this.onLocalAbilityCast(
            'mist_end',
            this.player.position,
            this.camera.getAimPoint(80),
            this.camera.yaw
          );
        }
      }
      return;
    }

    const castSlot = (slot, method) => {
      const aim = this.camera.getAimPoint(80);
      const yaw = this.camera.yaw;
      const ok = this.controller[method] ? this.controller[method](aim) : false;
      if (ok) {
        this.onLocalAbilityCast(slot, this.player.position, aim, yaw);
      }
    };

    if (this.player.isMistFormActive) {
      if (!input.isSecondaryHeld() && this.controller.endMistForm) {
        if (this.controller.endMistForm()) {
          this.onLocalAbilityCast(
            'mist_end',
            this.player.position,
            this.camera.getAimPoint(80),
            this.camera.yaw
          );
        }
      }
      return;
    }

    if (input.mouseJustPressed(2) || (this.controller.usesHeldSecondary && input.isSecondaryHeld())) {
      castSlot('secondary', 'trySecondary');
      if (this.player.isMistFormActive) return;
    }

    if (input.mouseJustPressed(0) || input.isMouseDown(0)) castSlot('primary', 'tryPrimary');
    if (input.justPressed('KeyQ')) castSlot('skill1', 'trySkill1');
    if (input.justPressed('KeyE')) castSlot('skill2', 'trySkill2');
  }

  update(dt) {
    for (const c of this.controllers) {
      c.update(dt);
    }
    if (this.player && this.player.survivalMods) {
      const sm = this.player.survivalMods;
      const effectiveCdMult = (sm.cooldownMult || 1) * (sm.auraCooldownMult || 1);
      if (effectiveCdMult < 0.999) {
        const bonusRate = 1 / Math.max(0.2, effectiveCdMult) - 1;
        const extraDt = dt * bonusRate;
        if (this.player.dashCooldown > 0) {
          this.player.dashCooldown = Math.max(0, this.player.dashCooldown - extraDt);
        }
        if (this.controller && this.controller.cooldowns) {
          for (const k of Object.keys(this.controller.cooldowns)) {
            if (this.controller.cooldowns[k] > 0) {
              this.controller.cooldowns[k] = Math.max(0, this.controller.cooldowns[k] - extraDt);
            }
          }
        }
      }
    }
    if (this.instantPlayerCooldowns) {
      this.clearPlayerCooldowns();
    }
    this._updateEclipseZones(dt);
    if (this.isAuthoritative !== false) {
      this._updateProjectiles(dt);
      this._updateWalls(dt);
      this._updateHazards(dt);
      this._updateTurrets(dt);
      this._checkHazardFighterCollisions();
    } else {
      this._updateProjectiles(dt);
      this._updateWalls(dt);
      this._updateHazards(dt);
      this._updateTurrets(dt);
    }
    this.vfx.update(dt);
  }

  /** Pone a cero todos los cooldowns activos del jugador (Dojo Recarga Instantánea) */
  clearPlayerCooldowns() {
    if (this.player) this.player.dashCooldown = 0;
    if (this.controller && this.controller.cooldowns) {
      for (const k of Object.keys(this.controller.cooldowns)) {
        this.controller.cooldowns[k] = 0;
      }
      if ('firewallCharges' in this.controller) {
        this.controller.firewallCharges = 2;
      }
      if ('_mountainJumpUsed' in this.controller) {
        this.controller._mountainJumpUsed = false;
      }
    }
  }

  /** Notifica uso de habilidad (sólo dispara feedback de HUD para el jugador) */
  notifyAbilityUsed(id, ownerId = 'player') {
    if (ownerId === 'player' && this.onAbilityUsed) {
      this.onAbilityUsed(id);
    }
  }

  /** Limpia todos los proyectiles, ondas sísmicas, muros activos y estados alterados */
  clearAll() {
    for (const f of this.fighters) {
      if (f.clearStatuses) f.clearStatuses();
    }
    for (const c of this.controllers) {
      c.reset();
    }
    for (const p of this.projectiles) {
      p.alive = false;
      if (p.onExpire) p.onExpire(p);
      this.scene.remove(p.mesh);
    }
    this.projectiles.length = 0;

    for (const w of this.walls) {
      w.state = 'dead';
      w.dispose();
    }
    this.walls.length = 0;

    for (const h of this.hazards) {
      if (h.dispose) h.dispose();
      else h.alive = false;
    }
    this.hazards.length = 0;
    this.fireWalls.length = 0;
    for (const t of this.turrets) {
      if (t.dispose) t.dispose();
      else t.alive = false;
    }
    this.turrets.length = 0;
    this.lightPrisms.length = 0;
    this.eclipseZones.length = 0;
    this.waterPuddles.length = 0;
    if (this.vfx && this.vfx.clearAll) this.vfx.clearAll();
  }

  // ============================================================
  //  Registro de entidades de combate
  // ============================================================

  addProjectile(p) {
    if (!p.mesh.parent) this.scene.add(p.mesh);
    this.projectiles.push(p);
    return p;
  }

  addWall(wall) {
    this.walls.push(wall);
    const alive = this.walls.filter((w) => w.alive);
    if (alive.length > MAX_WALLS) alive[0].crumble();
    return wall;
  }

  addHazard(h) {
    this.hazards.push(h);
    return h;
  }

  addFireWall(fw) {
    this.fireWalls.push(fw);
    return this.addHazard(fw);
  }

  /** Registra un Brote Escupesemillas destructible (máximo 2 activos por lanzador) */
  addTurret(turret) {
    const sameOwner = this.turrets.filter((t) => t.alive && t.ownerId === turret.ownerId);
    if (sameOwner.length >= 2 && sameOwner[0].destroyEarly) {
      sameOwner[0].destroyEarly();
    }
    this.turrets.push(turret);
    return turret;
  }

  /** Daña plantas torreta hostiles dentro de una esfera (impactos de área/hazards) */
  damageTurretsInSphere(center, radius, attackerId = null, amount = 1) {
    if (!this.turrets.length || this.isAuthoritative === false) return;
    for (const t of this.turrets) {
      if (!t.alive) continue;
      if (attackerId && !this.isHostile(attackerId, t)) continue;
      const dx = t.position.x - center.x;
      const dy = (t.position.y + 0.65) - center.y;
      const dz = t.position.z - center.z;
      const minD = (t.radius || 0.55) + radius;
      if (dx * dx + dy * dy + dz * dz <= minD * minD) {
        if (t.takeHit) t.takeHit(amount, attackerId);
      }
    }
  }

  getActiveFireWalls() {
    for (let i = this.fireWalls.length - 1; i >= 0; i--) {
      if (!this.fireWalls[i].alive) this.fireWalls.splice(i, 1);
    }
    return this.fireWalls;
  }

  /** Tornados errantes activos en la arena */
  getActiveTornadoes() {
    return this.hazards.filter((h) => h.alive && h.tag === 'tornado');
  }

  /** Muros sólidos actuales */
  getActiveWalls() {
    return this.walls.filter((w) => w.isSolid);
  }

  /** Meshes de muros sólidos (para el raycast de mira) */
  getWallMeshes() {
    const out = this._wallMeshes;
    out.length = 0;
    for (const w of this.walls) if (w.isSolid) out.push(w.mainMesh);
    return out;
  }

  /**
   * Objetivos extra para el raycast de puntería de cámara (muros sólidos + rivales y monstruos vivos).
   * @returns {THREE.Object3D[]}
   */
  getAimTargets() {
    const out = this._aimTargetCache;
    out.length = 0;
    for (const w of this.walls) {
      if (w.isSolid && w.mainMesh) out.push(w.mainMesh);
    }
    for (const f of this.fighters) {
      if (!f || f === this.player || !f.isAlive) continue;
      if (f.mesh && f.mesh.root) out.push(f.mesh.root);
    }
    for (const t of this.turrets) {
      if (t && t.alive && t.rootMesh && this.isHostile(this.player?.id, t)) {
        out.push(t.rootMesh);
      }
    }
    return out;
  }

  /**
   * Hitboxes activas (proyectiles en vuelo + peligros).
   * Formato: { type, tag, owner, ownerId, position, radius, damage, knockback, direction, source }
   */
  getActiveHitboxes() {
    const out = this._hitboxes;
    out.length = 0;
    for (const p of this.projectiles) if (p.alive) out.push(p.getHitbox());
    for (const h of this.hazards) {
      if (h.alive && h.getHitbox) {
        const hb = h.getHitbox();
        if (hb) out.push(hb);
      }
    }
    return out;
  }

  /** Estado de recargas del jugador para el HUD */
  getAbilityStates() {
    return this.controller.getAbilityStates();
  }

  // ============================================================
  //  Consultas de colisión del mundo y luchadores
  // ============================================================

  /**
   * Evalúa si `target` está oculto por Velo de Eclipse / Paso Sombrío respecto a `observer`
   * (bots/monstruos fuera del domo pierden fijación de objetivo).
   */
  isTargetHiddenFrom(observer, target) {
    if (!target || !target.isShadowVeil) return false;
    if (target.shadowStepVeilTimer > 0) return true;
    const z = target._eclipseZone;
    if (z && z.alive && observer && observer.position) {
      const dx = observer.position.x - z.center.x;
      const dz = observer.position.z - z.center.z;
      return dx * dx + dz * dz > (z.radius + 0.25) * (z.radius + 0.25);
    }
    return false;
  }

  isWaterPuddleAt(x, y, z) {
    if (!this.waterPuddles || this.waterPuddles.length === 0) return false;
    for (const wp of this.waterPuddles) {
      if (!wp || !wp.alive) continue;
      if (Math.abs(y - wp.y) > 0.55) continue;
      const dx = x - wp.x;
      const dz = z - wp.z;
      if (dx * dx + dz * dz <= wp.radius * wp.radius) return true;
    }
    return false;
  }

  isWaterAt(x, y, z) {
    if (this.arena && this.arena.isWaterAt && this.arena.isWaterAt(x, y, z)) return true;
    return this.isWaterPuddleAt(x, y, z);
  }

  _updateEclipseZones(dt) {
    for (const f of this.fighters) {
      if (!f) continue;
      f.inEclipseVeil = false;
      f._eclipseZone = null;
    }
    if (!this.eclipseZones || this.eclipseZones.length === 0) return;
    for (let i = this.eclipseZones.length - 1; i >= 0; i--) {
      const z = this.eclipseZones[i];
      if (!z || !z.alive) {
        this.eclipseZones.splice(i, 1);
        continue;
      }
      const r2 = z.radius * z.radius;
      for (const f of this.fighters) {
        if (!f || !f.isAlive || f.isMirage) continue;
        const dx = f.position.x - z.center.x;
        const dz = f.position.z - z.center.z;
        if (dx * dx + dz * dz > r2) continue;
        if (f.id === z.ownerId || (f.team && z.team && f.team === z.team) || this.isSameTeamIds(z.ownerId, f.id)) {
          f.inEclipseVeil = true;
          f._eclipseZone = z;
        } else if (this.isHostile(z.ownerId, f)) {
          f.shadowVeilSlowTimer = Math.max(f.shadowVeilSlowTimer || 0, 0.16);
        }
      }
    }
    for (const f of this.fighters) {
      if (f && f.mesh && f.mesh.setShadowVeil) {
        f.mesh.setShadowVeil(f.isShadowVeil);
      }
    }
    void dt;
  }

  /**
   * Prueba si un proyectil impacta contra un luchador enemigo.
   * El cuerpo del luchador se modela como una cápsula vertical entre `y` e `y + 1.65`.
   */
  _testFighterHit(pos, radius, ownerId, ignoreIds = null) {
    for (const f of this.fighters) {
      if (!this.isHostile(ownerId, f)) continue;
      if (ignoreIds && ignoreIds.has(f.id)) continue;
      const fx = f.position.x;
      const fz = f.position.z;
      const fy = THREE.MathUtils.clamp(pos.y, f.position.y + 0.2, f.position.y + 1.55);
      const dx = pos.x - fx;
      const dy = pos.y - fy;
      const dz = pos.z - fz;
      const minDist = f.config.radius + radius + 0.12;
      if (dx * dx + dy * dy + dz * dz <= minDist * minDist) {
        const normal = new THREE.Vector3(dx, dy, dz);
        if (normal.lengthSq() > 1e-5) normal.normalize();
        else normal.set(0, 1, 0);
        return {
          type: 'fighter',
          fighter: f,
          point: pos.clone(),
          normal,
        };
      }
    }
    return null;
  }

  setArena(arena) {
    this.arena = arena;
    if (arena && arena.setEffects) arena.setEffects(this.vfx, this.sound);
    if (this.vfx && this.vfx.setArena) this.vfx.setArena(arena);
    for (const c of this.controllers) {
      if (c && 'arena' in c) c.arena = arena;
    }
  }

  /**
   * Prueba una esfera contra luchadores enemigos, plantas torreta, muros y escenario.
   */
  testSphere(pos, radius, ownerId = null, ignoreIds = null) {
    // 1. Luchadores oponentes
    if (ownerId) {
      const fHit = this._testFighterHit(pos, radius, ownerId, ignoreIds);
      if (fHit) return fHit;

      // 1b. Plantas torreta hostiles (Brote Escupesemillas)
      for (const t of this.turrets) {
        if (!t.alive || !this.isHostile(ownerId, t)) continue;
        const ty = THREE.MathUtils.clamp(pos.y, t.position.y + 0.1, t.position.y + 1.35);
        const dx = pos.x - t.position.x;
        const dy = pos.y - ty;
        const dz = pos.z - t.position.z;
        const minDist = (t.radius || 0.55) + radius + 0.12;
        if (dx * dx + dy * dy + dz * dz <= minDist * minDist) {
          return {
            type: 'turret',
            turret: t,
            point: pos.clone(),
            normal: new THREE.Vector3(dx, dy, dz).normalize(),
          };
        }
      }
    }

    // 2. Muros activos
    for (const w of this.walls) {
      const hit = w.intersectSphere(pos, radius);
      if (hit) return { type: 'wall', wall: w, ...hit };
    }

    // 3. Geometría unificada del escenario (barriles, plataformas, edificios, pilares y suelo)
    if (this.arena && this.arena.checkProjectileHit) {
      return this.arena.checkProjectileHit(pos, radius, 15);
    }
    return null;
  }

  // ============================================================
  //  Actualización interna
  // ============================================================

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.alive) {
        p.life -= dt;
        p.velocity.y -= p.gravity * dt;

        _step.copy(p.velocity).multiplyScalar(dt);
        const len = _step.length();
        const maxStep = Math.max(0.12, p.radius * 0.6);
        const steps = Math.min(30, Math.max(1, Math.ceil(len / maxStep)));
        _step.divideScalar(steps);
        for (let s = 0; s < steps; s++) {
          p.position.add(_step);
          if (p.onSubStep && p.onSubStep(p)) {
            break;
          }
          const hit = this.testSphere(p.position, p.radius, p.ownerId, p._piercedIds || null);
          if (hit) {
            if (hit.type === 'fighter' && hit.fighter && p.piercing) {
              if (!p._piercedIds) p._piercedIds = new Set();
              p._piercedIds.add(hit.fighter.id);
              _hitDir.copy(p.velocity).normalize();
              if (_hitDir.y < 0.15) _hitDir.y = 0.18;
              _hitDir.normalize();
              hit.fighter.takeDamage(p.damage, _hitDir, p.knockback, p.ownerId);
              this.vfx.spawnHitSparks(hit.point, _hitDir, p.damage >= 25 ? 1.5 : 1.0);
              if (this.onFighterHit) this.onFighterHit(hit.fighter, p.damage, hit.point);
              if (p.onPierceHit) p.onPierceHit(hit, p);
              continue;
            }
            p.alive = false;
            if (hit.type === 'fighter' && hit.fighter) {
              _hitDir.copy(p.velocity).normalize();
              if (_hitDir.y < 0.15) _hitDir.y = 0.18;
              _hitDir.normalize();
              hit.fighter.takeDamage(p.damage, _hitDir, p.knockback, p.ownerId);
              this.vfx.spawnHitSparks(hit.point, _hitDir, p.damage >= 25 ? 1.5 : 1.0);
              if (this.onFighterHit) this.onFighterHit(hit.fighter, p.damage, hit.point);
              if (p.damage >= 20 && this.onHitstop) {
                this.onHitstop(0.045);
              }
            } else if (hit.type === 'turret' && hit.turret) {
              this.vfx.spawnHitSparks(hit.point, hit.normal || new THREE.Vector3(0, 1, 0), 0.9, '#52b788');
              if (this.isAuthoritative !== false && hit.turret.takeHit) {
                hit.turret.takeHit(1, p.ownerId);
              }
            }
            if (p.onImpact) p.onImpact(hit, p);
            break;
          }
        }

        if (p.alive) {
          p.mesh.rotation.x += p.spin.x * dt;
          p.mesh.rotation.y += p.spin.y * dt;
          p.mesh.rotation.z += p.spin.z * dt;
          if (p.onUpdate) p.onUpdate(dt, p);
          if (p.life <= 0 || p.position.y < -40) {
            p.alive = false;
            if (p.onExpire) p.onExpire(p);
          }
        }
      }
      if (!p.alive) {
        if (!p._capturedByTornado) {
          this.scene.remove(p.mesh);
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  _checkHazardFighterCollisions() {
    for (const h of this.hazards) {
      if (!h.alive || !h.getHitbox) continue;
      const hb = h.getHitbox();
      if (!hb) continue;

      if (this.arena.damageBarrelsInSphere) {
        this.arena.damageBarrelsInSphere(hb.position, hb.radius + 0.35, hb.damage);
      }
      this.damageTurretsInSphere(hb.position, hb.radius + 0.2, hb.ownerId, 1);

      for (const f of this.fighters) {
        if (!this.isHostile(hb.ownerId, f)) continue;
        if (hb.hitTargets && hb.hitTargets.has(f.id)) continue;

        const dx = f.position.x - hb.position.x;
        const dz = f.position.z - hb.position.z;
        const dy = Math.max(0, f.position.y - (hb.position.y + hb.radius));
        const minDist = f.config.radius + hb.radius;
        if (dx * dx + dz * dz + dy * dy <= minDist * minDist) {
          if (hb.hitTargets) hb.hitTargets.add(f.id);
          f.takeDamage(hb.damage, hb.direction, hb.knockback, hb.ownerId);
          const hitPoint = f.position.clone().setY(f.position.y + 0.9);
          this.vfx.rockImpact(hitPoint, hb.direction, 1.3);
          this.vfx.spawnHitSparks(hitPoint, hb.direction, 1.25);
          this.vfx.addTrauma(0.28);
          if (this.onFighterHit) this.onFighterHit(f, hb.damage, hitPoint);
          if (hb.damage >= 20 && this.onHitstop) {
            this.onHitstop(0.045);
          }
        }
      }
    }
  }

  _updateWalls(dt) {
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.update(dt);
      if (!w.alive) this.walls.splice(i, 1);
    }
  }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.update(dt);
      if (!h.alive) this.hazards.splice(i, 1);
    }
  }

  _updateTurrets(dt) {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.update(dt);
      if (!t.alive) {
        if (t.dispose) t.dispose();
        this.turrets.splice(i, 1);
      }
    }
  }
}
