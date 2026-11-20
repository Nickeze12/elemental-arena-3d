/**
 * InputManager
 * ------------------------------------------------------------
 * Centraliza teclado y mouse:
 *  - Estado de teclas presionadas (`isDown`) y recién presionadas
 *    en el frame actual (`wasPressed`).
 *  - Movimiento relativo del mouse acumulado por frame (PointerLock).
 *  - Botones del mouse (izq = 0, der = 2) mantenidos / recién pulsados,
 *    registrados sólo con PointerLock activo. Menú contextual bloqueado.
 *  - Activación del PointerLock al hacer click sobre el canvas.
 *
 * Uso: llamar a `endFrame()` al final de cada frame para limpiar
 * los estados transitorios.
 */
export class InputManager {
  /** @param {HTMLElement} lockTarget elemento sobre el que se pide PointerLock */
  constructor(lockTarget) {
    this.lockTarget = lockTarget;

    /** Teclas mantenidas (por `KeyboardEvent.code`) */
    this.keysDown = new Set();
    /** Teclas presionadas en este frame */
    this.keysPressed = new Set();

    /** Delta del mouse acumulado desde el último frame */
    this.mouseDelta = { x: 0, y: 0 };

    /** Vector analógico del joystick virtual táctil y delta táctil de cámara */
    this._touchMove = { x: 0, y: 0 };
    this._touchDelta = { x: 0, y: 0 };

    /** Detección automática de pantalla táctil y estado del modo táctil */
    this.isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
    this.isTouchMode = this.isTouchDevice;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('touch-mode', this.isTouchMode);
      document.body.classList.toggle('touch-mode-active', this.isTouchMode);
    }

    /** Botones del mouse mantenidos / pulsados en este frame (sólo con PointerLock) */
    this.mouseDown = new Set();
    this.mousePressed = new Set();

    this.isLocked = false;
    /** Callbacks externos al cambiar el estado del lock */
    this.onLockChange = null;
    /** Callback al activar/desactivar manualmente el modo táctil */
    this.onTouchModeChange = null;

    // Teclas que no deben provocar scroll / acciones del navegador
    this._blocked = new Set([
      'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyM', 'ShiftLeft', 'ShiftRight',
      'F1', 'F2', 'F3',
    ]);

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onClick = this._onClick.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onLockChange);
    lockTarget.addEventListener('click', this._onClick);
  }

  // ---------------- Consultas públicas ----------------

  /** ¿La tecla está mantenida? */
  isDown(code) {
    return this.keysDown.has(code);
  }

  /** ¿La tecla se presionó en este frame? */
  wasPressed(code) {
    return this.keysPressed.has(code);
  }

  /** Alias semántico de `wasPressed` */
  justPressed(code) {
    return this.keysPressed.has(code);
  }

  /** ¿El botón del mouse está mantenido? (0 = izq, 2 = der) */
  isMouseDown(button) {
    return this.mouseDown.has(button);
  }

  /** ¿El botón secundario (Click Der / DEF-ESP táctil) está actualmente mantenido con la mira activa? */
  isSecondaryHeld() {
    return this.isLocked && this.mouseDown.has(2);
  }

  /** ¿El botón del mouse se pulsó en este frame? */
  mouseJustPressed(button) {
    return this.mousePressed.has(button);
  }

  /** Eje de movimiento WASD normalizado en {x: derecha, y: adelante} */
  getMoveAxis() {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW')) y += 1;
    if (this.isDown('KeyS')) y -= 1;
    if (this.isDown('KeyD')) x += 1;
    if (this.isDown('KeyA')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Vector de movimiento combinado (teclado WASD + joystick virtual analógico 360°) */
  getMoveVector() {
    const k = this.getMoveAxis();
    const tx = k.x + this._touchMove.x;
    const ty = k.y + this._touchMove.y;
    const len = Math.hypot(tx, ty);
    if (len > 1) {
      return { x: tx / len, y: ty / len };
    }
    return { x: tx, y: ty };
  }

  /** Actualiza el vector analógico enviado por el joystick virtual táctil */
  setTouchMove(x = 0, y = 0) {
    this._touchMove.x = x;
    this._touchMove.y = y;
  }

  /** Acumula desplazamiento táctil para rotar cámara/mira */
  addTouchCameraDelta(dx = 0, dy = 0) {
    this._touchDelta.x += dx;
    this._touchDelta.y += dy;
  }

  /** Emula pulsación/mantenimiento de tecla virtual desde botones táctiles */
  triggerVirtualKey(code, down = true) {
    if (!code) return;
    if (down) {
      if (!this.keysDown.has(code)) this.keysPressed.add(code);
      this.keysDown.add(code);
    } else {
      this.keysDown.delete(code);
    }
  }

  /** Emula botón de ratón (0 = ataque primario, 2 = secundario) desde botones táctiles */
  triggerVirtualMouse(button, down = true) {
    if (!this.isLocked && down) return;
    if (down) {
      if (!this.mouseDown.has(button)) this.mousePressed.add(button);
      this.mouseDown.add(button);
    } else {
      this.mouseDown.delete(button);
    }
  }

  /** Activa o desactiva manualmente el modo táctil */
  setTouchMode(enabled) {
    const next = !!enabled;
    if (this.isTouchMode === next) return;
    this.isTouchMode = next;
    this.clearTouchInputs();
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('touch-mode', this.isTouchMode);
      document.body.classList.toggle('touch-mode-active', this.isTouchMode);
    }
    if (!this.isTouchMode && this.isLocked && document.pointerLockElement !== this.lockTarget) {
      this.isLocked = false;
      if (this.onLockChange) this.onLockChange(false);
    }
    if (this.onTouchModeChange) this.onTouchModeChange(this.isTouchMode);
  }

  clearTouchInputs() {
    this._touchMove.x = 0;
    this._touchMove.y = 0;
    this._touchDelta.x = 0;
    this._touchDelta.y = 0;
    this.keysDown.clear();
    this.mouseDown.clear();
  }

  /** Devuelve el delta del mouse/táctil acumulado (no lo limpia) */
  getMouseDelta() {
    return {
      x: this.mouseDelta.x + this._touchDelta.x,
      y: this.mouseDelta.y + this._touchDelta.y,
    };
  }

  /** Limpia estados transitorios. Llamar al final de cada frame. */
  endFrame() {
    this.keysPressed.clear();
    this.mousePressed.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this._touchDelta.x = 0;
    this._touchDelta.y = 0;
  }

  requestLock() {
    if (this.isTouchMode) {
      if (!this.isLocked) {
        this.isLocked = true;
        if (this.onLockChange) this.onLockChange(true);
      }
      return;
    }
    if (!this.isLocked && this.lockTarget.requestPointerLock) {
      // requestPointerLock puede devolver una Promise que rechaza si el
      // usuario sale muy rápido; se captura para no ensuciar la consola.
      const p = this.lockTarget.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  /** Libera la entrada activa (pausa táctil o salida de PointerLock) */
  releaseLock() {
    this.clearTouchInputs();
    if (!this.isTouchMode && document.pointerLockElement === this.lockTarget && document.exitPointerLock) {
      document.exitPointerLock();
      return;
    }
    if (this.isLocked) {
      this.isLocked = false;
      if (this.onLockChange) this.onLockChange(false);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.lockTarget.removeEventListener('click', this._onClick);
  }

  // ---------------- Handlers internos ----------------

  _onKeyDown(e) {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (this._blocked.has(e.code)) e.preventDefault();
    if (!this.keysDown.has(e.code)) {
      // Sólo cuenta como "recién presionada" si no es auto-repetición
      if (!e.repeat) this.keysPressed.add(e.code);
    }
    this.keysDown.add(e.code);
  }

  _onKeyUp(e) {
    this.keysDown.delete(e.code);
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;
    this.mouseDelta.x += e.movementX || 0;
    this.mouseDelta.y += e.movementY || 0;
  }

  _onClick() {
    if (this.isTouchMode) return;
    this.requestLock();
  }

  /** Los botones sólo cuentan con PointerLock activo (el click inicial sólo bloquea el puntero) */
  _onMouseDown(e) {
    if (!this.isLocked) return;
    e.preventDefault();
    if (!this.mouseDown.has(e.button)) this.mousePressed.add(e.button);
    this.mouseDown.add(e.button);
  }

  _onMouseUp(e) {
    this.mouseDown.delete(e.button);
  }

  /** Bloquea el menú contextual del click derecho */
  _onContextMenu(e) {
    e.preventDefault();
  }

  _onLockChange() {
    if (this.isTouchMode) return;
    this.isLocked = document.pointerLockElement === this.lockTarget;
    if (!this.isLocked) {
      this.keysDown.clear();
      this.mouseDown.clear();
    }
    if (this.onLockChange) this.onLockChange(this.isLocked);
  }

  /** Al perder el foco se sueltan todas las teclas para evitar "teclas pegadas" */
  _onBlur() {
    this.clearTouchInputs();
    this.keysPressed.clear();
    this.mousePressed.clear();
  }
}
