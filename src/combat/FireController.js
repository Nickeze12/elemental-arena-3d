import * as THREE from 'three';
import { Projectile } from './Projectile.js';
import {
  FIRE_PALETTE,
  getFlameMaterials,
  createLayeredFlame,
  createCrescentBladeGeometry,
  createMeteorHeadGeometry,
} from '../utils/FlameGeometry.js';

/**
 * FireController
 * ------------------------------------------------------------
 * Controlador refinado del Maestro Fuego (Velocidad, Combo y Presión Ofensiva)
 * con llamas orgánicas multicapa Cel-Shaded (`#fff3a1` / `#ff6a00` / `#d9261c`):
 *  1. Click Izq — Combo Ígneo de 3 Golpes (ventana 0.9s, cooldown final 0.95s):
 *     - Golpe 1 (Puño Derecho Ígneo): ráfaga corta/veloz de llamas (alcance 7.5u, 7 daño).
 *     - Golpe 2 (Puño Izquierdo Ígneo): ráfaga más ancha/rápida (alcance 8.5u, 8 daño).
 *     - Golpe 3 (Patada Remate): giro con patada circular (`crescent_kick`) y
 *       medialuna afilada de fuego (ancho 2.8u, alcance 12u, 11 daño, knockback 10.5).
 *  2. Click Der — Muro Bajo de Fuego (2 cargas, cooldown 2.0s tras lanzar la 2.ª, duración 5.0s):
 *     - Fila de 15 lenguas de fuego rugiendo sobre brasas (5.6 × 1.15 × 0.8) a 2.8u.
 *     - Control de zona (no frena proyectiles): al contacto inflige 8 daño,
 *       empuje 5.5 y `applyBurn(2.0)` (cooldown 1.0s por objetivo).
 *  3. Tecla Q — Abanico de Llamas Mejorado (cooldown 4.5s, alcance 9.5u, 65°):
 *     - Oleada expansiva de 7 chorros de llamas entrelazadas con marcas incandescentes
 *       en el suelo (16 daño, knockback 11.0, `applyBurn(1.5)`).
 *  4. Tecla E — Propulsión Meteoro Mejorada (cooldown 4.5s):
 *     - Cabeza de meteoro esculpida en llamas con estelas espirales y rastro de brasas;
 *       detona una nova ígnea de doble anillo + columnas de fuego ascendentes
 *       (23 daño, knockback 16.0, hitstop + screen shake).
 */

const ABILITIES = [
  { id: 'firecombo', slot: 'primary', name: 'Combo Ígneo', key: 'Click Izq', cooldown: 0.95 },
  { id: 'firewall', slot: 'secondary', name: 'Muro de Fuego', key: 'Click Der', cooldown: 2.0 },
  { id: 'flamefan', slot: 'skill1', name: 'Abanico Llamas', key: 'Q', cooldown: 4.5 },
  { id: 'meteor', slot: 'skill2', name: 'Propulsión Meteoro', key: 'E', cooldown: 4.5 },
];

const SLOT_TO_ID = {
  primary: 'firecombo',
  secondary: 'firewall',
  skill1: 'flamefan',
  skill2: 'meteor',
};

export class FireController {
  constructor(manager, fighter = manager.player, aimProvider = null, cooldownBonus = 0) {
    this.element = 'fire';
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
      firecombo: 0,
      firewall: 0,
      flamefan: 0,
      meteor: 0,
    };

    // Estado del Combo Ígneo de 3 Golpes (0 -> 1 -> 2)
    this.comboStep = 0;
    this._comboWindowTimer = 0;
    this._stepSwingTimer = 0;

    // Sistema de 2 cargas para Muro de Fuego (el enfriamiento de 2.0s inicia al gastar la 2.ª)
    this.firewallCharges = 2;
    this._firewallRecharging = false;

    this._tasks = [];
    this._cleanups = new Set();

    this._mats = getFlameMaterials();
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

    if (this._firewallRecharging && this.cooldowns.firewall <= 0) {
      this._firewallRecharging = false;
      this.firewallCharges = 2;
    }

    if (this._stepSwingTimer > 0) {
      this._stepSwingTimer = Math.max(0, this._stepSwingTimer - dt);
    }

    if (this._comboWindowTimer > 0) {
      this._comboWindowTimer = Math.max(0, this._comboWindowTimer - dt);
      if (this._comboWindowTimer <= 0) {
        this.comboStep = 0;
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
    this.comboStep = 0;
    this._comboWindowTimer = 0;
    this._stepSwingTimer = 0;
    this.firewallCharges = 2;
    this._firewallRecharging = false;
    this._tasks.length = 0;
    for (const fn of this._cleanups) fn();
    this._cleanups.clear();
  }

  isReady(idOrSlot) {
    const key = SLOT_TO_ID[idOrSlot] || idOrSlot;
    if (key === 'firecombo') {
      return this.cooldowns.firecombo <= 0 && this._stepSwingTimer <= 0;
    }
    if (key === 'firewall') {
      return this.firewallCharges > 0 && this.cooldowns.firewall <= 0;
    }
    return (this.cooldowns[key] ?? 0) <= 0;
  }

  getAbilityStates() {
    return ABILITIES.map((ab) => {
      const totalCd = ab.cooldown + this.cooldownBonus;
      const rem = ab.id === 'firecombo'
        ? Math.max(this.cooldowns.firecombo, this._stepSwingTimer)
        : this.cooldowns[ab.id];
      const base = {
        id: ab.id,
        slot: ab.slot,
        name: ab.name,
        key: ab.key,
        cooldown: totalCd,
        remaining: rem,
        readiness: ab.id === 'firewall' && this.firewallCharges > 0 ? 1 : 1 - Math.min(1, rem / totalCd),
        ready: this.isReady(ab.id),
      };
      if (ab.id === 'firewall') {
        base.charges = this.firewallCharges;
        base.maxCharges = 2;
      }
      return base;
    });
  }

  // ============================================================
  //  1. Click Izquierdo — Combo Ígneo de 3 Golpes (ventana 0.9s, cooldown final 0.75s)
  // ============================================================
  tryPrimary(customAimPoint = null) {
    if (!this.isReady('firecombo') || !this.fighter.isAlive || this.fighter.isFrozen) return false;

    const step = this.comboStep;
    const yaw = this.aimProvider.getAimYaw();

    if (step === 0 || step === 1) {
      // Golpe 1 (Puño Derecho) o Golpe 2 (Puño Izquierdo)
      const isSecond = step === 1;
      this.comboStep = step + 1;
      this._comboWindowTimer = 0.9;
      this._stepSwingTimer = 0.21;

      this.fighter.faceDirection(yaw, 0.34);
      this.fighter.mesh.playAction(isSecond ? 'punch_left' : 'punch_right', 0.28);
      this.manager.notifyAbilityUsed('firecombo', this.ownerId);
      if (this.sound) this.sound.playFireCombo(step);

      this._launchFlamePunch(customAimPoint, isSecond);
      return true;
    }

    // Golpe 3 (Patada Remate — Medialuna de Fuego)
    this.comboStep = 0;
    this._comboWindowTimer = 0;
    this._stepSwingTimer = 0;
    this.cooldowns.firecombo = 0.95 + this.cooldownBonus;

    this.fighter.faceDirection(yaw, 0.45);
    this.fighter.mesh.playAction('crescent_kick', 0.44);
    this.manager.notifyAbilityUsed('firecombo', this.ownerId);
    if (this.sound) this.sound.playFireCombo(2);

    this._launchFlameCrescent(customAimPoint);
    return true;
  }

  _launchFlamePunch(customAimPoint, isSecond) {
    const yaw = this.aimProvider.getAimYaw();
    const sideSign = isSecond ? 1 : -1;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

    const spawnPos = this.fighter.position
      .clone()
      .addScaledVector(right, -sideSign * 0.4)
      .addScaledVector(forward, 1.0);
    spawnPos.y = this.fighter.position.y + 1.3;

    const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
    const dir = aimPoint.sub(spawnPos).normalize();

    // Lengua de fuego esculpida en 3 capas sin contorno orientada a lo largo de la dirección de vuelo (+Z)
    const widthScale = isSecond ? 1.38 : 1.0;
    const flame = createLayeredFlame(0.28 * widthScale, isSecond ? 1.3 : 1.05, isSecond ? 3.2 : 1.4, 0.14);
    flame.group.rotation.x = Math.PI / 2;

    // 2 lenguas secundarias laterales en el segundo golpe para un aspecto más ancho
    const extraFlames = [];
    if (isSecond) {
      const fL = createLayeredFlame(0.18, 0.85, 5.1, 0.16);
      fL.group.position.set(-0.24, 0.05, -0.08);
      fL.group.rotation.set(Math.PI / 2, 0, 0.25);
      const fR = createLayeredFlame(0.18, 0.85, 7.3, -0.16);
      fR.group.position.set(0.24, 0.05, -0.08);
      fR.group.rotation.set(Math.PI / 2, 0, -0.25);
      flame.group.add(fL.group, fR.group);
      extraFlames.push(fL, fR);
    }

    const holder = new THREE.Group();
    holder.position.copy(spawnPos);
    holder.lookAt(spawnPos.clone().add(dir));
    holder.add(flame.group);
    this.scene.add(holder);

    const speed = isSecond ? 42 : 36;
    const range = isSecond ? 8.5 : 7.5;
    const life = range / speed;
    const damage = isSecond ? 8 : 7;
    const knockback = isSecond ? 5.2 : 4.4;

    const dispose = () => {
      flame.dispose();
      for (const ef of extraFlames) ef.dispose();
    };

    let age = 0;
    let sparkTimer = 0;
    const proj = new Projectile({
      mesh: holder,
      velocity: dir.multiplyScalar(speed),
      radius: isSecond ? 0.52 : 0.4,
      gravity: 0,
      life,
      damage,
      knockback,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: isSecond ? 'fire_combo_2' : 'fire_combo_1',
      onUpdate: (dt, p) => {
        age += dt;
        const pulse = 0.92 + 0.22 * Math.sin(age * 36);
        flame.group.scale.set(pulse, 1.0 + 0.15 * Math.cos(age * 30), pulse);
        flame.update(age);
        for (const ef of extraFlames) ef.update(age);
        sparkTimer += dt;
        if (sparkTimer >= 0.025) {
          sparkTimer = 0;
          this.vfx.spawnFireSparks(p.position, null, 0.55);
        }
      },
      onImpact: (hit) => {
        if (hit.type === 'wall' && hit.wall) {
          hit.wall.takeDamage(damage * 2, hit.point);
        }
        this.vfx.spawnFireSparks(hit.point, hit.normal, 1.15);
        this.vfx.spawnShockwave(hit.point, 1.45, 0.24, '#ff7a1a');
        this.vfx.addTrauma(0.1);
        dispose();
      },
      onExpire: (p) => {
        this.vfx.spawnFireSparks(p.position, null, 0.6);
        dispose();
      },
    });

    this.manager.addProjectile(proj);
  }

  _launchFlameCrescent(customAimPoint) {
    const yaw = this.aimProvider.getAimYaw();
    const spawnPos = this.fighter.position
      .clone()
      .addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 1.25);
    spawnPos.y = this.fighter.position.y + 1.2;

    const aimPoint = customAimPoint ? customAimPoint.clone() : this.aimProvider.getAimPoint(80);
    const dir = aimPoint.sub(spawnPos).normalize();
    // Evita que una mira ligeramente inclinada estrelle la medialuna contra el suelo antes de su alcance
    dir.y = THREE.MathUtils.clamp(dir.y, -0.05, 0.25);
    dir.normalize();

    const { coreMat, midMat, outerMat } = this._mats;
    const bladeGroup = new THREE.Group();
    bladeGroup.position.copy(spawnPos);
    bladeGroup.lookAt(spawnPos.clone().add(dir));

    // 3 capas concéntricas de medialuna curva afilada (ancho total 2.8); el núcleo sobresale
    // ligeramente hacia arriba/atrás para leerse nítido en tercera persona
    const outerGeo = createCrescentBladeGeometry(2.8, 1.3, 0.1);
    const midGeo = createCrescentBladeGeometry(2.48, 1.05, 0.14);
    const coreGeo = createCrescentBladeGeometry(2.05, 0.78, 0.18);

    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.z = -0.04;
    coreMesh.userData.noOutline = true;
    coreMesh.renderOrder = 1;

    const midMesh = new THREE.Mesh(midGeo, midMat);
    midMesh.position.z = -0.01;
    midMesh.userData.noOutline = true;
    midMesh.renderOrder = 2;

    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.z = 0.03;
    outerMesh.renderOrder = 1;
    outerMesh.userData.noOutline = true;

    // Inclinación diagonal en arco de patada marcial
    const tiltPivot = new THREE.Group();
    tiltPivot.rotation.z = 0.42;
    tiltPivot.add(coreMesh, midMesh, outerMesh);
    bladeGroup.add(tiltPivot);
    this.scene.add(bladeGroup);

    const speed = 36;
    const range = 12.0;
    const life = range / speed;
    const hitWideTargets = new Set();

    const disposeBlade = () => {
      outerGeo.dispose();
      midGeo.dispose();
      coreGeo.dispose();
    };

    const fwdFlat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const rightFlat = new THREE.Vector3(-fwdFlat.z, 0, fwdFlat.x);
    let sparkTimer = 0;

    const proj = new Projectile({
      mesh: bladeGroup,
      velocity: dir.multiplyScalar(speed),
      radius: 0.38, // Radio compacto para no rozar el suelo; el barrido ancho 2.8u se evalúa abajo
      gravity: 0,
      life,
      damage: 11,
      knockback: 10.5,
      owner: this.fighter,
      ownerId: this.ownerId,
      tag: 'fire_combo_crescent',
      onUpdate: (dt, p) => {
        // Barrido ancho de 2.8 unidades de la medialuna contra luchadores rivales
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f) || hitWideTargets.has(f.id)) continue;
          const dx = f.position.x - p.position.x;
          const dz = f.position.z - p.position.z;
          const localZ = dx * fwdFlat.x + dz * fwdFlat.z;
          const localX = dx * rightFlat.x + dz * rightFlat.z;
          const dy = Math.abs(f.position.y + 1.0 - p.position.y);
          if (Math.abs(localX) <= 1.45 + f.config.radius && Math.abs(localZ) <= 0.85 && dy <= 1.15) {
            hitWideTargets.add(f.id);
            const pushDir = new THREE.Vector3(fwdFlat.x, 0.22, fwdFlat.z).normalize();
            f.takeDamage(11, pushDir, 10.5, this.ownerId);
            const hitPt = f.position.clone().setY(f.position.y + 1.1);
            this.vfx.spawnFireSparks(hitPt, pushDir, 1.5);
            this.vfx.spawnShockwave(f.position, 2.2, 0.28, '#ff7a1a');
            this.vfx.addTrauma(0.22);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 11, hitPt);
            p.alive = false;
            disposeBlade();
            return;
          }
        }

        sparkTimer += dt;
        if (sparkTimer >= 0.025) {
          sparkTimer = 0;
          const wing = (Math.random() - 0.5) * 2.2;
          this.vfx.spawnFireSparks(p.position.clone().addScaledVector(rightFlat, wing), null, 0.7);
        }
      },
      onImpact: (hit) => {
        if (hit.type === 'wall' && hit.wall) {
          hit.wall.takeDamage(34, hit.point);
        }
        this.vfx.spawnFireSparks(hit.point, hit.normal, 1.4);
        this.vfx.spawnShockwave(hit.point, 2.1, 0.28, '#ff7a1a');
        this.vfx.addTrauma(0.18);
        disposeBlade();
      },
      onExpire: (p) => {
        this.vfx.spawnFireSparks(p.position, null, 0.85);
        disposeBlade();
      },
    });

    this.manager.addProjectile(proj);
  }

  // ============================================================
  //  2. Click Derecho — Muro Bajo de Fuego (2 cargas, cooldown 2.0s tras lanzar 2.ª, duración 5.0s)
  // ============================================================
  trySecondary(aimPointOrYaw = null) {
    if (this.cooldowns.firewall > 0 || this.firewallCharges <= 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.firewallCharges = Math.max(0, this.firewallCharges - 1);
    if (this.firewallCharges <= 0) {
      this.cooldowns.firewall = 2.0 + this.cooldownBonus;
      this._firewallRecharging = true;
    } else {
      this.cooldowns.firewall = 0;
      this._firewallRecharging = false;
    }

    const yaw =
      typeof aimPointOrYaw === 'number'
        ? aimPointOrYaw
        : aimPointOrYaw && aimPointOrYaw.isVector3
        ? Math.atan2(aimPointOrYaw.x - this.fighter.position.x, aimPointOrYaw.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.52);
    this.fighter.mesh.playAction('guard_wall', 0.55);
    this.manager.notifyAbilityUsed('firewall', this.ownerId);
    if (this.sound) this.sound.playFireWall();

    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const wallWidth = 5.6;
    const wallHeight = 1.15;
    const wallThickness = 0.85;
    const wallDist = 2.8;

    const arena = this.manager.arena || this.arena;
    const pos = this.fighter.position.clone().addScaledVector(forward, wallDist);
    if (arena.clampToPlayableArea) {
      arena.clampToPlayableArea(pos, 2.8);
    }
    const wallY = arena.getGroundHeightAt
      ? arena.getGroundHeightAt(pos.x, this.fighter.position.y + 1.0, pos.z)
      : 0;
    pos.y = Number.isFinite(wallY) ? Math.max(0, wallY) : 0;

    const wallGroup = new THREE.Group();
    wallGroup.name = 'LowFireWall';
    wallGroup.position.copy(pos);
    wallGroup.rotation.y = yaw;

    // Halo incandescente suave en el suelo sin bloques naranjas duros
    const glowGeo = new THREE.PlaneGeometry(wallWidth * 1.16, wallThickness * 1.75);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#ff6a00',
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.y = 0.025;
    glowMesh.userData.noOutline = true;
    wallGroup.add(glowMesh);

    const bedGeo = new THREE.CylinderGeometry(wallThickness * 0.45, wallThickness * 0.55, wallWidth * 0.95, 10, 1);
    bedGeo.rotateZ(Math.PI / 2);
    bedGeo.scale(1, 0.14, 1);
    const bedMesh = new THREE.Mesh(bedGeo, this._mats.emberMat);
    bedMesh.position.y = 0.02;
    bedMesh.userData.noOutline = true;
    wallGroup.add(bedMesh);

    // Cortina continua de 15 llamas entrelazadas de alturas variables (sin borde negro)
    const tonguesCount = 15;
    const tongues = [];
    for (let i = 0; i < tonguesCount; i++) {
      const u = i / (tonguesCount - 1) - 0.5;
      const x = u * (wallWidth - 0.35);
      const zOff = Math.sin(i * 1.8) * 0.16;
      const waveHeight = 0.82 + 0.34 * Math.abs(Math.sin(i * 1.45));
      const centerBoost = 1.05 - Math.abs(u) * 0.3;
      const h = waveHeight * centerBoost * (wallHeight / 1.0);
      const rad = 0.3 + (i % 3) * 0.05;
      const bend = (i % 2 === 0 ? 1 : -1) * 0.22;

      const flame = createLayeredFlame(rad, h, i * 1.9 + 0.5, bend);
      flame.group.position.set(x, 0.02, zOff);
      wallGroup.add(flame.group);
      tongues.push({ flame, phase: i * 1.35, baseY: 0.02 });
    }

    this.scene.add(wallGroup);
    this.vfx.spawnHeatMark(pos, 2.3, 1.0);
    this.vfx.spawnFireSparks(pos.clone().setY(0.4), new THREE.Vector3(0, 1, 0), 1.4);
    this.vfx.addTrauma(0.18);

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const halfW = wallWidth * 0.5;
    const halfT = wallThickness * 0.5;
    const lifetime = 5.0;
    let age = 0;
    let sparkTimer = 0;
    const hitCooldowns = new Map();

    const disposeWall = () => {
      this.scene.remove(wallGroup);
      bedGeo.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      for (const t of tongues) t.flame.dispose();
    };

    const fireWallHazard = {
      alive: true,
      tag: 'fire_wall',
      ownerId: this.ownerId,
      position: pos.clone(),
      halfWidth: halfW,
      halfThickness: halfT,
      containsPoint2D: (x, z, margin = 0) => {
        const dx = x - pos.x;
        const dz = z - pos.z;
        const lx = dx * cosY - dz * sinY;
        const lz = dx * sinY + dz * cosY;
        return Math.abs(lx) <= halfW + margin && Math.abs(lz) <= halfT + margin;
      },
      dispose: () => {
        if (!fireWallHazard.alive) return;
        fireWallHazard.alive = false;
        disposeWall();
      },
      update: (dt) => {
        age += dt;
        if (age >= lifetime) {
          fireWallHazard.dispose();
          return;
        }

        // Actualiza cooldowns por objetivo (1.0s)
        for (const [fid, rem] of hitCooldowns.entries()) {
          if (rem - dt <= 0) hitCooldowns.delete(fid);
          else hitCooldowns.set(fid, rem - dt);
        }

        // Aparición y desvanecimiento suave + oleaje vivo de las 10 lenguas
        const intro = Math.min(1, age / 0.14);
        const outro = age > lifetime - 0.45 ? Math.max(0, (lifetime - age) / 0.45) : 1;
        const lifeScale = intro * outro;
        glowMat.opacity = 0.55 * lifeScale * (0.85 + 0.15 * Math.sin(age * 14));

        for (const t of tongues) {
          const sy = (0.82 + 0.34 * Math.sin(age * 16 + t.phase)) * lifeScale;
          const sx = (0.94 + 0.14 * Math.cos(age * 12 + t.phase)) * lifeScale;
          t.flame.group.scale.set(sx, Math.max(0.05, sy), sx);
          t.flame.group.rotation.z = Math.sin(age * 11 + t.phase) * 0.12;
          t.flame.update(age, t.phase);
        }

        // Chispas ascendentes constantes durante los 5.0s
        sparkTimer += dt;
        if (sparkTimer >= 0.08) {
          sparkTimer = 0;
          const randX = (Math.random() - 0.5) * wallWidth * 0.85;
          const sp = new THREE.Vector3(
            pos.x + randX * cosY,
            0.35 + Math.random() * 0.4,
            pos.z - randX * sinY
          );
          this.vfx.spawnFireSparks(sp, new THREE.Vector3(0, 1, 0), 0.5);
        }

        // Trampa / control de zona: NO frena proyectiles, pero quema y empuja rivales que la toquen
        for (const f of this.manager.fighters) {
          if (!this.manager.isHostile(this.ownerId, f) || hitCooldowns.has(f.id)) continue;
          const dx = f.position.x - pos.x;
          const dz = f.position.z - pos.z;
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;

          if (
            Math.abs(lx) <= halfW + f.config.radius &&
            Math.abs(lz) <= halfT + f.config.radius &&
            f.position.y <= wallHeight + 0.35
          ) {
            hitCooldowns.set(f.id, 1.0);
            // Empuje leve hacia atrás respecto al muro
            const pushLocalZ = lz >= 0 ? 1 : -1;
            const pushWorld = new THREE.Vector3(
              pushLocalZ * sinY,
              0.24,
              pushLocalZ * cosY
            ).normalize();

            f.takeDamage(8, pushWorld, 5.5, this.ownerId);
            f.applyBurn(2.0, 4.5, this.ownerId);

            const hitPt = f.position.clone().setY(f.position.y + 0.9);
            this.vfx.spawnFireSparks(hitPt, pushWorld, 1.25);
            this.vfx.addTrauma(0.14);
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 8, hitPt);
          }
        }
      },
      getHitbox: () => null,
    };

    this.manager.addFireWall(fireWallHazard);
    return true;
  }

  // ============================================================
  //  3. Tecla Q — Abanico de Llamas Mejorado (cooldown 4.5s, 7 chorros, 9.5u, 65°)
  // ============================================================
  trySkill1(aimPointOrYaw = null) {
    if (this.cooldowns.flamefan > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.flamefan = 4.5 + this.cooldownBonus;

    const yaw =
      typeof aimPointOrYaw === 'number'
        ? aimPointOrYaw
        : aimPointOrYaw && aimPointOrYaw.isVector3
        ? Math.atan2(aimPointOrYaw.x - this.fighter.position.x, aimPointOrYaw.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.55);
    this.fighter.mesh.playAction('heavy_throw', 0.52);
    this.manager.notifyAbilityUsed('flamefan', this.ownerId);
    if (this.sound) this.sound.playFlameFan();

    const origin = this.fighter.position.clone();
    origin.y = Math.max(0, origin.y);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    // Oleada expansiva de 7 chorros/lenguas de fuego entrelazadas en un abanico de 65°
    const jetsCount = 7;
    const totalAngleRad = (65 * Math.PI) / 180;
    const halfConeRad = totalAngleRad * 0.5;
    const coneCos = Math.cos(halfConeRad + 0.06);

    const fanGroup = new THREE.Group();
    fanGroup.name = 'FlameFanWave';
    fanGroup.position.set(origin.x, origin.y + 0.25, origin.z);
    this.scene.add(fanGroup);

    const jets = [];
    for (let i = 0; i < jetsCount; i++) {
      const frac = i / (jetsCount - 1) - 0.5; // -0.5..0.5
      const angle = yaw + frac * totalAngleRad;
      const jetDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));

      // Cada chorro es una lengua de fuego volumétrica de 3 capas inclinada hacia adelante
      const flame = createLayeredFlame(0.32, 1.85, i * 1.7 + 0.8, frac * 0.25);
      const pivot = new THREE.Group();
      pivot.rotation.y = angle;
      flame.group.rotation.x = Math.PI * 0.42; // Inclina la llama rasante hacia adelante
      pivot.add(flame.group);
      fanGroup.add(pivot);

      jets.push({ flame, pivot, dir: jetDir, phase: i * 1.1 });
    }

    // Marcas incandescentes en el suelo dentro del abanico
    this.vfx.spawnHeatMark(origin.clone().addScaledVector(forward, 3.2), 2.4, 1.3);
    this.vfx.spawnHeatMark(origin.clone().addScaledVector(forward, 6.2), 2.9, 1.2);
    this.vfx.addTrauma(0.26);

    const disposeFan = () => {
      this.scene.remove(fanGroup);
      for (const j of jets) j.flame.dispose();
    };
    this._cleanups.add(disposeFan);

    const areaScale = this.fighter.survivalMods?.areaMult || 1;
    const maxRange = 9.5 * areaScale;
    const duration = 0.38;
    let elapsed = 0;
    let sparkTimer = 0;
    const hitFighters = new Set();
    const hitWalls = new Set();

    this._tasks.push((dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      if (!this.fighter.isAlive || t >= 1) {
        this._cleanups.delete(disposeFan);
        disposeFan();
        return false;
      }

      const easeOut = 1 - Math.pow(1 - t, 2);
      const curRadius = 1.2 + (maxRange - 1.2) * easeOut;
      const fadeOut = t > 0.72 ? Math.max(0.05, (1 - t) / 0.28) : 1;

      for (const j of jets) {
        const advance = curRadius * 0.72;
        j.pivot.position.set(j.dir.x * advance, 0.35 + Math.sin(t * Math.PI) * 0.25, j.dir.z * advance);
        const pulseY = (0.75 + 0.65 * easeOut) * fadeOut;
        const pulseW = (0.85 + 0.25 * Math.sin(elapsed * 28 + j.phase)) * fadeOut;
        j.flame.group.scale.set(pulseW, pulseY, pulseW);
        j.flame.update(elapsed, j.phase);
      }

      sparkTimer += dt;
      if (sparkTimer >= 0.04) {
        sparkTimer = 0;
        const pick = jets[Math.floor(Math.random() * jets.length)];
        const sPos = origin.clone().addScaledVector(pick.dir, curRadius * 0.85).setY(origin.y + 0.65);
        this.vfx.spawnFireSparks(sPos, pick.dir, 0.85);
      }

      // Colisión en cono contra rivales (16 daño, knockback 11.0, applyBurn 1.5s)
      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f) || hitFighters.has(f.id)) continue;
        const dx = f.position.x - origin.x;
        const dz = f.position.z - origin.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= curRadius + 0.7 && dist >= 0.35 && Math.abs(f.position.y - origin.y) <= 2.2) {
          const dirX = dx / dist;
          const dirZ = dz / dist;
          const dot = dirX * forward.x + dirZ * forward.z;
          if (dot >= coneCos) {
            hitFighters.add(f.id);
            const pushDir = new THREE.Vector3(dirX, 0.25, dirZ).normalize();
            f.takeDamage(16, pushDir, 11.0, this.ownerId);
            f.applyBurn(1.5, 4.5, this.ownerId);
            const hitPt = f.position.clone().setY(f.position.y + 1.0);
            this.vfx.spawnFireSparks(hitPt, pushDir, 1.5);
            this.vfx.spawnShockwave(f.position, 2.3, 0.3, '#ff7a1a');
            if (this.manager.onFighterHit) this.manager.onFighterHit(f, 16, hitPt);
          }
        }
      }

      for (const w of this.manager.getActiveWalls()) {
        if (hitWalls.has(w)) continue;
        const dx = w.position.x - origin.x;
        const dz = w.position.z - origin.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= curRadius + 0.9) {
          const dot = (dx / (dist || 1)) * forward.x + (dz / (dist || 1)) * forward.z;
          if (dot >= coneCos) {
            hitWalls.add(w);
            w.takeDamage(50, w.position.clone().setY(1.0));
          }
        }
      }

      if (this.arena.damageBarrelsInSphere) {
        this.arena.damageBarrelsInSphere(origin.clone().addScaledVector(forward, curRadius * 0.72), 2.2, 15);
      }

      return true;
    });

    return true;
  }

  // ============================================================
  //  4. Tecla E — Propulsión Meteoro Mejorada (cooldown 4.5s, 23 daño, knockback 16.0 + hitstop)
  // ============================================================
  trySkill2(customAimPoint = null) {
    if (this.cooldowns.meteor > 0 || !this.fighter.isAlive || this.fighter.isFrozen) return false;
    this.cooldowns.meteor = 4.5 + this.cooldownBonus;

    const yaw =
      customAimPoint && customAimPoint.isVector3
        ? Math.atan2(customAimPoint.x - this.fighter.position.x, customAimPoint.z - this.fighter.position.z)
        : this.aimProvider.getAimYaw();

    this.fighter.faceDirection(yaw, 0.55);
    this.fighter.mesh.playAction('heavy_throw', 0.6);
    this.manager.notifyAbilityUsed('meteor', this.ownerId);
    if (this.sound) this.sound.playMeteorDash();

    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const { coreMat, midMat, outerMat } = this._mats;

    // Cabeza de meteoro esculpida en 3 capas concéntricas + estelas espirales de fuego
    const meteorGroup = new THREE.Group();
    meteorGroup.name = 'MeteorFlameHead';

    const coreGeo = createMeteorHeadGeometry(0.56, 1.7, 1.0);
    const midGeo = createMeteorHeadGeometry(0.78, 2.1, 2.3);
    const outerGeo = createMeteorHeadGeometry(0.96, 2.45, 3.7);

    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.z = 0.2;
    coreMesh.userData.noOutline = true;
    coreMesh.renderOrder = 1;

    const midMesh = new THREE.Mesh(midGeo, midMat);
    midMesh.position.z = 0.08;
    midMesh.userData.noOutline = true;
    midMesh.renderOrder = 2;

    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.renderOrder = 1;
    outerMesh.userData.noOutline = true;

    meteorGroup.add(outerMesh, midMesh, coreMesh);

    // 4 estelas de lenguas espirales naranja/rojo rodeando el fuselaje del meteoro
    const ribbonFlames = [];
    for (let i = 0; i < 4; i++) {
      const rf = createLayeredFlame(0.24, 1.25, i * 2.1, 0.22);
      const a = (i / 4) * Math.PI * 2;
      rf.group.position.set(Math.cos(a) * 0.58, Math.sin(a) * 0.58, -0.35);
      rf.group.rotation.x = -Math.PI * 0.48;
      rf.group.rotation.z = a;
      meteorGroup.add(rf.group);
      ribbonFlames.push(rf);
    }

    this.scene.add(meteorGroup);

    const disposeMeteor = () => {
      this.scene.remove(meteorGroup);
      coreGeo.dispose();
      midGeo.dispose();
      outerGeo.dispose();
      for (const rf of ribbonFlames) rf.dispose();
    };
    this._cleanups.add(disposeMeteor);

    const dashDuration = 0.38;
    const dashSpeed = 25.0;
    let elapsed = 0;
    let trailTimer = 0;

    const detonate = () => {
      this._cleanups.delete(disposeMeteor);
      disposeMeteor();

      const groundCenter = this.fighter.position.clone().addScaledVector(fwd, 0.9);
      groundCenter.y = Math.max(0, this.fighter.position.y);
      const blastCenter = groundCenter.clone().setY(groundCenter.y + 0.9);

      if (this.sound) this.sound.playFireExplosion();
      // Nova ígnea de doble anillo + columnas de fuego ascendentes + marca de calor
      this.vfx.spawnHeatMark(groundCenter, 3.6, 1.4);
      this.vfx.spawnShockwave(groundCenter, 4.8, 0.42, '#ff6a00');
      this.vfx.spawnShockwave(groundCenter, 3.2, 0.3, '#fff3a1');
      this.vfx.spawnFireSparks(blastCenter, new THREE.Vector3(0, 1, 0), 2.1);
      this.vfx.addTrauma(0.5);

      this._spawnNovaColumns(groundCenter);

      const areaScale = this.fighter.survivalMods?.areaMult || 1;
      const blastRadius = 3.8 * areaScale;
      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f)) continue;
        const d = Math.hypot(f.position.x - groundCenter.x, f.position.z - groundCenter.z);
        if (d <= blastRadius) {
          const pushDir = new THREE.Vector3(
            f.position.x - this.fighter.position.x,
            0.35,
            f.position.z - this.fighter.position.z
          );
          if (pushDir.lengthSq() < 1e-4) pushDir.copy(fwd).setY(0.35);
          pushDir.normalize();
          f.takeDamage(23, pushDir, 16.0, this.ownerId);
          f.applyBurn(2.0, 4.5, this.ownerId);
          const hitPt = f.position.clone().setY(f.position.y + 1.0);
          if (this.manager.onFighterHit) this.manager.onFighterHit(f, 23, hitPt);
          if (this.manager.onHitstop) this.manager.onHitstop(0.055);
        }
      }

      for (const w of this.manager.getActiveWalls()) {
        if (Math.hypot(w.position.x - groundCenter.x, w.position.z - groundCenter.z) <= blastRadius) {
          w.takeDamage(95, blastCenter);
        }
      }

      if (this.arena.damageBarrelsInSphere) {
        this.arena.damageBarrelsInSphere(groundCenter, blastRadius, 20);
      }
    };

    this._tasks.push((dt) => {
      if (!this.fighter.isAlive) {
        this._cleanups.delete(disposeMeteor);
        disposeMeteor();
        return false;
      }

      elapsed += dt;
      const arena = this.manager.arena || this.arena;
      const nextX = this.fighter.position.x + fwd.x * dashSpeed * dt;
      const nextZ = this.fighter.position.z + fwd.z * dashSpeed * dt;

      if (!arena.isOutOfBounds || !arena.isOutOfBounds(nextX, nextZ, 1.2)) {
        this.fighter.position.x = nextX;
        this.fighter.position.z = nextZ;
        arena.resolveCollisions(
          this.fighter.position,
          this.fighter.config.radius,
          this.fighter.velocity,
          this.fighter.position.y
        );
      }

      meteorGroup.position.set(
        this.fighter.position.x + fwd.x * 0.45,
        this.fighter.position.y + 1.02,
        this.fighter.position.z + fwd.z * 0.45
      );
      meteorGroup.rotation.y = yaw;
      meteorGroup.rotation.z += dt * 14;
      for (let i = 0; i < ribbonFlames.length; i++) {
        ribbonFlames[i].update(elapsed, i * 1.4);
      }

      // Rastro de brasas en el suelo y chispas detrás del meteoro
      trailTimer += dt;
      if (trailTimer >= 0.045) {
        trailTimer = 0;
        const emberPos = this.fighter.position.clone().setY(Math.max(0, this.fighter.position.y));
        this.vfx.spawnHeatMark(emberPos, 1.15, 0.75);
        this.vfx.spawnFireSparks(emberPos.clone().setY(emberPos.y + 0.55), fwd.clone().negate(), 0.9);
      }

      for (const f of this.manager.fighters) {
        if (!this.manager.isHostile(this.ownerId, f)) continue;
        if (Math.hypot(f.position.x - this.fighter.position.x, f.position.z - this.fighter.position.z) <= 2.15) {
          detonate();
          return false;
        }
      }
      for (const w of this.manager.getActiveWalls()) {
        if (w.containsPoint2D(this.fighter.position.x + fwd.x * 1.1, this.fighter.position.z + fwd.z * 1.1, 0.5)) {
          detonate();
          return false;
        }
      }

      if (elapsed >= dashDuration) {
        detonate();
        return false;
      }
      return true;
    });

    return true;
  }

  /** Columnas de fuego ascendentes y anillos de la Nova Ígnea del Meteoro */
  _spawnNovaColumns(center) {
    const novaGroup = new THREE.Group();
    novaGroup.name = 'MeteorNovaColumns';
    novaGroup.position.copy(center);

    const centralFlame = createLayeredFlame(0.82, 3.2, 1.2, 0.16);
    novaGroup.add(centralFlame.group);

    const pillars = [centralFlame];
    const outerCount = 6;
    for (let i = 0; i < outerCount; i++) {
      const a = (i / outerCount) * Math.PI * 2;
      const pFlame = createLayeredFlame(0.45, 2.25, i * 2.1 + 0.4, 0.22);
      pFlame.group.position.set(Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45);
      pFlame.group.rotation.z = -Math.cos(a) * 0.18;
      pFlame.group.rotation.x = Math.sin(a) * 0.18;
      novaGroup.add(pFlame.group);
      pillars.push(pFlame);
    }

    // Doble anillo 3D ascendente de energía ígnea (sin bordes negros)
    const ring1Geo = new THREE.TorusGeometry(1.4, 0.15, 10, 32);
    ring1Geo.rotateX(Math.PI / 2);
    const ring2Geo = new THREE.TorusGeometry(2.1, 0.11, 10, 32);
    ring2Geo.rotateX(Math.PI / 2);
    const ring1 = new THREE.Mesh(ring1Geo, this._mats.coreMat);
    const ring2 = new THREE.Mesh(ring2Geo, this._mats.midMat);
    ring1.position.y = 0.25;
    ring2.position.y = 0.45;
    ring1.userData.noOutline = true;
    ring2.userData.noOutline = true;
    novaGroup.add(ring1, ring2);

    this.scene.add(novaGroup);

    const disposeNova = () => {
      this.scene.remove(novaGroup);
      ring1Geo.dispose();
      ring2Geo.dispose();
      for (const p of pillars) p.dispose();
    };
    this._cleanups.add(disposeNova);

    const novaLife = 0.48;
    let age = 0;
    this._tasks.push((dt) => {
      age += dt;
      const t = Math.min(1, age / novaLife);
      if (t >= 1) {
        this._cleanups.delete(disposeNova);
        disposeNova();
        return false;
      }
      const grow = Math.min(1, t / 0.28);
      const shrink = t > 0.45 ? 1 - (t - 0.45) / 0.55 : 1;
      const hScale = grow * shrink;

      for (let i = 0; i < pillars.length; i++) {
        const s = Math.max(0.05, hScale * (1 + 0.14 * Math.sin(age * 28 + i)));
        pillars[i].group.scale.set(0.75 + 0.35 * grow, s, 0.75 + 0.35 * grow);
        pillars[i].update(age, i);
      }

      ring1.scale.setScalar(0.6 + t * 2.1);
      ring1.position.y = 0.2 + t * 1.4;
      ring2.scale.setScalar(0.5 + t * 2.3);
      ring2.position.y = 0.15 + t * 0.75;
      return true;
    });
  }
}
