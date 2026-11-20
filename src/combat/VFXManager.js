import * as THREE from 'three';

/**
 * VFXManager
 * ------------------------------------------------------------
 * Efectos visuales ligeros y reutilizables por cualquier elemento:
 *  - Escombros: InstancedMesh con pool fijo, física simple (gravedad,
 *    rebote en el suelo de la arena) y encogimiento al final de su vida.
 *  - Polvo: un único THREE.Points con shader propio (tamaño y opacidad
 *    por partícula, niebla y tone mapping) y pool fijo.
 *  - Ondas de choque: anillos planos que se expanden y desvanecen.
 *  - Camera trauma: vibración de cámara proporcional a trauma² que decae.
 *
 * Todas las partículas se reciclan automáticamente al morir (sin
 * creación de objetos por frame).
 */

const DEBRIS_CAPACITY = 500;
const DUST_CAPACITY = 900;
const GRAVITY = 22;
const DEFAULT_BOUNDS_RADIUS = 30;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _shakePos = new THREE.Vector3();

export class VFXManager {
  /** @param {THREE.Scene} scene */
  constructor(scene, arena = null) {
    this.scene = scene;
    this.arena = arena;
    this.time = 0;

    this._initDebris();
    this._initDust();
    this._shockwaves = [];
    this._shockGeo = new THREE.RingGeometry(0.85, 1, 48, 1);
    this._shockGeo.rotateX(-Math.PI / 2);

    this._cracks = [];
    this._crackGeo = new THREE.PlaneGeometry(2, 2);
    this._crackGeo.rotateX(-Math.PI / 2);
    this._crackTex = createCrackRingTexture();

    this._craters = [];
    this._craterTex = createCraterTexture();
    this._craterGlowTex = createCraterGlowTexture();
    this._fissures = [];

    this._waterWakes = [];
    this._waterWakeGeo = new THREE.PlaneGeometry(1, 1);
    this._waterWakeGeo.rotateX(-Math.PI / 2);
    this._waterWakeTex = createWaterWakeTexture();
    this._frostCrystals = [];
    this._frostCrystalGeo = new THREE.OctahedronGeometry(0.11, 0);
    this._frostCrystalGeo.scale(0.55, 1.6, 0.55);

    this._windSwirls = [];
    this._windSwirlGeo = new THREE.PlaneGeometry(2, 2);
    this._windSwirlGeo.rotateX(-Math.PI / 2);
    this._windSwirlTex = createWindSwirlTexture();
    this._airStreaks = [];
    this._airStreakGeo = new THREE.PlaneGeometry(0.14, 0.95);
    this._airStreakGeo.rotateX(Math.PI / 2);

    // --- Camera trauma ---
    this.trauma = 0;
    this.maxShakeOffset = 0.35; // unidades
    this.maxShakeAngle = 0.035; // rad
  }

  // ============================================================
  //  Escombros (InstancedMesh)
  // ============================================================
  _initDebris() {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, DEBRIS_CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'VFX_Debris';
    // Inicializa el buffer de color por instancia
    for (let i = 0; i < DEBRIS_CAPACITY; i++) mesh.setColorAt(i, _c.set('#8a7358'));
    mesh.count = 0;
    this.scene.add(mesh);
    this.debrisMesh = mesh;

    /** Pool de partículas (datos en JS, render en instancias) */
    this.debris = [];
    for (let i = 0; i < DEBRIS_CAPACITY; i++) {
      this.debris.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        size: 0.1,
        aspect: new THREE.Vector3(1, 0.8, 1),
        life: 0,
        maxLife: 1,
        color: new THREE.Color(),
      });
    }
    this._debrisCursor = 0;
  }

  _acquire(pool, cursorKey) {
    // Busca una partícula libre a partir del cursor; si no hay, recicla la más antigua
    const n = pool.length;
    for (let k = 0; k < n; k++) {
      const i = (this[cursorKey] + k) % n;
      if (!pool[i].alive) {
        this[cursorKey] = (i + 1) % n;
        return pool[i];
      }
    }
    const p = pool[this[cursorKey]];
    this[cursorKey] = (this[cursorKey] + 1) % n;
    return p;
  }

  /**
   * Lanza fragmentos de roca.
   * @param {THREE.Vector3} position
   * @param {object} [o]
   * @param {number} [o.count=10]
   * @param {number} [o.speed=6] velocidad media
   * @param {number} [o.size=0.12] tamaño medio
   * @param {THREE.Vector3} [o.normal] dirección preferente (hemisferio)
   * @param {number} [o.upBias=0.6] componente vertical extra
   * @param {number} [o.spread=0.3] radio de aparición
   * @param {THREE.ColorRepresentation} [o.color]
   */
  spawnDebris(position, o = {}) {
    const count = o.count ?? 10;
    const speed = o.speed ?? 6;
    const size = o.size ?? 0.12;
    const upBias = o.upBias ?? 0.6;
    const spread = o.spread ?? 0.3;
    const base = _c.set(o.color ?? '#8a7358');
    for (let i = 0; i < count; i++) {
      const d = this._acquire(this.debris, '_debrisCursor');
      d.alive = true;
      d.pos.set(
        position.x + (Math.random() - 0.5) * spread * 2,
        position.y + Math.random() * spread,
        position.z + (Math.random() - 0.5) * spread * 2
      );
      // Dirección aleatoria en esfera, sesgada por la normal y hacia arriba
      d.vel.randomDirection();
      if (o.normal) {
        if (d.vel.dot(o.normal) < 0) d.vel.reflect(o.normal);
        d.vel.addScaledVector(o.normal, 0.6);
      }
      d.vel.y += upBias;
      d.vel.normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.8));
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      d.size = size * (o.angular ? 0.35 + Math.random() * 1.25 : 0.5 + Math.random() * 0.9);
      if (o.plank) {
        d.aspect.set(2.15, 0.28, 0.68);
      } else if (o.angular) {
        const mode = i % 3;
        if (mode === 0) d.aspect.set(1.65, 0.42, 0.78);
        else if (mode === 1) d.aspect.set(0.62, 1.55, 0.85);
        else d.aspect.set(1.25, 0.7, 1.15);
      } else {
        d.aspect.set(1, 0.8, 1);
      }
      d.maxLife = (o.life ?? 0.9) + Math.random() * 0.9;
      d.life = d.maxLife;
      const shade = 0.75 + Math.random() * 0.4;
      d.color.copy(base).multiplyScalar(shade);
    }
  }

  setArena(arena) {
    this.arena = arena;
  }

  _isInsideBounds(x, z, margin = 0) {
    if (this.arena && this.arena.isOutOfBounds) {
      return !this.arena.isOutOfBounds(x, z, margin);
    }
    return Math.hypot(x, z) <= DEFAULT_BOUNDS_RADIUS - margin;
  }

  _getSurfaceY(x, z, hintY = 1.5) {
    if (this.arena && this.arena.getGroundHeightAt) {
      const h = this.arena.getGroundHeightAt(x, Math.max(0.5, hintY + 0.8), z);
      if (Number.isFinite(h)) return h;
    }
    return 0;
  }

  _updateDebris(dt) {
    const mesh = this.debrisMesh;
    let n = 0;
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.life -= dt;
      if (d.life <= 0 || d.pos.y < -30) {
        d.alive = false;
        continue;
      }
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);

      // Rebote contra el suelo de la arena
      const onArena = this._isInsideBounds(d.pos.x, d.pos.z, 0);
      if (onArena && d.pos.y < d.size && d.pos.y > -1) {
        d.pos.y = d.size;
        if (d.vel.y < 0) d.vel.y *= -0.32;
        d.vel.x *= 0.62;
        d.vel.z *= 0.62;
        d.spin.multiplyScalar(0.7);
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;

      // Encoge durante el último 35% de vida
      const t = d.life / d.maxLife;
      const scale = d.size * Math.min(1, t / 0.35);
      _q.setFromEuler(_e.copy(d.rot));
      _s.set(scale * d.aspect.x, scale * d.aspect.y, scale * d.aspect.z);
      _m4.compose(d.pos, _q, _s);
      mesh.setMatrixAt(n, _m4);
      mesh.setColorAt(n, d.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ============================================================
  //  Polvo (THREE.Points con shader)
  // ============================================================
  _initDust() {
    const geo = new THREE.BufferGeometry();
    this._dustPos = new Float32Array(DUST_CAPACITY * 3);
    this._dustColor = new Float32Array(DUST_CAPACITY * 3);
    this._dustSize = new Float32Array(DUST_CAPACITY);
    this._dustAlpha = new Float32Array(DUST_CAPACITY);
    geo.setAttribute('position', new THREE.BufferAttribute(this._dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this._dustColor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this._dustSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this._dustAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexColors: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uScale: { value: 400 } },
      ]),
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = aAlpha;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          // Bola de polvo suave con borde irregular sutil
          float soft = smoothstep(0.5, 0.0, d);
          float n = 0.85 + 0.15 * sin(atan(c.y, c.x) * 5.0 + vAlpha * 9.0);
          gl_FragColor = vec4(vColor, vAlpha * soft * soft * n);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    points.name = 'VFX_Dust';
    this.scene.add(points);
    this.dustPoints = points;

    this.dust = [];
    for (let i = 0; i < DUST_CAPACITY; i++) {
      this.dust.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        size0: 1,
        size1: 2,
        alpha: 0.6,
        drag: 2,
        rise: 0.6,
        life: 0,
        maxLife: 1,
        color: new THREE.Color(),
      });
    }
    this._dustCursor = 0;
  }

  /**
   * Nube de polvo.
   * @param {THREE.Vector3} position
   * @param {object} [o]
   * @param {number} [o.count=8]
   * @param {number} [o.speed=2.5]
   * @param {number} [o.size=0.8] tamaño inicial (crece x2.2)
   * @param {number} [o.life=1.1]
   * @param {number} [o.spread=0.4]
   * @param {number} [o.alpha=0.55]
   * @param {boolean} [o.ring=false] si es true, se expande en anillo horizontal
   * @param {THREE.Vector3} [o.direction] velocidad base añadida
   * @param {THREE.ColorRepresentation} [o.color]
   */
  spawnDust(position, o = {}) {
    const count = o.count ?? 8;
    const speed = o.speed ?? 2.5;
    const size = o.size ?? 0.8;
    const life = o.life ?? 1.1;
    const spread = o.spread ?? 0.4;
    const alpha = o.alpha ?? 0.55;
    // Mezcla ocre / gris para variedad natural
    const colA = new THREE.Color(o.color ?? '#b89468');
    const colB = new THREE.Color('#9a8f84');
    for (let i = 0; i < count; i++) {
      const d = this._acquire(this.dust, '_dustCursor');
      d.alive = true;
      if (o.ring) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        d.pos.set(position.x + cx * spread, position.y + 0.15, position.z + cz * spread);
        d.vel.set(cx * speed, 0.3 + Math.random() * 0.6, cz * speed);
      } else {
        d.pos.set(
          position.x + (Math.random() - 0.5) * spread * 2,
          position.y + Math.random() * spread * 0.5,
          position.z + (Math.random() - 0.5) * spread * 2
        );
        d.vel.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
        d.vel.y = Math.abs(d.vel.y) * 0.6 + 0.3;
      }
      if (o.direction) d.vel.add(o.direction);
      d.size0 = size * (0.7 + Math.random() * 0.6);
      d.size1 = d.size0 * 2.2;
      d.alpha = alpha * (0.7 + Math.random() * 0.3);
      d.drag = 2.2;
      d.rise = 0.5;
      d.maxLife = life * (0.75 + Math.random() * 0.5);
      d.life = d.maxLife;
      d.color.copy(colA).lerp(colB, Math.random() * 0.6);
    }
  }

  _updateDust(dt) {
    let n = 0;
    const pos = this._dustPos;
    const col = this._dustColor;
    const size = this._dustSize;
    const alpha = this._dustAlpha;
    for (const d of this.dust) {
      if (!d.alive) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        continue;
      }
      const drag = Math.exp(-d.drag * dt);
      d.vel.multiplyScalar(drag);
      d.vel.y += d.rise * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < 0.05 && this._isInsideBounds(d.pos.x, d.pos.z, 0)) d.pos.y = 0.05;

      const t = 1 - d.life / d.maxLife; // 0 -> 1
      pos[n * 3] = d.pos.x;
      pos[n * 3 + 1] = d.pos.y;
      pos[n * 3 + 2] = d.pos.z;
      col[n * 3] = d.color.r;
      col[n * 3 + 1] = d.color.g;
      col[n * 3 + 2] = d.color.b;
      size[n] = d.size0 + (d.size1 - d.size0) * (1 - (1 - t) * (1 - t));
      // Aparición rápida y desvanecimiento suave
      alpha[n] = d.alpha * Math.min(1, t / 0.08) * Math.pow(1 - t, 1.4);
      n++;
    }
    const geo = this.dustPoints.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  // ============================================================
  //  Ondas de choque
  // ============================================================

  /**
   * Anillo plano que se expande sobre el suelo.
   * @param {THREE.Vector3} position
   * @param {number} radius radio final
   * @param {number} [duration=0.5]
   */
  spawnShockwave(position, radius, duration = 0.5, color = '#e8d2a8') {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this._shockGeo, mat);
    mesh.position.copy(position);
    mesh.position.y += 0.06;
    mesh.scale.setScalar(0.1);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this._shockwaves.push({ mesh, radius, time: 0, duration });
  }

  _updateShockwaves(dt) {
    for (let i = this._shockwaves.length - 1; i >= 0; i--) {
      const s = this._shockwaves[i];
      s.time += dt;
      const t = s.time / s.duration;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this._shockwaves.splice(i, 1);
        continue;
      }
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      s.mesh.scale.setScalar(Math.max(0.01, e * s.radius));
      s.mesh.material.opacity = 0.7 * (1 - t);
    }
  }

  // ============================================================
  //  Anillos de grietas en el suelo y chispas direccionales
  // ============================================================

  /**
   * Anillo de grietas / fractura en el suelo al emerger tierra.
   * @param {THREE.Vector3} position
   * @param {number} [radius=1.4]
   * @param {number} [duration=1.1]
   * @param {THREE.ColorRepresentation} [color='#3d2b1c']
   */
  spawnGroundCrack(position, radius = 1.4, duration = 1.1, color = '#3d2b1c') {
    if (!this._isInsideBounds(position.x, position.z, 0.3)) return;
    const mat = new THREE.MeshBasicMaterial({
      map: this._crackTex,
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(this._crackGeo, mat);
    const groundY = this._getSurfaceY(position.x, position.z, position.y);
    mesh.position.set(position.x, groundY + 0.03, position.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(radius * 0.25);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this._cracks.push({ mesh, radius, time: 0, duration });
  }

  _updateCracks(dt) {
    for (let i = this._cracks.length - 1; i >= 0; i--) {
      const c = this._cracks[i];
      c.time += dt;
      const t = c.time / c.duration;
      if (t >= 1) {
        this.scene.remove(c.mesh);
        c.mesh.material.dispose();
        this._cracks.splice(i, 1);
        continue;
      }
      // Aparición rápida y desvanecimiento suave
      const grow = Math.min(1, c.time / 0.12);
      const ease = 1 - (1 - grow) * (1 - grow);
      c.mesh.scale.setScalar(c.radius * (0.25 + 0.75 * ease));
      c.mesh.material.opacity = 0.9 * Math.pow(1 - t, 1.3);
    }
  }

  /**
   * Cráter tectónico estilizado en el suelo con grietas radiales oscuras y
   * un brillo ámbar/naranja breve que se enfría gradualmente.
   * @param {THREE.Vector3} position
   * @param {number} [radius=1.6]
   * @param {number} [duration=2.5]
   */
  spawnGroundCrater(position, radius = 1.6, duration = 2.5) {
    if (!this._isInsideBounds(position.x, position.z, 0.35)) return;

    const group = new THREE.Group();
    const groundY = this._getSurfaceY(position.x, position.z, position.y);
    group.position.set(position.x, groundY + 0.028, position.z);
    group.rotation.y = Math.random() * Math.PI * 2;
    group.scale.setScalar(radius * 0.25);

    const darkMat = new THREE.MeshBasicMaterial({
      map: this._craterTex,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const darkMesh = new THREE.Mesh(this._crackGeo, darkMat);
    darkMesh.renderOrder = 1;
    group.add(darkMesh);

    const glowMat = new THREE.MeshBasicMaterial({
      map: this._craterGlowTex,
      color: '#ff9b26',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const glowMesh = new THREE.Mesh(this._crackGeo, glowMat);
    glowMesh.position.y = 0.006;
    glowMesh.renderOrder = 2;
    group.add(glowMesh);

    this.scene.add(group);
    this._craters.push({ group, darkMat, glowMat, radius, time: 0, duration });
  }

  _updateCraters(dt) {
    for (let i = this._craters.length - 1; i >= 0; i--) {
      const c = this._craters[i];
      c.time += dt;
      const t = c.time / c.duration;
      if (t >= 1) {
        this.scene.remove(c.group);
        c.darkMat.dispose();
        c.glowMat.dispose();
        this._craters.splice(i, 1);
        continue;
      }

      const grow = Math.min(1, c.time / 0.1);
      const ease = 1 - (1 - grow) * (1 - grow);
      c.group.scale.setScalar(c.radius * (0.25 + 0.75 * ease));

      // Brillo ámbar breve que se enfría gradualmente en los primeros 0.8s
      const coolT = Math.min(1, c.time / Math.min(0.85, c.duration * 0.45));
      c.glowMat.opacity = 0.9 * Math.pow(1 - coolT, 1.6);
      c.glowMat.color.set('#d9721e').lerp(new THREE.Color('#ffb84d'), 1 - coolT);

      // Cráter oscuro permanece firme y se desvanece al final
      const fadeT = Math.max(0, (t - 0.55) / 0.45);
      c.darkMat.opacity = 0.94 * (1 - fadeT * fadeT);
    }
  }

  /**
   * Traza una grieta dentada y luminosa en el suelo a lo largo de `direction`.
   * @param {THREE.Vector3} startPos
   * @param {THREE.Vector3} direction
   * @param {number} [length=12]
   * @param {number} [duration=1.8]
   * @param {number} [revealDuration=0.28]
   */
  spawnFissureLine(startPos, direction, length = 12, duration = 1.8, revealDuration = 0.28) {
    const dir = direction.clone().setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);

    const segments = Math.max(8, Math.round(length * 2.2));
    const stepLen = length / segments;

    const pts = [];
    let jitter = 0;
    for (let i = 0; i <= segments; i++) {
      const dist = i * stepLen;
      if (i > 0 && i < segments) {
        const sign = i % 2 === 0 ? 1 : -1;
        jitter = sign * (0.1 + Math.random() * 0.22);
      } else {
        jitter = 0;
      }
      const p = startPos.clone().addScaledVector(dir, dist).addScaledVector(right, jitter);
      if (!this._isInsideBounds(p.x, p.z, 0.4)) {
        if (pts.length === 0) return;
        break;
      }
      pts.push(p);
    }
    if (pts.length < 2) return;

    const buildRibbonGeo = (halfWidthStart, halfWidthEnd) => {
      const positions = [];
      const uvs = [];
      const indices = [];
      const nPts = pts.length;

      for (let i = 0; i < nPts; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(nPts - 1, i + 1)];
        const tang = next.clone().sub(prev);
        if (tang.lengthSq() < 1e-6) tang.copy(dir);
        tang.normalize();
        const perpX = -tang.z;
        const perpZ = tang.x;

        const prog = i / (nPts - 1);
        const taper = Math.sin(Math.min(1, prog * 5) * (Math.PI * 0.5)) * (1 - prog * 0.45);
        const hw = THREE.MathUtils.lerp(halfWidthStart, halfWidthEnd, prog) * (0.65 + 0.35 * taper);

        positions.push(p.x - perpX * hw, 0, p.z - perpZ * hw);
        positions.push(p.x + perpX * hw, 0, p.z + perpZ * hw);
        uvs.push(0, prog, 1, prog);

        if (i < nPts - 1) {
          const baseIdx = i * 2;
          indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
          indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    const outerGeo = buildRibbonGeo(0.28, 0.15);
    const innerGeo = buildRibbonGeo(0.11, 0.05);
    const totalIndices = outerGeo.index.count;

    const outerMat = new THREE.MeshBasicMaterial({
      color: '#1b2028',
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: '#ff9b26',
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });

    const group = new THREE.Group();
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.y = 0.032;
    outerMesh.renderOrder = 1;
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.position.y = 0.038;
    innerMesh.renderOrder = 2;

    if (revealDuration > 0) {
      outerGeo.setDrawRange(0, 0);
      innerGeo.setDrawRange(0, 0);
    }

    group.add(outerMesh, innerMesh);
    this.scene.add(group);
    this._fissures.push({
      group,
      outerGeo,
      innerGeo,
      outerMat,
      innerMat,
      totalIndices,
      revealDuration,
      time: 0,
      duration,
    });
  }

  _updateFissures(dt) {
    for (let i = this._fissures.length - 1; i >= 0; i--) {
      const f = this._fissures[i];
      f.time += dt;
      const t = f.time / f.duration;
      if (t >= 1) {
        this.scene.remove(f.group);
        f.outerGeo.dispose();
        f.innerGeo.dispose();
        f.outerMat.dispose();
        f.innerMat.dispose();
        this._fissures.splice(i, 1);
        continue;
      }

      if (f.revealDuration > 0) {
        const rev = Math.min(1, f.time / f.revealDuration);
        const triCount = Math.floor((f.totalIndices / 3) * rev) * 3;
        f.outerGeo.setDrawRange(0, triCount);
        f.innerGeo.setDrawRange(0, triCount);
      }

      // El brillo ámbar se enfría hacia ocre oscuro antes de apagarse la grieta
      const coolT = Math.min(1, f.time / (f.duration * 0.6));
      f.innerMat.color.set('#6e4825').lerp(new THREE.Color('#ffb347'), 1 - coolT);
      f.innerMat.opacity = 0.95 * Math.pow(1 - t, 1.35);

      const fadeT = Math.max(0, (t - 0.5) / 0.5);
      f.outerMat.opacity = 0.92 * (1 - fadeT * fadeT);
    }
  }

  /**
   * Chispas / esquirlas direccionales de alta velocidad en el punto de impacto
   * contra un luchador o al fracturar un muro.
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3} [direction]
   * @param {number} [scale=1]
   * @param {THREE.ColorRepresentation} [color='#ffcf70']
   */
  spawnHitSparks(point, direction, scale = 1, color = '#ffcf70') {
    this.spawnDebris(point, {
      count: Math.round(12 * scale),
      speed: 10.5 * Math.sqrt(scale),
      size: 0.065 * scale,
      normal: direction,
      upBias: 0.35,
      spread: 0.12 * scale,
      color,
    });
    this.spawnDust(point, {
      count: Math.round(6 * scale),
      size: 0.48 * scale,
      speed: 3.5 * scale,
      life: 0.55,
      color: '#ffe0a3',
      alpha: 0.7,
    });
  }

  // ============================================================
  //  Combinaciones de alto nivel
  // ============================================================

  /** Impacto de roca: esquirlas angulares variadas + polvo + esquirlas direccionales */
  rockImpact(point, normal, scale = 1) {
    this.spawnDebris(point, {
      count: Math.round(7 * scale),
      speed: 6.4 * Math.sqrt(scale),
      size: 0.11 * scale,
      normal,
      spread: 0.16 * scale,
      angular: true,
      color: '#68717c',
    });
    this.spawnDebris(point, {
      count: Math.round(5 * scale),
      speed: 7.2 * Math.sqrt(scale),
      size: 0.08 * scale,
      normal,
      spread: 0.18 * scale,
      angular: true,
      color: '#495059',
    });
    this.spawnHitSparks(point, normal, 0.7 * scale);
    this.spawnDust(point, { count: Math.round(5 + 4 * scale), size: 0.6 * scale, speed: 2 * scale, life: 0.9 });
  }

  /** Tierra que se abre en el suelo (al levantar roca, muro o pincho) */
  groundBurst(point, scale = 1) {
    _p.copy(point);
    _p.y = Math.max(0, _p.y);
    this.spawnGroundCrack(_p, 1.15 * scale, 1.0 + 0.25 * scale);
    this.spawnDebris(_p, {
      count: Math.round(6 * scale),
      speed: 4.5 * scale,
      size: 0.08 * scale,
      upBias: 1.5,
      spread: 0.25 * scale,
    });
    this.spawnDust(_p, {
      count: Math.round(7 * scale),
      size: 0.6 * scale,
      speed: 2.2 * scale,
      life: 0.85,
      ring: true,
      spread: 0.2 * scale,
    });
  }

  /** Muro / objeto que se desmorona: volumen de escombros angulares variados + esquirlas */
  crumbleBox(center, halfX, halfY, halfZ, yaw, count = 40, color = null) {
    this.spawnHitSparks(center, new THREE.Vector3(0, 1, 0), 1.3, color || '#e9b865');
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const tones = ['#495059', '#68717c', '#8c96a3'];
    for (let i = 0; i < count; i++) {
      const lx = (Math.random() * 2 - 1) * halfX;
      const ly = (Math.random() * 2 - 1) * halfY;
      const lz = (Math.random() * 2 - 1) * halfZ;
      _p.set(center.x + lx * c + lz * s, center.y + ly, center.z - lx * s + lz * c);
      this.spawnDebris(_p, {
        count: 1,
        speed: 3.6 + Math.random() * 2.2,
        size: 0.14 + Math.random() * 0.14,
        upBias: 0.55,
        spread: 0.08,
        angular: true,
        color: color || tones[i % tones.length],
      });
      if (i % 4 === 0) this.spawnDust(_p, { count: 1, size: 1.0, speed: 1.1, life: 1.3, alpha: 0.45 });
    }
  }

  /**
   * Salpicadura de agua Cel-Shaded: gotas azul/blanco con gravedad + anillo de espuma en el suelo.
   * @param {THREE.Vector3} position
   * @param {number} [count=12]
   */
  spawnWaterSplash(position, count = 12) {
    const half = Math.max(2, Math.floor(count / 2));
    this.spawnDebris(position, {
      count: half,
      speed: 6.2,
      size: 0.085,
      upBias: 1.15,
      spread: 0.35,
      color: '#38b6ff',
    });
    this.spawnDebris(position, {
      count: count - half,
      speed: 5.4,
      size: 0.075,
      upBias: 1.0,
      spread: 0.3,
      color: '#eaf8ff',
    });
    this.spawnDust(position, {
      count: Math.max(4, Math.floor(count * 0.6)),
      size: 0.55,
      speed: 2.6,
      life: 0.5,
      spread: 0.35,
      color: '#eaf8ff',
      alpha: 0.78,
    });
    const groundPos = position.clone();
    groundPos.y = Math.max(0, groundPos.y < 1.8 ? 0 : groundPos.y);
    if (groundPos.y === 0) {
      this.spawnShockwave(groundPos, 1.55, 0.32, '#eaf8ff');
    }
  }

  /**
   * Estallido de esquirlas de hielo: fragmentos angulares celestes al impactar lanzas o descongelarse.
   * @param {THREE.Vector3} position
   * @param {number} [count=16]
   */
  spawnIceShatter(position, count = 16) {
    const half = Math.max(2, Math.floor(count * 0.6));
    this.spawnDebris(position, {
      count: half,
      speed: 8.8,
      size: 0.095,
      upBias: 0.85,
      spread: 0.28,
      color: '#5ce1ff',
    });
    this.spawnDebris(position, {
      count: count - half,
      speed: 7.5,
      size: 0.08,
      upBias: 0.9,
      spread: 0.25,
      color: '#eaf8ff',
    });
    this.spawnDust(position, {
      count: Math.max(5, Math.floor(count * 0.5)),
      size: 0.62,
      speed: 3.2,
      life: 0.55,
      spread: 0.3,
      color: '#bfefff',
      alpha: 0.8,
    });
    const groundPos = position.clone().setY(0);
    this.spawnShockwave(groundPos, 2.1, 0.3, '#8beeff');
  }

  /**
   * Estela húmeda de agua y espuma en el piso por donde pasa el Maremoto o azota el Látigo.
   * @param {THREE.Vector3} position
   * @param {number} [width=2.2]
   * @param {number} [duration=1.6]
   * @param {number} [yaw=0]
   */
  spawnWaterWake(position, width = 2.2, duration = 1.6, yaw = 0) {
    if (!this._isInsideBounds(position.x, position.z, 0.3)) return;
    const mat = new THREE.MeshBasicMaterial({
      map: this._waterWakeTex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(this._waterWakeGeo, mat);
    const groundY = this._getSurfaceY(position.x, position.z, position.y);
    mesh.position.set(position.x, groundY + 0.034, position.z);
    mesh.rotation.y = yaw;
    mesh.scale.set(width * 0.65, 1, Math.max(0.95, width * 0.36));
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this._waterWakes.push({ mesh, width, time: 0, duration });
  }

  _updateWaterWakes(dt) {
    for (let i = this._waterWakes.length - 1; i >= 0; i--) {
      const w = this._waterWakes[i];
      w.time += dt;
      const t = w.time / w.duration;
      if (t >= 1) {
        this.scene.remove(w.mesh);
        w.mesh.material.dispose();
        this._waterWakes.splice(i, 1);
        continue;
      }
      const spread = 1 + 0.35 * (1 - (1 - t) * (1 - t));
      w.mesh.scale.set(w.width * spread, 1, Math.max(1.0, w.width * 0.42) * spread);
      w.mesh.material.opacity = 0.88 * Math.pow(1 - t, 1.4);
    }
  }

  /**
   * Libera pequeños cristales romboidales celestes y vaho frío detrás de las Lanzas de Hielo.
   * @param {THREE.Vector3} position
   */
  spawnFrostTrail(position) {
    const count = 2;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? '#80edff' : '#f0fbff',
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._frostCrystalGeo, mat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.42,
        position.y + (Math.random() - 0.5) * 0.36,
        position.z + (Math.random() - 0.5) * 0.42
      );
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.scale.setScalar(0.75 + Math.random() * 0.55);
      this.scene.add(mesh);
      this._frostCrystals.push({
        mesh,
        velY: 0.35 + Math.random() * 0.45,
        spin: (Math.random() - 0.5) * 10,
        time: 0,
        duration: 0.4 + Math.random() * 0.2,
      });
    }

    this.spawnDust(position, {
      count: 2,
      size: 0.38,
      speed: 1.2,
      life: 0.38,
      spread: 0.16,
      color: '#d8f8ff',
      alpha: 0.78,
    });
  }

  _updateFrostCrystals(dt) {
    for (let i = this._frostCrystals.length - 1; i >= 0; i--) {
      const c = this._frostCrystals[i];
      c.time += dt;
      const t = c.time / c.duration;
      if (t >= 1) {
        this.scene.remove(c.mesh);
        c.mesh.material.dispose();
        this._frostCrystals.splice(i, 1);
        continue;
      }
      c.mesh.position.y += c.velY * dt;
      c.mesh.rotation.y += c.spin * dt;
      c.mesh.rotation.x += c.spin * 0.6 * dt;
      const s = 1 - t * t;
      c.mesh.scale.setScalar(Math.max(0.05, s));
      c.mesh.material.opacity = 0.92 * (1 - t);
    }
  }

  /**
   * Doble anillo concéntrico de agua y gotas saliendo disparadas al impactar o activar habilidades.
   * @param {THREE.Vector3} position
   * @param {number} [radius=2.0]
   */
  spawnAquaBurst(position, radius = 2.0) {
    const ringPos = position.clone();
    ringPos.y = Math.max(0.02, ringPos.y);
    this.spawnShockwave(ringPos, radius, 0.34, '#00b4d8');
    this.spawnShockwave(ringPos, radius * 0.68, 0.26, '#f0fbff');
    this.spawnDebris(position, {
      count: 10,
      speed: 7.2,
      size: 0.08,
      upBias: 1.15,
      spread: 0.28,
      angular: true,
      color: '#00b4d8',
    });
    this.spawnDebris(position, {
      count: 6,
      speed: 6.4,
      size: 0.068,
      upBias: 1.25,
      spread: 0.24,
      angular: true,
      color: '#f0fbff',
    });
    this.spawnDust(position, {
      count: 8,
      size: 0.52,
      speed: 3.0,
      life: 0.45,
      spread: 0.3,
      color: '#f0fbff',
      alpha: 0.82,
    });
  }

  /**
   * Chispas y brasas de fuego ascendentes Cel-Shaded.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3 | null} [direction]
   * @param {number} [scale=1]
   */
  spawnFireSparks(position, direction = null, scale = 1) {
    this.spawnDebris(position, {
      count: Math.max(4, Math.round(8 * scale)),
      speed: 7.5 * Math.sqrt(scale),
      size: 0.055 * scale,
      normal: direction || undefined,
      upBias: 1.25,
      spread: 0.22 * scale,
      color: Math.random() > 0.4 ? '#ff8c1a' : '#fff3a1',
    });
    this.spawnDust(position, {
      count: Math.max(3, Math.round(5 * scale)),
      size: 0.52 * scale,
      speed: 2.8 * scale,
      life: 0.45,
      spread: 0.2 * scale,
      color: Math.random() > 0.35 ? '#ff6a00' : '#ffcf48',
      alpha: 0.85,
    });
  }

  /**
   * Marca incandescente / anillo de calor temporal en el suelo.
   * @param {THREE.Vector3} position
   * @param {number} [radius=1.5]
   * @param {number} [duration=1.1]
   */
  spawnHeatMark(position, radius = 1.5, duration = 1.1) {
    this.spawnGroundCrack(position, radius, duration, '#ff6210');
    this.spawnShockwave(position, radius * 1.15, 0.36, '#ffaa28');
  }

  /**
   * Anillos horizontales de aire girando y desvaneciéndose rápido al saltar, lanzar o impactar.
   * @param {THREE.Vector3} position
   * @param {number} [radius=1.5]
   */
  spawnWindSwirl(position, radius = 1.5) {
    const mat = new THREE.MeshBasicMaterial({
      map: this._windSwirlTex,
      color: '#f7fcff',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this._windSwirlGeo, mat);
    mesh.position.set(position.x, Math.max(0.06, position.y + 0.08), position.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(radius * 0.45);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this._windSwirls.push({ mesh, radius, time: 0, duration: 0.36 });
  }

  _updateWindSwirls(dt) {
    for (let i = this._windSwirls.length - 1; i >= 0; i--) {
      const s = this._windSwirls[i];
      s.time += dt;
      const t = s.time / s.duration;
      if (t >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this._windSwirls.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t);
      s.mesh.rotation.y += dt * 13.5;
      s.mesh.scale.setScalar(s.radius * (0.45 + 0.72 * ease));
      s.mesh.material.opacity = 0.85 * Math.pow(1 - t, 1.3);
    }
  }

  /**
   * Traza líneas / cintas cortas de corriente blanca en el aire para reforzar velocidad y dirección.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3 | null} [direction]
   */
  spawnAirStreak(position, direction = null) {
    const dir = direction ? direction.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const count = 2;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? '#f7fcff' : '#b8f2ff',
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this._airStreakGeo, mat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.75,
        position.y + (Math.random() - 0.5) * 0.55,
        position.z + (Math.random() - 0.5) * 0.75
      );
      mesh.lookAt(mesh.position.clone().add(dir));
      mesh.rotateZ(Math.random() * Math.PI);
      mesh.scale.set(0.7 + Math.random() * 0.4, 1, 0.7 + Math.random() * 0.6);
      this.scene.add(mesh);
      this._airStreaks.push({
        mesh,
        vel: dir.clone().multiplyScalar(8 + Math.random() * 5),
        time: 0,
        duration: 0.22 + Math.random() * 0.08,
      });
    }
  }

  _updateAirStreaks(dt) {
    for (let i = this._airStreaks.length - 1; i >= 0; i--) {
      const a = this._airStreaks[i];
      a.time += dt;
      const t = a.time / a.duration;
      if (t >= 1) {
        this.scene.remove(a.mesh);
        a.mesh.material.dispose();
        this._airStreaks.splice(i, 1);
        continue;
      }
      a.mesh.position.addScaledVector(a.vel, dt);
      a.mesh.scale.z = 1.0 + t * 0.95;
      a.mesh.material.opacity = 0.88 * (1 - t);
    }
  }

  /**
   * Explosión de tablones de madera, aros oscuros y polvo al destruir barriles.
   * @param {THREE.Vector3} position
   */
  spawnWoodDebris(position) {
    const center = position.clone().setY(position.y + 0.55);
    this.spawnDebris(center, {
      count: 14,
      speed: 7.4,
      size: 0.14,
      upBias: 1.2,
      spread: 0.35,
      plank: true,
      color: '#8f5932',
    });
    this.spawnDebris(center, {
      count: 8,
      speed: 6.4,
      size: 0.12,
      upBias: 1.0,
      spread: 0.32,
      plank: true,
      color: '#633a1d',
    });
    this.spawnDebris(center, {
      count: 4,
      speed: 5.8,
      size: 0.1,
      upBias: 0.9,
      spread: 0.25,
      angular: true,
      color: '#343a44',
    });
    this.spawnDust(center, {
      count: 12,
      size: 0.78,
      speed: 3.4,
      spread: 0.42,
      life: 0.75,
      color: '#d9c29c',
      alpha: 0.78,
    });
    this.spawnShockwave(position.clone().setY(0.02), 1.65, 0.32, '#e3be86');
  }

  // ============================================================
  //  Camera trauma
  // ============================================================

  /** Añade trauma de cámara (0..1). La vibración escala con trauma². */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Aplica la vibración sobre la cámara de tercera persona.
   * Ruido suave mediante suma de senos de frecuencias inconmensurables.
   * @param {import('../core/ThirdPersonCamera.js').ThirdPersonCamera} tpCamera
   */
  applyShake(tpCamera) {
    const shake = this.trauma * this.trauma;
    const t = this.time * 32;
    const n = (seed) => Math.sin(t * 1.0 + seed) * 0.6 + Math.sin(t * 2.3 + seed * 1.7) * 0.3 + Math.sin(t * 4.1 + seed * 2.9) * 0.1;
    _shakePos.set(n(1.1), n(2.7), n(4.3)).multiplyScalar(this.maxShakeOffset * shake);
    tpCamera.applyShake(
      _shakePos,
      n(7.1) * this.maxShakeAngle * shake,
      n(9.4) * this.maxShakeAngle * shake,
      n(5.6) * this.maxShakeAngle * shake
    );
  }

  /** Limpia inmediatamente todas las partículas y marcas activas (p. ej. al cambiar de mapa) */
  clearAll() {
    for (const d of this.debris) d.alive = false;
    this.debrisMesh.count = 0;

    for (const d of this.dust) d.alive = false;
    this.dustPoints.geometry.setDrawRange(0, 0);

    const removeMeshes = (arr, disposeMat = true) => {
      for (const item of arr) {
        if (item.mesh) {
          this.scene.remove(item.mesh);
          if (disposeMat && item.mesh.material && item.mesh.material.dispose) item.mesh.material.dispose();
        }
        if (item.group) {
          this.scene.remove(item.group);
        }
      }
      arr.length = 0;
    };

    removeMeshes(this._shockwaves);
    removeMeshes(this._cracks);
    removeMeshes(this._waterWakes);
    removeMeshes(this._frostCrystals, false);
    removeMeshes(this._windSwirls);
    removeMeshes(this._airStreaks);

    for (const c of this._craters) {
      this.scene.remove(c.group);
      if (c.darkMat) c.darkMat.dispose();
      if (c.glowMat) c.glowMat.dispose();
    }
    this._craters.length = 0;

    for (const f of this._fissures) {
      this.scene.remove(f.group);
      if (f.darkGeo) f.darkGeo.dispose();
      if (f.coreGeo) f.coreGeo.dispose();
      if (f.darkMat) f.darkMat.dispose();
      if (f.coreMat) f.coreMat.dispose();
    }
    this._fissures.length = 0;
    this.trauma = 0;
  }

  /** Avanza todas las partículas y decae el trauma */
  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this._updateDebris(dt);
    this._updateDust(dt);
    this._updateShockwaves(dt);
    this._updateCracks(dt);
    this._updateCraters(dt);
    this._updateFissures(dt);
    this._updateWaterWakes(dt);
    this._updateFrostCrystals(dt);
    this._updateWindSwirls(dt);
    this._updateAirStreaks(dt);
  }
}

/** Textura procedural en espiral para anillos horizontales de viento */
function createWindSwirlTexture() {
  const size = 256;
  const c = size / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  for (let arc = 0; arc < 3; arc++) {
    const startA = (arc / 3) * Math.PI * 2;
    g.strokeStyle = arc === 0 ? 'rgba(247, 252, 255, 0.92)' : 'rgba(184, 242, 255, 0.85)';
    g.lineWidth = 7 - arc * 1.2;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const a = startA + u * Math.PI * 1.45;
      const r = size * (0.16 + u * 0.28);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

/** Textura procedural de estela húmeda turquesa/espuma para el piso de la arena */
function createWaterWakeTexture() {
  const w = 256;
  const h = 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');

  // Cuerpo turquesa translúcido en banda curva suave
  const grad = g.createRadialGradient(w * 0.5, h * 0.55, w * 0.05, w * 0.5, h * 0.55, w * 0.48);
  grad.addColorStop(0, 'rgba(0, 180, 216, 0.68)');
  grad.addColorStop(0.55, 'rgba(13, 122, 189, 0.42)');
  grad.addColorStop(1, 'rgba(0, 180, 216, 0.0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // Vetas y rizos de espuma blanca brillante Cel-Shaded
  g.strokeStyle = 'rgba(240, 251, 255, 0.9)';
  for (let row = 0; row < 4; row++) {
    g.lineWidth = 5 - row * 0.9;
    const baseY = h * (0.28 + row * 0.16);
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const x = w * (0.1 + u * 0.8);
      const y = baseY + Math.sin(u * Math.PI * 3 + row * 1.4) * 7;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

/** Genera una textura procedural estilizada Cel-Shaded de cráter oscuro con grietas radiales */
function createCraterTexture() {
  const size = 256;
  const c = size / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  // Sombra interior angulosa del cráter
  g.fillStyle = 'rgba(27, 32, 40, 0.72)';
  g.beginPath();
  const rimPts = 14;
  for (let i = 0; i < rimPts; i++) {
    const a = (i / rimPts) * Math.PI * 2;
    const r = size * (0.2 + (i % 3 === 0 ? 0.04 : -0.02));
    const px = c + Math.cos(a) * r;
    const py = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();

  // Anillo dentado exterior
  g.strokeStyle = 'rgba(30, 35, 43, 0.92)';
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = size * (0.28 + ((i * 7) % 5) * 0.015);
    const px = c + Math.cos(a) * r;
    const py = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();

  // Grietas radiales oscuras con quiebres angulares
  const rays = 11;
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (i % 2) * 0.14;
    let r = size * 0.14;
    g.strokeStyle = 'rgba(24, 28, 35, 0.96)';
    g.lineWidth = 4.2 - (i % 2) * 1.0;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    for (let s = 0; s < 4; s++) {
      r += size * 0.085;
      a += (s % 2 === 0 ? 1 : -1) * 0.16;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

/** Vetas ámbar radiales internas para el brillo inicial del cráter */
function createCraterGlowTexture() {
  const size = 256;
  const c = size / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  const rays = 11;
  g.strokeStyle = '#ffffff';
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (i % 2) * 0.14;
    let r = size * 0.1;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    for (let s = 0; s < 3; s++) {
      r += size * 0.082;
      a += (s % 2 === 0 ? 1 : -1) * 0.16;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.stroke();
  }
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c, c, size * 0.21, 0, Math.PI * 2);
  g.stroke();

  return new THREE.CanvasTexture(cv);
}

/** Genera una textura procedural con anillo y grietas radiales */
function createCrackRingTexture() {
  const size = 256;
  const c = size / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  // Anillo base quebrado
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(c, c, size * 0.26, 0, Math.PI * 2);
  g.stroke();

  // Grietas radiales quebradas
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (i % 2) * 0.12;
    let r = size * 0.12;
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    for (let s = 0; s < 4; s++) {
      r += size * 0.085;
      a += ((s % 2 === 0 ? 1 : -1) * 0.14);
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  return tex;
}
