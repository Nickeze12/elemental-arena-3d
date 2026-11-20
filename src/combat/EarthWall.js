import * as THREE from 'three';
import { mulberry32 } from '../world/Arena.js';
import { createToonMaterial, addOutline } from '../utils/ToonMaterial.js';
import {
  ROCK_PALETTE,
  getRockMaterials,
  createStoneSlab,
  createJaggedStalagmite,
} from '../utils/RockGeometry.js';

/**
 * EarthWall
 * ------------------------------------------------------------
 * Muro Tectónico Escalonado Cel-Shaded:
 *  - Falla luminosa en el suelo a todo lo ancho al emerger.
 *  - 5 monolitos principales escalonados (más altos en el centro, crestas
 *    diagonales fracturadas) en 3 tonos de granito (#495059 / #68717c / #8c96a3).
 *  - 4 contrafuertes / rocas menores incrustadas en la base delantera y trasera.
 *  - Grietas visibles progresivas en las caras al recibir daño y colapso en esquirlas.
 */

const RISE_TIME = 0.22;

let shared = null;
function getShared() {
  if (shared) return shared;
  const rock = getRockMaterials();
  shared = {
    graniteShadow: rock.shadowMat,
    graniteMid: rock.midMat,
    graniteLight: rock.highlightMat,
    vein: rock.veinMat,
    ice: createToonMaterial('#5ce1ff', { flatShading: true, transparent: true, opacity: 0.88 }),
    iceAlt: createToonMaterial('#8beeff', { flatShading: true, transparent: true, opacity: 0.88 }),
    iceDark: createToonMaterial('#2ca3d4', { flatShading: true, transparent: true, opacity: 0.9 }),
  };
  return shared;
}

export class EarthWall {
  static WIDTH = 3.2;
  static HEIGHT = 2.4;
  static THICKNESS = 0.6;

  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import('../world/Arena.js').Arena} o.arena
   * @param {import('./VFXManager.js').VFXManager} o.vfx
   * @param {THREE.Vector3} o.position base del muro (sobre el suelo)
   * @param {number} o.yaw orientación (el frente mira hacia (sin yaw, 0, cos yaw))
   * @param {number} [o.lifetime=4.5]
   * @param {number} [o.health=100]
   * @param {string} [o.variant='earth'] 'earth' | 'ice'
   * @param {*} [o.owner]
   */
  constructor(o) {
    this.scene = o.scene;
    this.arena = o.arena;
    this.vfx = o.vfx;
    this.position = o.position.clone();
    this.yaw = o.yaw;
    this.lifetime = o.lifetime ?? 4.5;
    this.maxHealth = o.health ?? 100;
    this.health = this.maxHealth;
    this.variant = o.variant ?? 'earth';
    this.owner = o.owner ?? null;
    this.ownerId = o.ownerId ?? (o.owner && o.owner.id) ?? null;

    this.halfX = EarthWall.WIDTH / 2;
    this.halfZ = EarthWall.THICKNESS / 2;
    this.state = 'rising';
    this.age = 0;
    this.rise = 0;
    this._cos = Math.cos(this.yaw);
    this._sin = Math.sin(this.yaw);

    this._hitJolt = 0;
    this._crackStages = [];

    this._buildMesh();
    this.arena.addObstacle(this);

    const base = this.position;
    const isIce = this.variant === 'ice';
    const rightVec = new THREE.Vector3(this._cos, 0, -this._sin);
    const fissureStart = base.clone().addScaledVector(rightVec, -EarthWall.WIDTH * 0.58);
    if (!isIce && this.vfx.spawnFissureLine) {
      this.vfx.spawnFissureLine(fissureStart, rightVec, EarthWall.WIDTH * 1.16, 2.2, 0.18);
      this.vfx.spawnGroundCrater(base, 1.85, 2.6);
    } else {
      this.vfx.groundBurst(base, 1.35);
    }

    this.vfx.spawnDust(base, {
      count: 18,
      size: 0.95,
      speed: 3.2,
      spread: 1.5,
      life: 1.15,
      color: isIce ? '#bdf4ff' : undefined,
    });
    this.vfx.spawnDebris(base.clone().setY(0.12), {
      count: 16,
      speed: 5.5,
      size: 0.13,
      upBias: 1.5,
      spread: 1.5,
      angular: !isIce,
      color: isIce ? '#6ce4ff' : ROCK_PALETTE.mid,
    });
  }

  _buildMesh() {
    const mats = getShared();
    const isIce = this.variant === 'ice';
    const toneMats = isIce
      ? [mats.iceDark, mats.ice, mats.iceAlt]
      : [mats.graniteShadow, mats.graniteMid, mats.graniteLight];
    const darkMat = isIce ? mats.iceDark : mats.graniteShadow;
    const W = EarthWall.WIDTH;
    const H = EarthWall.HEIGHT;
    const T = EarthWall.THICKNESS;
    const rng = mulberry32(Math.floor(Math.random() * 1e9));

    this.group = new THREE.Group();
    this.group.name = isIce ? 'IceWall' : 'EarthWall';
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;

    this.body = new THREE.Group();
    this.group.add(this.body);

    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const main = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), proxyMat);
    main.position.y = H * 0.5;
    main.userData.noOutline = true;
    this.body.add(main);
    this.mainMesh = main;

    // 5 monolitos principales escalonados (más altos al centro, crestas diagonales fracturadas)
    const slabHeights = [1.85, 2.26, 2.58, 2.22, 1.82];
    const crestSlopes = [-0.95, -0.55, 0.25, 0.6, 0.95];
    const pillarsCount = 5;
    const slotW = W / pillarsCount;

    for (let i = 0; i < pillarsCount; i++) {
      const colX = -W / 2 + slotW * (i + 0.5);
      const colH = slabHeights[i] + (rng() - 0.5) * 0.1;
      const colW = slotW * (1.06 + (rng() - 0.5) * 0.08);
      const colT = T * (0.96 + rng() * 0.18);

      const slabGeo = createStoneSlab(colW, colH, colT, rng() * 1000 + i * 31, crestSlopes[i]);
      const mat = toneMats[i === 2 ? 2 : i % 2 === 0 ? 0 : 1];
      const slabMesh = new THREE.Mesh(slabGeo, mat);
      slabMesh.position.set(colX, 0, (rng() - 0.5) * 0.06);
      slabMesh.rotation.z = (i - 2) * -0.032 + (rng() - 0.5) * 0.04;
      slabMesh.rotation.x = (rng() - 0.5) * 0.05;
      slabMesh.rotation.y = (rng() - 0.5) * 0.1;
      this.body.add(slabMesh);

      // Laja de filo claro escalonada adosada para remarcar estratificación
      if (!isIce && i >= 1 && i <= 3) {
        const capH = colH * (0.34 + rng() * 0.12);
        const capGeo = createStoneSlab(colW * 0.72, capH, colT * 0.55, rng() * 700 + i, -crestSlopes[i]);
        const capMesh = new THREE.Mesh(capGeo, mats.graniteLight);
        capMesh.position.set(colX + (rng() - 0.5) * 0.08, colH * 0.56, (i % 2 === 0 ? 1 : -1) * colT * 0.22);
        capMesh.rotation.z = (rng() - 0.5) * 0.12;
        this.body.add(capMesh);
      }
    }

    // 4 contrafuertes / rocas menores incrustadas en la base delantera (2) y trasera (2)
    const buttressConfigs = [
      { x: -0.78, z: T * 0.52, leanX: -0.34, h: 1.05, r: 0.34 },
      { x: 0.72, z: T * 0.5, leanX: -0.3, h: 1.15, r: 0.36 },
      { x: -0.68, z: -T * 0.52, leanX: 0.32, h: 1.08, r: 0.35 },
      { x: 0.82, z: -T * 0.5, leanX: 0.34, h: 0.96, r: 0.32 },
    ];
    for (let i = 0; i < buttressConfigs.length; i++) {
      const cfg = buttressConfigs[i];
      const butGeo = i % 2 === 0
        ? createStoneSlab(cfg.r * 1.9, cfg.h, cfg.r * 1.4, rng() * 800 + i * 23, i < 2 ? 0.6 : -0.6)
        : createJaggedStalagmite(cfg.h, cfg.r, rng() * 800 + i * 41);
      const butMesh = new THREE.Mesh(butGeo, i % 2 === 0 ? toneMats[0] : toneMats[1]);
      butMesh.position.set(cfg.x, -0.05, cfg.z);
      butMesh.rotation.set(cfg.leanX, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.22);
      this.body.add(butMesh);
    }

    // Vetas ámbar sutiles en la base de fractura (sólo tierra)
    if (!isIce) {
      for (let i = 0; i < 2; i++) {
        const veinGeo = createStoneSlab(0.42, 0.26, 0.1, rng() * 400 + i, 0.4);
        const vein = new THREE.Mesh(veinGeo, mats.vein);
        vein.position.set((i === 0 ? -0.45 : 0.42), 0.08, (i === 0 ? 1 : -1) * T * 0.46);
        vein.rotation.z = (i === 0 ? 0.35 : -0.32);
        vein.userData.noOutline = true;
        this.body.add(vein);
      }
    }

    // Grietas dentadas en zigzag adheridas a los monolitos centrales (ocultas hasta recibir daño)
    this._crackMat = new THREE.MeshBasicMaterial({
      color: isIce ? '#d9faff' : '#1b2028',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const buildZigzagCrack = (len, thick) => {
      const shape = new THREE.Shape();
      const segs = 4;
      const dx = len / segs;
      const pts = [];
      for (let s = 0; s <= segs; s++) {
        const px = -len * 0.5 + s * dx;
        const py = s === 0 || s === segs ? 0 : (s % 2 === 0 ? 1 : -1) * 0.065;
        pts.push([px, py]);
      }
      shape.moveTo(pts[0][0], pts[0][1] - thick * 0.3);
      for (let s = 1; s < pts.length; s++) shape.lineTo(pts[s][0], pts[s][1] + thick * 0.5);
      for (let s = pts.length - 1; s >= 0; s--) shape.lineTo(pts[s][0], pts[s][1] - thick * 0.5);
      shape.closePath();
      return new THREE.ShapeGeometry(shape);
    };

    const crackConfigs = [
      { x: -0.58, y: 1.15, z: T * 0.44, rotZ: 0.48, w: 0.44, threshold: 0.8 },
      { x: 0.52, y: 1.25, z: -T * 0.44, rotZ: -0.52, w: 0.44, threshold: 0.8 },
      { x: 0.02, y: 1.35, z: T * 0.48, rotZ: -0.35, w: 0.54, threshold: 0.55 },
      { x: -0.04, y: 0.92, z: -T * 0.48, rotZ: 0.42, w: 0.52, threshold: 0.55 },
      { x: 0.58, y: 0.9, z: T * 0.44, rotZ: -0.68, w: 0.42, threshold: 0.3 },
      { x: -0.56, y: 0.98, z: -T * 0.44, rotZ: 0.65, w: 0.42, threshold: 0.3 },
    ];
    for (const cc of crackConfigs) {
      const crackGeo = buildZigzagCrack(cc.w, 0.045);
      const crackMesh = new THREE.Mesh(crackGeo, this._crackMat);
      crackMesh.position.set(cc.x, cc.y, cc.z);
      crackMesh.rotation.z = cc.rotZ;
      crackMesh.visible = false;
      crackMesh.userData.noOutline = true;
      this.body.add(crackMesh);
      this._crackStages.push({ mesh: crackMesh, threshold: cc.threshold });
    }

    // Escombros de granito o cristales de hielo en la base
    for (let i = 0; i < 8; i++) {
      const r = 0.14 + rng() * 0.14;
      const rockGeo = createStoneSlab(r * 1.45, r * 1.0, r * 1.3, rng() * 500 + i * 19, 0.4);
      const rock = new THREE.Mesh(rockGeo, i % 2 === 0 ? darkMat : toneMats[1]);
      rock.position.set(
        (rng() - 0.5) * W * 1.04,
        -0.04,
        (rng() > 0.5 ? 1 : -1) * (T * 0.54 + rng() * 0.22)
      );
      rock.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.4);
      this.group.add(rock);
    }

    this.group.traverse((o) => {
      if (o.isMesh && !o.userData.noOutline) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    addOutline(this.group, 0.014, isIce ? 0x102838 : ROCK_PALETTE.outline);

    this.body.position.y = -H;
    this.scene.add(this.group);
  }

  /** Altura actual de la parte superior (sobre la base) */
  get currentHeight() {
    return EarthWall.HEIGHT * THREE.MathUtils.clamp(this.rise, 0, 1);
  }

  /** ¿Bloquea cosas? (ya emergió lo suficiente y no está destruido) */
  get isSolid() {
    return (this.state === 'rising' || this.state === 'active') && this.rise > 0.3;
  }

  get alive() {
    return this.state !== 'dead';
  }

  update(dt) {
    if (this.state === 'dead') return;
    this.age += dt;

    if (this.state === 'rising') {
      const t = Math.min(1, this.age / RISE_TIME);
      const c1 = 1.6;
      const c3 = c1 + 1;
      this.rise = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      if (t >= 1) {
        this.rise = 1;
        this.state = 'active';
      }
    } else if (this.state === 'active') {
      const remaining = this.lifetime - this.age;
      let shakeX = 0;
      if (this._hitJolt > 0) {
        this._hitJolt = Math.max(0, this._hitJolt - dt);
        shakeX += (Math.random() - 0.5) * 0.09 * (this._hitJolt / 0.14);
      }
      if (remaining < 0.5) {
        const k = (0.5 - remaining) / 0.5;
        shakeX += (Math.random() - 0.5) * 0.06 * k;
      }
      this.body.position.x = shakeX;
      if (this.age >= this.lifetime) this.crumble();
    }
    this.body.position.y = -EarthWall.HEIGHT * (1 - this.rise);
  }

  takeDamage(amount, point) {
    if (!this.isSolid) return false;
    this.health -= amount;
    this._hitJolt = 0.14;
    const ratio = Math.max(0, this.health / this.maxHealth);
    for (const s of this._crackStages) {
      if (ratio <= s.threshold) s.mesh.visible = true;
    }
    if (point) {
      this.vfx.rockImpact(point, null, 0.7);
      this.vfx.spawnDebris(point, {
        count: 6,
        speed: 4.5,
        size: 0.11,
        angular: true,
        color: this.variant === 'ice' ? '#8beeff' : ROCK_PALETTE.highlight,
      });
    }
    if (this.health <= 0) {
      this.crumble();
      return true;
    }
    return false;
  }

  crumble() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const h = this.currentHeight;
    const center = new THREE.Vector3(this.position.x, this.position.y + h / 2, this.position.z);
    this.vfx.crumbleBox(
      center,
      this.halfX,
      Math.max(0.2, h / 2),
      this.halfZ,
      this.yaw,
      54,
      this.variant === 'ice' ? '#6ce4ff' : null
    );
    this.vfx.spawnDust(this.position, { count: 16, size: 1.15, speed: 2.4, spread: 1.6, life: 1.4, alpha: 0.55 });
    this.dispose();
  }

  dispose() {
    this.arena.removeObstacle(this);
    this.scene.remove(this.group);
    if (this._crackMat) this._crackMat.dispose();
    const disposed = new Set();
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && !disposed.has(o.geometry)) {
        disposed.add(o.geometry);
        o.geometry.dispose();
      }
    });
  }

  // ============================================================
  //  Geometría de colisión (OBB)
  // ============================================================

  _toLocal(x, z, out) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    out.x = dx * this._cos - dz * this._sin;
    out.z = dx * this._sin + dz * this._cos;
    return out;
  }

  _dirToWorld(lx, lz, out) {
    out.x = lx * this._cos + lz * this._sin;
    out.z = -lx * this._sin + lz * this._cos;
    return out;
  }

  containsPoint2D(x, z, margin = 0) {
    if (!this.isSolid) return false;
    const l = this._toLocal(x, z, _local);
    return Math.abs(l.x) <= this.halfX + margin && Math.abs(l.z) <= this.halfZ + margin;
  }

  intersectSphere(center, radius) {
    if (!this.isSolid) return null;
    const l = this._toLocal(center.x, center.z, _local);
    const ly = center.y - this.position.y;
    const h = this.currentHeight;
    const cx = THREE.MathUtils.clamp(l.x, -this.halfX, this.halfX);
    const cy = THREE.MathUtils.clamp(ly, 0, h);
    const cz = THREE.MathUtils.clamp(l.z, -this.halfZ, this.halfZ);
    const dx = l.x - cx;
    const dy = ly - cy;
    const dz = l.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius * radius) return null;

    let nx, ny, nz;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      nx = dx / d;
      ny = dy / d;
      nz = dz / d;
    } else {
      const px = this.halfX - Math.abs(l.x);
      const pz = this.halfZ - Math.abs(l.z);
      const py = h - ly;
      nx = ny = nz = 0;
      if (pz <= px && pz <= py) nz = Math.sign(l.z) || 1;
      else if (px <= py) nx = Math.sign(l.x) || 1;
      else ny = 1;
    }
    const normal = new THREE.Vector3();
    this._dirToWorld(nx, nz, normal);
    normal.y = ny;
    normal.normalize();
    const wp = this._dirToWorld(cx, cz, new THREE.Vector3());
    const point = new THREE.Vector3(this.position.x + wp.x, this.position.y + cy, this.position.z + wp.z);
    return { point, normal };
  }

  resolveCylinder(pos, radius, vel, prevY) {
    if (!this.isSolid) return;
    const top = this.position.y + this.currentHeight;
    if (prevY >= top - 0.05) return;
    if (pos.y + 1.8 < this.position.y) return;

    const l = this._toLocal(pos.x, pos.z, _local);
    const cx = THREE.MathUtils.clamp(l.x, -this.halfX, this.halfX);
    const cz = THREE.MathUtils.clamp(l.z, -this.halfZ, this.halfZ);
    let dx = l.x - cx;
    let dz = l.z - cz;
    let dist = Math.hypot(dx, dz);
    let push;
    if (dist > 1e-6) {
      if (dist >= radius) return;
      push = radius - dist;
      dx /= dist;
      dz /= dist;
    } else {
      const px = this.halfX - Math.abs(l.x);
      const pz = this.halfZ - Math.abs(l.z);
      if (pz <= px) {
        dx = 0;
        dz = Math.sign(l.z) || 1;
        push = pz + radius;
      } else {
        dx = Math.sign(l.x) || 1;
        dz = 0;
        push = px + radius;
      }
    }
    const n = this._dirToWorld(dx, dz, _n);
    pos.x += n.x * push;
    pos.z += n.z * push;
    if (vel) {
      const vn = vel.x * n.x + vel.z * n.z;
      if (vn < 0) {
        vel.x -= vn * n.x;
        vel.z -= vn * n.z;
      }
    }
  }

  getTopAt(x, z, prevY) {
    if (!this.isSolid || this.rise < 0.95) return -Infinity;
    const top = this.position.y + this.currentHeight;
    if (prevY < top - 0.05) return -Infinity;
    const l = this._toLocal(x, z, _local);
    if (Math.abs(l.x) <= this.halfX && Math.abs(l.z) <= this.halfZ) return top;
    return -Infinity;
  }
}

const _local = { x: 0, z: 0 };
const _n = { x: 0, z: 0 };
