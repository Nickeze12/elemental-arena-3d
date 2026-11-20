import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import {
  AIR_PALETTE,
  createHorizontalVortexMesh,
  createZigzagVortexMesh,
  createConcussiveWindWaveMesh,
  createGrandTornadoMesh,
} from '../utils/AirGeometry.js';

/**
 * AirController
 * ------------------------------------------------------------
 * Controlador del Maestro Aire (Movilidad Extrema, Control y Ring-Out Masivo)
 * con corrientes y embudos de viento Cel-Shaded (`AirGeometry.js`):
 *  1. Click Izq — Torbellino Frontal (0.65s, 8 daño, knockback 9.8): pequeño
 *     torbellino horizontal que gira sobre su eje de avance dejando estelas de aire.
 *  2. Click Der — Vórtice Zigzag (2.3s, 9 daño, knockback 8.0): proyectil de
 *     vórtice compacto con trayectoria senoidal lateral que se inclina al girar
 *     y disipa/desvía proyectiles básicos enemigos.
 *  3. Tecla Q — Ráfaga Concussiva (4.5s, 12 daño, knockback 18.5, cono 13u):
 *     3 medialunas curvas de aire comprimido + anillos de choque y ráfagas.
 *  4. Tecla E — Tornado Errante (7.0s, duración 5.0s, 18 daño, cooldown 0.85s
 *     por objetivo): gran embudo multicapa que deambula por la arena (~3.8 u/s)
 *     evitando caer por el borde, atrae levemente e impulsa al rival por los aires.
 */

const ABILITIES = [
  { id: 'airshot', slot: 'primary', name: 'Torbellino Frontal', key: 'Click Izq', cooldown: 0.65 },
  { id: 'airvortex', slot: 'secondary', name: 'Vórtice Zigzag', key: 'Click Der', cooldown: 2.3 },
  { id: 'airblast', slot: 'skill1', name: 'Ráfaga Concussiva', key: 'Q', cooldown: 4.5 },
  { id: 'tornado', slot: 'skill2', name: 'Tornado Errante', key: 'E', cooldown: 7.0 },
];

const SLOT_TO_ID = {
  primary: 'airshot',
  secondary: 'airvortex',
  skill1: 'airblast',
  skill2: 'tornado',
};

export class AirController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'air';
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
      airshot: 0,
      airvortex: 0,
      airblast: 0,
      tornado: 0,
    };

    this._punchRight = true;
    this._tasks = [];
    this._cleanups = new Set();
  }

  handleInput(input) {
    if (!input.isLocked || !this.fighter.isAlive || this.fighter.isFrozen) return;

    if (input.mouseJustPressed(0) || input.isMouseDown(0)) {
      this.tryPrimary();
    }
    if (input.mouseJustPressed(2)) {
      this.trySecondary();
    }
    if (input.justPressed('KeyQ')) {
      this.trySkill1();
    }
    if (input.justPressed('KeyE')) {
      this.trySkill2();
    }
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) {
        this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      }
    }

    for (let i = this._tasks.length - 1; i >= 0; i--) {
      const keep = this._tasks[i](dt);
      if (!keep) this._tasks.splice(i, 1);
    }
  }

  reset() {
    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] = 0;
    }
    this._tasks.length = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  isReady(idOrSlot) {
    const key = SLOT_TO_ID[idOrSlot] || idOrSlot;
    return (this.cooldowns[key] ?? 0) <= 0;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      const totalCd = ab.cooldown + this.cooldownBonus;
      const rem = this.cooldowns[ab.id];
      return {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: totalCd,
        remaining: rem,
        readiness: 1 - Math.min(1, rem / totalCd),
        ready: rem <= 0,
      };
    });
  }

  // ============================================================
  //  1. Click Izq — Torbellino Frontal (cooldown: 0.65s, 8 daño, knockback 9.8)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (this.cooldowns.airshot > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.airshot = 0.65 + this.cooldownBonus;

    const useRight = this._punchRight;
    this._punchRight = !this._punchRight;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.34);
    this.fighter.mesh.playAction(useRight ? 'punch_right' : 'punch_left', 0.3);
    this.manager.notifyAbilityUsed('airshot', this.ownerId);
    if (this.sound) this.sound.playAirShot();

    const sideSign = useRight ? -1 : 1;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

    const spawnPos = this.fighter.position
      .clone()
      .addScaledVector(right, -sideSign * 0.42)
      .addScaledVector(forward, 1.05);
    spawnPos.y = this.fighter.position.y + 1.32;

    const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
    const dir = aimPoint.sub(spawnPos).normalize();

    const vortex = createHorizontalVortexMesh();
    vortex.group.position.copy(spawnPos);
    vortex.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(vortex.group);
    this.vfx.spawnWindSwirl(this.fighter.position, 1.25);

    let streakTimer = 0;
    const proj = new Projectile({
      mesh: vortex.group,
      velocity: dir.clone().multiplyScalar(47),
      radius: 0.4,
      gravity: 0,
      life: 2.0,
      damage: 8,
      knockback: 9.8,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'air_basic',
      onUpdate: (dt, p) => {
        vortex.update(dt);
        streakTimer += dt;
        if (streakTimer >= 0.025) {
          streakTimer = 0;
          this.vfx.spawnAirStreak(p.position, dir);
          this.vfx.spawnDust(p.position, {
            count: 2,
            size: 0.34,
            speed: 1.6,
            life: 0.26,
            spread: 0.14,
            color: AIR_PALETTE.paleBlue,
            alpha: 0.65,
          });
        }
      },
      onImpact: (hit) => {
        if (hit.type === 'wall' && hit.wall) {
          hit.wall.takeDamage(20, hit.point);
        }
        this.vfx.spawnWindSwirl(hit.point, 1.75);
        this.vfx.spawnShockwave(hit.point, 2.1, 0.25, '#c4f5ff');
        this.vfx.spawnHitSparks(hit.point, hit.normal, 0.95, '#d6f8ff');
        this.vfx.addTrauma(0.1);
        vortex.dispose();
      },
      onExpire: () => vortex.dispose(),
    });

    this.manager.addProjectile(proj);
    return true;
  }

  // ============================================================
  //  2. Click Der — Vórtice en Zigzag (cooldown: 2.3s, 9 daño, empuje 8.0)
  // ============================================================
  trySecondary(customAimPoint = null) {
    if (this.cooldowns.airvortex > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.airvortex = 2.3 + this.cooldownBonus;

    const yaw = this.aimProvider.getAimYaw();
    this.fighter.faceDirection(yaw, 0.44);
    this.fighter.mesh.playAction('punch_right', 0.42);
    this.manager.notifyAbilityUsed('airvortex', this.ownerId);
    if (this.sound) this.sound.playAirVortex();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const spawnPos = this.fighter.position.clone().addScaledVector(forward, 1.35);
    spawnPos.y = this.fighter.position.y + 1.15;

    const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
    const dir = aimPoint.sub(spawnPos).normalize();
    dir.y = THREE.MathUtils.clamp(dir.y, -0.1, 0.22);
    dir.normalize();

    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();

    const vortex = createZigzagVortexMesh();
    vortex.group.position.copy(spawnPos);
    vortex.group.lookAt(spawnPos.clone().add(dir));
    this.scene.add(vortex.group);
    this.vfx.spawnWindSwirl(spawnPos, 1.5);
    this.vfx.spawnAirStreak(spawnPos, dir);

    const fwdSpeed = 22.0;
    const amp = 1.15;
    const freq = 9.0;
    let age = 0;
    let streakTimer = 0;

    const proj = new Projectile({
      mesh: vortex.group,
      velocity: dir.clone().multiplyScalar(fwdSpeed),
      radius: 0.78,
      gravity: 0,
      life: 1.85,
      damage: 9,
      knockback: 8.0,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'air_zigzag_vortex',
      onUpdate: (dt, p) => {
        age += dt;
        const latFactor = Math.cos(freq * age);
        // Velocidad = componente frontal + derivada lateral senoidal para seguir la curva exacta
        p.velocity.copy(dir).multiplyScalar(fwdSpeed).addScaledVector(right, amp * freq * latFactor);

        // Inclina suavemente el vórtice hacia el lado al que gira
        vortex.group.lookAt(p.position.clone().add(p.velocity));
        vortex.tiltGroup.rotation.z = -latFactor * 0.38;
        vortex.update(dt, age);

        // Intercepta / disipa proyectiles básicos enemigos en su trayectoria
        for (const op of this.manager.projectiles) {
          if (!op.alive || op === p || this.manager.isSameTeamIds(this.ownerId, op.ownerId)) continue;
          if (op.position.distanceTo(p.position) <= 1.25 + op.radius) {
            op.alive = false;
            if (op.onExpire) op.onExpire(op);
            this.vfx.spawnWindSwirl(op.position, 1.5);
            this.vfx.spawnHitSparks(op.position, dir, 0.95, '#ffffff');
            if (this.sound) this.sound.playAirShot();
          }
        }

        streakTimer += dt;
        if (streakTimer >= 0.028) {
          streakTimer = 0;
          this.vfx.spawnAirStreak(p.position, p.velocity);
          this.vfx.spawnDust(p.position, {
            count: 2,
            size: 0.42,
            speed: 1.6,
            life: 0.3,
            spread: 0.22,
            color: AIR_PALETTE.white,
            alpha: 0.72,
          });
        }
      },
      onImpact: (hit) => {
        if (hit.type === 'wall' && hit.wall) {
          hit.wall.takeDamage(28, hit.point);
        }
        this.vfx.spawnWindSwirl(hit.point, 2.2);
        this.vfx.spawnShockwave(hit.point, 2.5, 0.28, AIR_PALETTE.turquoise);
        this.vfx.spawnHitSparks(hit.point, hit.normal, 1.15, AIR_PALETTE.paleBlue);
        this.vfx.addTrauma(0.14);
        vortex.dispose();
      },
      onExpire: () => {
        this.vfx.spawnWindSwirl(vortex.group.position, 1.7);
        vortex.dispose();
      },
    });

    this.manager.addProjectile(proj);
    return true;
  }

  // ============================================================
  //  3. Tecla Q — Ráfaga Concussiva (cooldown: 4.5s, alcance 13u, 12 daño, knockback 18.5)
  // ============================================================
  trySkill1(aimPointOrYaw = null) {
    if (this.cooldowns.airblast > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.airblast = 4.5 + this.cooldownBonus;

    const yaw =
      typeof aimPointOrYaw === 'number'
        ? aimPointOrYaw
        : aimPointOrYaw && aimPointOrYaw.isVector3
        ? Math.atan2(aimPointOrYaw.x - this.fighter.position.x, aimPointOrYaw.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.5);
    this.fighter.mesh.playAction('heavy_throw', 0.5);
    this.manager.notifyAbilityUsed('airblast', this.ownerId);
    if (this.sound) this.sound.playAirBlast();

    const origin = this.fighter.position.clone();
    origin.y += 1.1;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    // 3 medialunas curvas de aire comprimido + 3 anillos de choque expandiéndose
    const wave = createConcussiveWindWaveMesh();
    this.scene.add(wave.group);

    const disposeWave = () => {
      this.scene.remove(wave.group);
      wave.dispose();
    };
    this._cleanups.add(disposeWave);

    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const maxRange = 13.0 * areaScale;
    const duration = 0.3;
    let elapsed = 0;
    let fxTimer = 0;
    const hitFighters = new Set();
    const coneCos = Math.cos((40 * Math.PI) / 180);

    this.vfx.spawnWindSwirl(this.fighter.position, 2.5);
    this.vfx.spawnShockwave(this.fighter.position, 3.2, 0.3, '#d8faff');
    this.vfx.spawnAirStreak(origin.clone().addScaledVector(forward, 1.2), forward);
    this.vfx.addTrauma(0.28);

    this._tasks.push((dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      if (!this.fighter.isAlive || t >= 1) {
        this._cleanups.delete(disposeWave);
        disposeWave();
        return false;
      }

      const frontDist = 1.4 + (maxRange - 1.4) * (1 - Math.pow(1 - t, 2));
      for (let i = 0; i < wave.crescents.length; i++) {
        const d = Math.max(0.8, frontDist - i * 1.65);
        const c = wave.crescents[i];
        c.position.set(origin.x + forward.x * d, origin.y + (i - 1) * 0.14, origin.z + forward.z * d);
        c.rotation.y = yaw;
        const cs = 0.68 + (d / maxRange) * 1.95;
        c.scale.set(cs, 1 + (d / maxRange) * 0.5, cs * 0.9);

        const r = wave.rings[i];
        const rd = Math.max(0.6, d - 0.5);
        r.position.set(origin.x + forward.x * rd, origin.y, origin.z + forward.z * rd);
        r.rotation.y = yaw;
        r.rotation.z += dt * (18 + i * 4);
        r.scale.setScalar(0.65 + (rd / maxRange) * 2.05);
      }

      fxTimer += dt;
      if (fxTimer >= 0.045) {
        fxTimer = 0;
        const groundPt = origin.clone().setY(0).addScaledVector(forward, frontDist * 0.78);
        this.vfx.spawnWindSwirl(groundPt, 1.85);
        this.vfx.spawnAirStreak(origin.clone().addScaledVector(forward, frontDist * 0.9), forward);
      }

      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f) || hitFighters.has(f.id)) continue;
        const dx = f.position.x - origin.x;
        const dz = f.position.z - origin.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= frontDist + 0.8 && dist >= 0.4) {
          const dirX = dx / dist;
          const dirZ = dz / dist;
          const dot = dirX * forward.x + dirZ * forward.z;
          if (dot >= coneCos) {
            hitFighters.add(f.id);
            const pushDir = new THREE.Vector3(forward.x * 0.7 + dirX * 0.3, 0.26, forward.z * 0.7 + dirZ * 0.3).normalize();
            // Knockback masivo ideal para Ring-Out (18.5)
            f.takeDamage(12, pushDir, 18.5, this.ownerId);
            const hitPt = f.position.clone().setY(f.position.y + 1.0);
            this.vfx.spawnWindSwirl(f.position, 2.6);
            this.vfx.spawnShockwave(f.position, 3.2, 0.32, '#ffffff');
            this.vfx.spawnHitSparks(hitPt, pushDir, 1.4, '#e6faff');
            this.vfx.addTrauma(0.32);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 12, hitPt);
            if (this.manager.onHitstop) this.manager.onHitstop(0.045);
          }
        }
      }

      if (this.arena.damageBarrelsInSphere) {
        this.arena.damageBarrelsInSphere(origin.clone().addScaledVector(forward, frontDist * 0.75), 2.4, 15);
      }

      return true;
    });

    return true;
  }

  // ============================================================
  //  4. Tecla E — Tornado Errante (cooldown: 7.0s, duración 5.0s, 18 daño + elevación)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (this.cooldowns.tornado > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.tornado = 7.0 + this.cooldownBonus;

    const yaw =
      customAimPoint && customAimPoint.isVector3
        ? Math.atan2(customAimPoint.x - this.fighter.position.x, customAimPoint.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.55);
    this.fighter.mesh.playAction('stomp_seismic', 0.55);
    this.manager.notifyAbilityUsed('tornado', this.ownerId);
    if (this.sound) this.sound.playTornado();

    // Si el usuario está en el aire, le da un impulso adicional de salto
    if (!this.fighter.onGround) {
      this.fighter.velocity.y = Math.max(this.fighter.velocity.y, 11.5);
      this.vfx.spawnWindSwirl(this.fighter.position, 2.2);
    }

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const arena = this.manager.arena || this.arena;
    const startPos = this.fighter.position.clone().addScaledVector(forward, 2.0);
    const startGround = arena.getGroundHeightAt
      ? arena.getGroundHeightAt(startPos.x, this.fighter.position.y + 1.0, startPos.z)
      : 0;
    startPos.y = Number.isFinite(startGround) ? Math.max(0, startGround) : 0;

    // Clampa punto de invocación dentro del área segura
    if (arena.clampToPlayableArea) {
      arena.clampToPlayableArea(startPos, 4.0);
    }

    const tornado = createGrandTornadoMesh(4.2, 1.8);
    const tornadoGroup = tornado.group;
    tornadoGroup.position.copy(startPos);
    this.scene.add(tornadoGroup);
    this.vfx.spawnWindSwirl(startPos, 2.4);

    const duration = 5.0;
    const speed = 3.8;
    let age = 0;
    let steerTimer = 0.6 + Math.random() * 0.5;
    let fxTimer = 0;

    let curAngle = Math.atan2(forward.x, forward.z);
    let targetAngle = curAngle;
    const borderTurnSign = Math.random() > 0.5 ? 1 : -1;
    const moveDir = forward.clone().setY(0).normalize();
    /** Cooldown de 0.85s por objetivo para no instakillear */
    const targetHitTimers = new Map();

    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const captureRadius = 2.65 * areaScale;
    const captured = [];
    const orbitGroup = new THREE.Group();
    orbitGroup.position.copy(tornadoGroup.position);
    this.scene.add(orbitGroup);

    const releaseCaptured = () => {
      const count = captured.length;
      if (count === 0) return;
      for (let idx = 0; idx < count; idx++) {
        const cap = captured[idx];
        const outAngle = (idx / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const outDir = new THREE.Vector3(Math.cos(outAngle), 0.06, Math.sin(outAngle)).normalize();
        const spawnPos = new THREE.Vector3(
          tornadoGroup.position.x + Math.cos(outAngle) * Math.max(1.1, cap.orbitRadius * 0.8),
          tornadoGroup.position.y + Math.max(1.15, cap.orbitY),
          tornadoGroup.position.z + Math.sin(outAngle) * Math.max(1.1, cap.orbitRadius * 0.8)
        );
        if (cap.mesh.parent) cap.mesh.parent.remove(cap.mesh);
        cap.mesh.position.copy(spawnPos);
        cap.mesh.scale.setScalar(1);
        this.scene.add(cap.mesh);
        cap.mesh.lookAt(spawnPos.clone().add(outDir));

        const relProj = new Projectile({
          mesh: cap.mesh,
          velocity: outDir.multiplyScalar(Math.max(20, cap.speed * 0.9)),
          radius: cap.radius,
          gravity: 0.2,
          life: 1.45,
          damage: cap.damage,
          knockback: cap.knockback,
          owner: null,
          ownerId: '__tornado_release__',
          tag: cap.tag,
          _tornadoReleased: true,
          onImpact: (hit) => {
            if (this.vfx) {
              this.vfx.spawnHitSparks(hit.point, hit.normal, 1.0, '#d6f8ff');
            }
            if (cap.onExpire) cap.onExpire();
          },
          onExpire: (p) => {
            if (cap.onExpire) cap.onExpire(p);
          },
        });
        relProj._tornadoReleased = true;
        this.manager.addProjectile(relProj);
      }
      captured.length = 0;
    };

    const hazard = {
      alive: true,
      tag: 'tornado',
      ownerId: this.ownerId,
      position: tornadoGroup.position,
      radius: 1.85 * areaScale,
      dispose: () => {
        if (!hazard.alive) return;
        hazard.alive = false;
        for (const cap of captured) {
          if (cap.mesh.parent) cap.mesh.parent.remove(cap.mesh);
          if (cap.onExpire) cap.onExpire();
        }
        captured.length = 0;
        this.scene.remove(orbitGroup);
        this.scene.remove(tornadoGroup);
        tornado.dispose();
      },
      update: (dt) => {
        age += dt;
        orbitGroup.position.copy(tornadoGroup.position);
        if (age >= duration) {
          releaseCaptured();
          this.vfx.spawnWindSwirl(tornadoGroup.position, 2.4);
          hazard.dispose();
          return;
        }

        // Intercepta proyectiles que entren al embudo y los hace orbitar alrededor del tornado
        if (captured.length < 16) {
          for (const p of this.manager.projectiles) {
            if (!p.alive || p._capturedByTornado || p._tornadoReleased || !p.mesh) continue;
            if (p.tag === 'shadow_tendrils_seeker' || p.tag === 'storm_cloud_seed') continue;
            if ((p.damage || 0) <= 0 && p.tag !== 'nature_spores') continue;

            const dxp = p.position.x - tornadoGroup.position.x;
            const dzp = p.position.z - tornadoGroup.position.z;
            const dyp = p.position.y - tornadoGroup.position.y;
            if (dyp >= -0.35 && dyp <= 4.6 && dxp * dxp + dzp * dzp <= captureRadius * captureRadius) {
              p.alive = false;
              p._capturedByTornado = true;
              if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
              orbitGroup.add(p.mesh);

              const orbIdx = captured.length;
              const angle = Math.atan2(dzp, dxp);
              captured.push({
                mesh: p.mesh,
                speed: Math.max(18, p.velocity.length() || 24),
                radius: p.radius || 0.34,
                damage: Math.max(6, p.damage || 10),
                knockback: Math.max(5.5, p.knockback || 6.5),
                tag: p.tag || 'projectile',
                onExpire: p.onExpire,
                orbitAngle: angle,
                orbitRadius: 1.3 + (orbIdx % 3) * 0.36,
                orbitY: THREE.MathUtils.clamp(dyp, 1.0, 3.3),
                orbitSpeed: (orbIdx % 2 === 0 ? 1 : -1) * (5.2 + (orbIdx % 3) * 1.15),
              });
              this.vfx.spawnAirStreak(
                tornadoGroup.position.clone().setY(tornadoGroup.position.y + 1.5),
                new THREE.Vector3(Math.cos(angle), 0.25, Math.sin(angle))
              );
              if (captured.length >= 16) break;
            }
          }
        }

        // Actualiza órbita visual de proyectiles atrapados
        for (const cap of captured) {
          cap.orbitAngle += cap.orbitSpeed * dt;
          cap.mesh.position.set(
            Math.cos(cap.orbitAngle) * cap.orbitRadius,
            cap.orbitY + Math.sin(age * 4.5 + cap.orbitAngle) * 0.22,
            Math.sin(cap.orbitAngle) * cap.orbitRadius
          );
          cap.mesh.rotation.y = -cap.orbitAngle;
          cap.mesh.rotation.x += dt * 4.0;
        }

        for (const [fid, rem] of targetHitTimers.entries()) {
          if (rem - dt <= 0) targetHitTimers.delete(fid);
          else targetHitTimers.set(fid, rem - dt);
        }

        // Cambio suave aleatorio de rumbo cada 0.6s - 1.1s
        steerTimer -= dt;
        if (steerTimer <= 0) {
          steerTimer = 0.6 + Math.random() * 0.5;
          targetAngle = curAngle + (Math.random() - 0.5) * 2.1;
        }

        const activeArena = this.manager.arena || this.arena;

        // Conciencia de borde del mapa activo (circular en Arena o amurallado en Santuario)
        const nearEdge = activeArena.isOutOfBounds
          ? activeArena.isOutOfBounds(tornadoGroup.position.x, tornadoGroup.position.z, 4.5)
          : Math.hypot(tornadoGroup.position.x, tornadoGroup.position.z) > 25.5;
        if (nearEdge) {
          targetAngle = Math.atan2(-tornadoGroup.position.x, -tornadoGroup.position.z);
        }

        // Esquiva suave de pilares / edificios para no atascarse
        for (const p of activeArena.pillars) {
          const dx = tornadoGroup.position.x - p.x;
          const dz = tornadoGroup.position.z - p.z;
          const dp = Math.hypot(dx, dz);
          if (dp < p.radius + 1.6 && dp > 1e-4) {
            targetAngle = Math.atan2(dx, dz);
          }
        }
        if (activeArena.boxColliders) {
          for (const box of activeArena.boxColliders) {
            if (box.maxY <= 1.0) continue;
            const bx = (box.minX + box.maxX) * 0.5;
            const bz = (box.minZ + box.maxZ) * 0.5;
            if (
              tornadoGroup.position.x >= box.minX - 1.8 &&
              tornadoGroup.position.x <= box.maxX + 1.8 &&
              tornadoGroup.position.z >= box.minZ - 1.8 &&
              tornadoGroup.position.z <= box.maxZ + 1.8
            ) {
              targetAngle = Math.atan2(tornadoGroup.position.x - bx, tornadoGroup.position.z - bz);
            }
          }
        }

        let angleDiff = Math.atan2(Math.sin(targetAngle - curAngle), Math.cos(targetAngle - curAngle));
        if (Math.abs(angleDiff) > Math.PI - 0.08) {
          angleDiff = borderTurnSign * (Math.PI - 0.1);
        }
        const turnRate = nearEdge ? 4.4 : 3.2;
        const maxStep = turnRate * dt;
        curAngle += THREE.MathUtils.clamp(angleDiff, -maxStep, maxStep);
        moveDir.set(Math.sin(curAngle), 0, Math.cos(curAngle));

        tornadoGroup.position.addScaledVector(moveDir, speed * dt);

        // Salvaguarda final para nunca salir del área jugable ni atravesar edificios
        if (activeArena.clampToPlayableArea) {
          activeArena.clampToPlayableArea(tornadoGroup.position, 1.3);
        }
        const gH = activeArena.getGroundHeightAt
          ? activeArena.getGroundHeightAt(tornadoGroup.position.x, tornadoGroup.position.y + 1.2, tornadoGroup.position.z)
          : 0;
        if (Number.isFinite(gH)) {
          tornadoGroup.position.y = THREE.MathUtils.lerp(tornadoGroup.position.y, Math.max(0, gH), Math.min(1, dt * 8));
        }

        tornado.update(dt, age);

        // Aparición y desvanecimiento suaves al principio y al final de los 5s
        const appear = Math.min(1, age / 0.22);
        const fadeOut = age > duration - 0.35 ? Math.max(0.05, (duration - age) / 0.35) : 1;
        tornadoGroup.scale.setScalar(appear * fadeOut);

        fxTimer += dt;
        if (fxTimer >= 0.14) {
          fxTimer = 0;
          this.vfx.spawnWindSwirl(tornadoGroup.position, 1.9);
          this.vfx.spawnAirStreak(
            tornadoGroup.position.clone().setY(1.2 + Math.random() * 2.2),
            new THREE.Vector3(-moveDir.z, 0.35, moveDir.x)
          );
        }

        if (this.arena.damageBarrelsInSphere) {
          this.arena.damageBarrelsInSphere(tornadoGroup.position, 1.85, 15);
        }

        // Atrae levemente a rivales cercanos y eleva/lanza al tocarlos (cooldown 0.85s por objetivo)
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f)) continue;
          const dx = tornadoGroup.position.x - f.position.x;
          const dz = tornadoGroup.position.z - f.position.z;
          const d = Math.hypot(dx, dz);

          // Succión sutil hacia el eje del tornado dentro de 5.2u
          if (d <= 5.2 && d > 1.4 && f.position.y <= 4.2) {
            const pull = (1 - d / 5.2) * 4.4 * dt;
            f.position.x += (dx / d) * pull;
            f.position.z += (dz / d) * pull;
          }

          if (d <= 1.8 && f.position.y <= 4.0 && !targetHitTimers.has(f.id)) {
            targetHitTimers.set(f.id, 0.85);
            const pushX = d > 1e-3 ? -dx / d : moveDir.x;
            const pushZ = d > 1e-3 ? -dz / d : moveDir.z;
            const liftDir = new THREE.Vector3(
              (pushX * 0.45 + moveDir.x * 0.55) * 0.55,
              0.85,
              (pushZ * 0.45 + moveDir.z * 0.55) * 0.55
            ).normalize();

            f.takeDamage(18, liftDir, 13.5, this.ownerId);
            f.onGround = false;
            f.velocity.y = Math.max(f.velocity.y, 14.0);
            const hitPt = f.position.clone().setY(f.position.y + 1.1);
            this.vfx.spawnWindSwirl(tornadoGroup.position, 2.7);
            this.vfx.spawnShockwave(tornadoGroup.position, 3.1, 0.34, '#ffffff');
            this.vfx.spawnHitSparks(hitPt, liftDir, 1.35, '#e6faff');
            this.vfx.addTrauma(0.32);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 18, hitPt);
            if (this.manager.onHitstop) this.manager.onHitstop(0.05);
          }
        }
      },
      getHitbox: () => null,
    };

    this.manager.addHazard(hazard);
    return true;
  }
}
