import * as THREE from 'three';

/**
 * ThirdPersonCamera
 * ------------------------------------------------------------
 * Cámara sobre el hombro derecho del personaje.
 *  - Mouse: yaw (horizontal) libre y pitch limitado a [-35°, 60°].
 *    pitch > 0 => cámara elevada mirando hacia abajo.
 *  - El pivote sigue al jugador con interpolación exponencial suave.
 *  - Desplazamiento lateral a la derecha para despejar la mira.
 *  - Evita atravesar el suelo de la arena y los pilares (raycast).
 *  - getAimPoint(): punto del mundo bajo la retícula central.
 *  - Admite un desplazamiento de vibración (screen shake) que no altera
 *    la pose "base" usada para apuntar.
 */

const DEG = Math.PI / 180;

const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _offsetDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _toPivot = new THREE.Vector3();

function isDescendantOf(obj, root) {
  let cur = obj;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parent;
  }
  return false;
}

function isHierarchyVisible(obj) {
  let cur = obj;
  while (cur) {
    if (cur.visible === false) return false;
    cur = cur.parent;
  }
  return true;
}

export class ThirdPersonCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../entities/Player.js').Player} target
   * @param {import('../world/Arena.js').Arena} arena
   */
  constructor(camera, target, arena) {
    this.camera = camera;
    this.target = target;
    this.arena = arena;

    this.yaw = 0; // Dirección de mira: (sin yaw, 0, cos yaw)
    this.pitch = 18 * DEG;
    this.minPitch = -20 * DEG;
    this.maxPitch = 60 * DEG;
    this.sensitivity = 0.0022;

    this.distance = 5.3;
    this.pivotHeight = 2.38;
    this.shoulderOffset = 0;
    this.minFloorClearance = 0.45;

    /** FOV base y boost dinámico (p. ej. +5° al hacer Dash) */
    this.baseFov = camera.fov || 70;
    this._fovBoost = 0;
    this._targetFovBoost = 0;

    /**
     * Proveedor opcional de objetos extra para el raycast de mira
     * (p. ej. muros de tierra activos). Debe devolver un array de Object3D.
     * @type {(() => THREE.Object3D[]) | null}
     */
    this.extraAimTargets = null;

    /** Distancia efectiva tras colisiones (se suaviza al alejarse) */
    this._currentDistance = this.distance;
    /** Pivote suavizado (posición seguida) */
    this._smoothPivot = new THREE.Vector3();
    /** Posición de cámara sin vibración (base para apuntar) */
    this._basePosition = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._aimRaycaster = new THREE.Raycaster();
    this._aimTargets = [];

    this.camera.rotation.order = 'YXZ';
    this.snap();
  }

  /** Cambia el objetivo seguido por la cámara (p. ej. cámara espectador sobre aliado) */
  setTarget(target, snapNow = false) {
    if (!target || this.target === target) return;
    this.target = target;
    if (snapNow) this.snap();
  }

  /** Coloca la cámara instantáneamente detrás del jugador */
  snap() {
    this._smoothPivot.copy(this.target.position);
    this._smoothPivot.y += this.pivotHeight;
    this._currentDistance = this.distance;
    this._applyTransform(0, true);
  }

  /** Dirección exacta de la mira (centro de pantalla), sin vibración */
  getAimDirection(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  /** Dirección horizontal (XZ normalizada) de la cámara */
  getForwardFlat(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /**
   * Punto del mundo bajo la retícula central (`NDC (0, 0)`).
   * Usa la pose base (sin screen shake) para que la puntería no tiemble,
   * ignora la malla del propio jugador y exige impactos a > 2.5 u del jugador.
   * Si apunta al cielo o sin impacto dentro de rango, proyecta a 40 u fijas.
   * @param {number} [maxDistance=80]
   * @param {THREE.Vector3} [out]
   */
  getAimPoint(maxDistance = 80, out = new THREE.Vector3()) {
    this.getAimDirection(_aimDir);
    const origin = this._basePosition;

    const playerPos = this.target ? this.target.position : null;
    const playerRoot = this.target && this.target.mesh ? this.target.mesh.root : null;

    // Proyección mínima sobre el rayo para no tomar impactos detrás del jugador
    let camToPlayerDist = 0;
    if (playerPos) {
      _toPivot.copy(playerPos).sub(origin);
      camToPlayerDist = Math.max(0, _toPivot.dot(_aimDir));
    }

    const targets = this._aimTargets;
    targets.length = 0;
    const mapTargets = this.arena.getRaycastTargets ? this.arena.getRaycastTargets() : this.arena.aimColliders;
    for (const o of mapTargets) targets.push(o);
    if (this.extraAimTargets) {
      for (const o of this.extraAimTargets()) targets.push(o);
    }

    this._aimRaycaster.set(origin, _aimDir);
    this._aimRaycaster.near = 0.2;
    this._aimRaycaster.far = maxDistance;
    const hits = this._aimRaycaster.intersectObjects(targets, true);

    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (!hit.object || !isHierarchyVisible(hit.object)) continue;
      if (hit.object.material && hit.object.material.side === THREE.BackSide) continue;
      if (playerRoot && isDescendantOf(hit.object, playerRoot)) continue;
      if (hit.distance <= camToPlayerDist + 0.25) continue;
      if (playerPos && hit.point.distanceTo(playerPos) <= 2.5) continue;
      return out.copy(hit.point);
    }

    return out.copy(origin).addScaledVector(_aimDir, 40);
  }

  /**
   * Aplica el movimiento del mouse a yaw/pitch (inmediato, mira precisa).
   * Se llama antes de actualizar al jugador para que use el yaw del frame.
   * @param {import('./InputManager.js').InputManager} input
   */
  handleInput(input) {
    const md = input.getMouseDelta();
    const inv = this.target && this.target.isConfused ? -1 : 1;
    this.yaw -= md.x * this.sensitivity * inv;
    this.pitch += md.y * this.sensitivity * inv;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
  }

  /**
   * Activa un impulso temporal de FOV (p. ej. +5° al iniciar un Dash).
   * @param {number} [degrees=5]
   */
  triggerFovBoost(degrees = 5) {
    this._targetFovBoost = Math.max(this._targetFovBoost, degrees);
  }

  /** Sigue al jugador. Llamar después de actualizarlo. */
  update(dt) {
    // --- Interpolación suave de FOV ---
    if (this.target && this.target.isDashing) {
      this._targetFovBoost = Math.max(this._targetFovBoost, 5);
    }
    this._targetFovBoost = Math.max(0, this._targetFovBoost - dt * 16);
    const fovRate = this._targetFovBoost > this._fovBoost ? 22 : 9;
    this._fovBoost += (this._targetFovBoost - this._fovBoost) * (1 - Math.exp(-fovRate * dt));
    const desiredFov = this.baseFov + this._fovBoost;
    if (Math.abs(this.camera.fov - desiredFov) > 0.01) {
      this.camera.fov = desiredFov;
      this.camera.updateProjectionMatrix();
    }

    // --- Pivote suavizado (más rígido en horizontal que en vertical) ---
    _pivot.copy(this.target.position);
    _pivot.y += this.pivotHeight;
    const kH = 1 - Math.exp(-16 * dt);
    const kV = 1 - Math.exp(-9 * dt);
    this._smoothPivot.x += (_pivot.x - this._smoothPivot.x) * kH;
    this._smoothPivot.z += (_pivot.z - this._smoothPivot.z) * kH;
    this._smoothPivot.y += (_pivot.y - this._smoothPivot.y) * kV;

    this._applyTransform(dt, false);
  }

  /**
   * Suma un desplazamiento de vibración sobre la pose base del frame.
   * Llamar después de `update()`.
   * @param {THREE.Vector3} posOffset desplazamiento en espacio mundo
   * @param {number} pitchOffset rad
   * @param {number} yawOffset rad
   * @param {number} rollOffset rad
   */
  applyShake(posOffset, pitchOffset, yawOffset, rollOffset) {
    this.camera.position.copy(this._basePosition).add(posOffset);
    this.camera.rotation.set(-this.pitch + pitchOffset, this.yaw + Math.PI + yawOffset, rollOffset, 'YXZ');
  }

  setArena(arena) {
    this.arena = arena;
  }

  _applyTransform(dt, instant) {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);

    // Dirección desde el pivote hacia la cámara (opuesta a la mira)
    _offsetDir.set(-sy * cp, sp, -cy * cp);
    _right.set(-cy, 0, sy);

    // Punto de hombro: pivote desplazado a la derecha
    const shoulder = _pivot.copy(this._smoothPivot).addScaledVector(_right, this.shoulderOffset);

    // --- Colisión con pilares: acerca la cámara si algo la tapa ---
    let targetDist = this.distance;
    this._raycaster.set(shoulder, _rayDir.copy(_offsetDir));
    this._raycaster.far = this.distance + 0.3;
    const hits = this._raycaster.intersectObjects(this.arena.cameraColliders, false);
    if (hits.length > 0) targetDist = Math.max(0.6, hits[0].distance - 0.3);

    if (instant || targetDist < this._currentDistance) {
      this._currentDistance = targetDist; // Acercarse de inmediato
    } else {
      this._currentDistance += (targetDist - this._currentDistance) * (1 - Math.exp(-5 * dt));
    }

    _desired.copy(shoulder).addScaledVector(_offsetDir, this._currentDistance);

    // --- No atravesar el suelo ni plataformas elevadas de la arena ---
    const insideMap = this.arena.isOutOfBounds
      ? !this.arena.isOutOfBounds(_desired.x, _desired.z, -0.6)
      : Math.hypot(_desired.x, _desired.z) < 30.6;
    const playerAbove = this.target.position.y > -1;
    if (insideMap && playerAbove) {
      const floorH = this.arena.getGroundHeightAt
        ? this.arena.getGroundHeightAt(_desired.x, Math.max(_desired.y + 1.5, 2.5), _desired.z)
        : 0;
      const minY = Math.max(0, Number.isFinite(floorH) ? floorH : 0) + this.minFloorClearance;
      _desired.y = Math.max(_desired.y, minY);
    }

    this._basePosition.copy(_desired);
    this.camera.position.copy(_desired);
    // Orientación paralela a la mira (la retícula central apunta al frente)
    this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0, 'YXZ');
  }
}
