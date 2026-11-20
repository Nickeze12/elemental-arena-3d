/**
 * TouchControls
 * ------------------------------------------------------------
 * Sistema multi-touch completo para móviles y tablets:
 *  - Mitad izquierda: Joystick virtual flotante (radio 56px, zona muerta 0.12)
 *    que envía un vector analógico 360° a `InputManager.setTouchMove()`.
 *  - Mitad derecha (área libre): Arrastre táctil que envía desplazamientos
 *    suaves `(dx, dy)` a `InputManager.addTouchCameraDelta()` para girar cámara/mira.
 *  - Esquina inferior derecha: Arco de botones Cel-Shaded translúcidos con
 *    rastreo independiente por `touch.identifier` y recarga visual sincronizada:
 *    ATK (primario), DEF/ESP (secundario), Q, E, SALTO, DASH y R (Aura Supervivencia).
 */

const JOYSTICK_RADIUS = 56;
const JOYSTICK_DEADZONE = 0.12;
const CAMERA_DRAG_SCALE = 1.65;

export class TouchControls {
  /**
   * @param {HTMLElement} parentEl contenedor del HUD
   */
  constructor(parentEl) {
    this.input = null;
    this._visible = false;

    this._joyId = null;
    this._joyOriginX = 0;
    this._joyOriginY = 0;

    this._camId = null;
    this._camLastX = 0;
    this._camLastY = 0;
    this._currentElement = 'earth';
    this.onAimingStateChange = null;

    this.root = document.createElement('div');
    this.root.className = 'touch-controls-layer hidden';
    this.root.setAttribute('data-touch-controls', '');

    this.root.innerHTML = `
      <div class="touch-left-zone" data-touch-left-zone>
        <div class="touch-joystick-base hidden" data-touch-joy-base>
          <div class="touch-joystick-ring"></div>
          <div class="touch-joystick-knob" data-touch-joy-knob></div>
        </div>
        <div class="touch-joy-hint">🕹️ MOVER</div>
      </div>

      <div class="touch-look-zone" data-touch-look-zone></div>

      <div id="touch-cancel-cast" class="touch-cancel-cast hidden" data-touch-cancel aria-label="Cancelar habilidad">✕</div>

      <div class="touch-left-actions" data-touch-left-actions>
        <button type="button" class="touch-btn touch-btn-jump ready" data-touch-btn="jump" aria-label="Saltar">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">SALTO</span>
          <span class="touch-btn-cd"></span>
        </button>

        <button type="button" class="touch-btn touch-btn-dash ready" data-touch-btn="dash" aria-label="Dash">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">DASH</span>
          <span class="touch-btn-cd"></span>
        </button>
      </div>

      <div class="touch-action-arc" data-touch-action-arc>
        <button type="button" class="touch-btn touch-btn-atk ready" data-touch-btn="primary" aria-label="Ataque básico">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">ATK</span>
          <span class="touch-btn-sub" data-touch-sub="primary">Básico</span>
          <span class="touch-btn-cd"></span>
        </button>

        <button type="button" class="touch-btn touch-btn-sec ready" data-touch-btn="secondary" aria-label="Habilidad secundaria">
          <span class="touch-btn-fill"></span>
          <span class="ability-charges touch-btn-charges hidden"></span>
          <span class="touch-btn-label">DEF/ESP</span>
          <span class="touch-btn-sub" data-touch-sub="secondary">Sec.</span>
          <span class="touch-btn-cd"></span>
        </button>

        <button type="button" class="touch-btn touch-btn-q ready" data-touch-btn="skill1" aria-label="Habilidad Q">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">Q</span>
          <span class="touch-btn-sub" data-touch-sub="skill1">Hab. 1</span>
          <span class="touch-btn-cd"></span>
        </button>

        <button type="button" class="touch-btn touch-btn-e ready" data-touch-btn="skill2" aria-label="Habilidad E">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">E</span>
          <span class="touch-btn-sub" data-touch-sub="skill2">Hab. 2</span>
          <span class="touch-btn-cd"></span>
        </button>

        <button type="button" class="touch-btn touch-btn-aura locked hidden" data-touch-btn="aura" aria-label="Aura Elemental">
          <span class="touch-btn-fill"></span>
          <span class="touch-btn-label">R</span>
          <span class="touch-btn-sub" data-touch-sub="aura">Aura</span>
          <span class="touch-btn-cd"></span>
        </button>
      </div>
    `;

    this._leftZone = this.root.querySelector('[data-touch-left-zone]');
    this._leftActions = this.root.querySelector('[data-touch-left-actions]');
    this._joyBase = this.root.querySelector('[data-touch-joy-base]');
    this._joyKnob = this.root.querySelector('[data-touch-joy-knob]');
    this._lookZone = this.root.querySelector('[data-touch-look-zone]');
    this._cancelCastEl = this.root.querySelector('[data-touch-cancel]');
    this._actionArc = this.root.querySelector('[data-touch-action-arc]');

    this._buttons = {};
    const specs = [
      { key: 'primary', type: 'mouse', code: 0, aimOnDrag: true, cancellable: false },
      { key: 'secondary', type: 'mouse', code: 2, aimOnDrag: true, cancellable: true },
      { key: 'skill1', type: 'key', code: 'KeyQ', aimOnDrag: true, cancellable: true },
      { key: 'skill2', type: 'key', code: 'KeyE', aimOnDrag: true, cancellable: true },
      { key: 'jump', type: 'key', code: 'Space', aimOnDrag: false, cancellable: false },
      { key: 'dash', type: 'key', code: 'ShiftLeft', aimOnDrag: false, cancellable: false },
      { key: 'aura', type: 'key', code: 'KeyR', aimOnDrag: false, cancellable: false },
    ];
    for (const sp of specs) {
      const el = this.root.querySelector(`[data-touch-btn="${sp.key}"]`);
      const entry = {
        ...sp,
        el,
        fill: el.querySelector('.touch-btn-fill'),
        chargesEl: el.querySelector('.touch-btn-charges'),
        sub: el.querySelector('.touch-btn-sub'),
        cd: el.querySelector('.touch-btn-cd'),
        touchIds: new Set(),
        activeTouch: null,
        _releaseTimer: null,
      };
      this._buttons[sp.key] = entry;
      this._bindButtonEvents(entry);
    }

    this._bindJoystickEvents();
    this._bindCameraLookEvents();

    if (parentEl) {
      parentEl.appendChild(this.root);
    }
  }

  /** @param {string} elementId */
  setElement(elementId) {
    if (elementId) this._currentElement = elementId;
  }

  /** @param {import('../core/InputManager.js').InputManager} input */
  setInput(input) {
    this.input = input;
  }

  setVisible(visible) {
    const next = !!visible;
    if (this._visible === next) return;
    this._visible = next;
    this.root.classList.toggle('hidden', !next);
    if (!next) {
      this.reset();
    }
  }

  /** Suelta joystick, cámara y botones virtuales activos */
  reset() {
    this._joyId = null;
    this._joyBase.classList.add('hidden');
    this._joyKnob.style.transform = 'translate(-50%, -50%)';
    this._camId = null;

    if (this.input) {
      this.input.setTouchMove(0, 0);
    }

    for (const b of Object.values(this._buttons)) {
      if (b._releaseTimer) {
        clearTimeout(b._releaseTimer);
        b._releaseTimer = null;
      }
      if (b.activeTouch) {
        const wasHeldMist = b.key === 'secondary' && this._currentElement === 'storm';
        b.activeTouch = null;
        b.el.classList.remove('pressed', 'btn-aiming');
        if (wasHeldMist) this._emitVirtualAction(b, false);
      }
      if (b.touchIds.size > 0) {
        b.touchIds.clear();
        b.el.classList.remove('pressed', 'btn-aiming');
        this._emitVirtualAction(b, false);
      }
    }
    this._syncAimingVisuals();
  }

  /** Actualiza colores, cooldowns y estado del aura en el arco táctil */
  syncState({ abilities = [], dashReadiness = 1, auraState = null, elementConfig = null } = {}) {
    if (elementConfig) {
      const col = elementConfig.color || '#6be6ff';
      const acc = elementConfig.accent || '#ffe28a';
      this.root.style.setProperty('--touch-color', col);
      this.root.style.setProperty('--touch-accent', acc);
      if (this._actionArc) {
        this._actionArc.style.setProperty('--touch-color', col);
        this._actionArc.style.setProperty('--touch-accent', acc);
      }
    }

    for (const ab of abilities) {
      const btn = this._buttons[ab.slot];
      if (!btn) continue;
      const active = !!ab.active;
      const pct = active
        ? Math.max(0, Math.min(1, ab.activeRatio ?? 0)) * 100
        : Math.max(0, Math.min(1, ab.readiness ?? (ab.ready ? 1 : 0))) * 100;
      if (btn.fill) btn.fill.style.height = `${pct.toFixed(1)}%`;
      btn.el.classList.toggle('mist-active', active);
      btn.el.classList.toggle('ready', !active && !!ab.ready);
      btn.el.classList.toggle('on-cooldown', !active && !ab.ready);
      if (btn.cd) {
        btn.cd.textContent = active
          ? `${Math.max(0, ab.remaining).toFixed(1)}s`
          : ab.ready
            ? ''
            : `${Math.max(0.1, ab.remaining).toFixed(1)}s`;
      }
      if (btn.sub && ab.name) {
        btn.sub.textContent = ab.name.split(' ')[0];
      }
      if (btn.chargesEl) {
        const hasCharges = typeof ab.maxCharges === 'number' && ab.maxCharges > 1;
        btn.chargesEl.classList.toggle('hidden', !hasCharges);
        if (hasCharges) {
          btn.chargesEl.textContent = `${ab.charges}`;
        }
      }
    }

    const dashBtn = this._buttons.dash;
    if (dashBtn) {
      const ready = dashReadiness >= 0.999;
      if (dashBtn.fill) dashBtn.fill.style.height = `${(Math.max(0, Math.min(1, dashReadiness)) * 100).toFixed(1)}%`;
      dashBtn.el.classList.toggle('ready', ready);
      dashBtn.el.classList.toggle('on-cooldown', !ready);
    }

    const auraBtn = this._buttons.aura;
    if (auraBtn) {
      const unlocked = !!(auraState && auraState.unlocked);
      auraBtn.el.classList.toggle('hidden', !unlocked);
      if (!unlocked) return;

      auraBtn.el.classList.remove('locked');
      if (auraState.color) {
        auraBtn.el.style.setProperty('--aura-touch-color', auraState.color);
      }
      if (auraState.active) {
        auraBtn.el.classList.add('aura-active');
        auraBtn.el.classList.remove('ready', 'on-cooldown');
        if (auraBtn.fill) auraBtn.fill.style.height = `${(Math.max(0, Math.min(1, auraState.activeRatio || 0)) * 100).toFixed(1)}%`;
        if (auraBtn.cd) auraBtn.cd.textContent = `${(auraState.activeRemaining || 0).toFixed(1)}s`;
      } else if (auraState.ready) {
        auraBtn.el.classList.remove('aura-active', 'on-cooldown');
        auraBtn.el.classList.add('ready');
        if (auraBtn.fill) auraBtn.fill.style.height = '100%';
        if (auraBtn.cd) auraBtn.cd.textContent = '';
      } else {
        auraBtn.el.classList.remove('aura-active', 'ready');
        auraBtn.el.classList.add('on-cooldown');
        const total = Math.max(1, auraState.cooldownTotal || 14);
        const pct = Math.max(0, Math.min(1, 1 - (auraState.cooldownRemaining || 0) / total)) * 100;
        if (auraBtn.fill) auraBtn.fill.style.height = `${pct.toFixed(1)}%`;
        if (auraBtn.cd) auraBtn.cd.textContent = `${Math.max(0.1, auraState.cooldownRemaining || 0).toFixed(1)}s`;
      }
    }
  }

  _emitVirtualAction(btn, down) {
    if (!this.input) return;
    if (btn.type === 'mouse') {
      this.input.triggerVirtualMouse(btn.code, down);
    } else {
      this.input.triggerVirtualKey(btn.code, down);
    }
  }

  _bindJoystickEvents() {
    const updateStick = (clientX, clientY) => {
      const dx = clientX - this._joyOriginX;
      const dy = clientY - this._joyOriginY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, JOYSTICK_RADIUS);
      const ux = dist > 0.001 ? dx / dist : 0;
      const uy = dist > 0.001 ? dy / dist : 0;

      const knobX = ux * clamped;
      const knobY = uy * clamped;
      this._joyKnob.style.transform = `translate(calc(-50% + ${knobX.toFixed(1)}px), calc(-50% + ${knobY.toFixed(1)}px))`;

      const norm = Math.min(1, dist / JOYSTICK_RADIUS);
      if (!this.input) return;
      if (norm <= JOYSTICK_DEADZONE) {
        this.input.setTouchMove(0, 0);
      } else {
        const mag = (norm - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
        // Pantalla Y hacia abajo es positivo; en el juego avanzar (+Y) es hacia arriba
        this.input.setTouchMove(ux * mag, -uy * mag);
      }
    };

    const releaseStick = (e) => {
      if (this._joyId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          this._joyId = null;
          this._joyBase.classList.add('hidden');
          this._joyKnob.style.transform = 'translate(-50%, -50%)';
          if (this.input) this.input.setTouchMove(0, 0);
          break;
        }
      }
    };

    this._leftZone.addEventListener(
      'touchstart',
      (e) => {
        if (!this._visible) return;
        e.preventDefault();
        if (this._joyId !== null) return;
        const t = e.changedTouches[0];
        if (!t) return;
        this._joyId = t.identifier;
        const maxLeft = Math.max(JOYSTICK_RADIUS + 20, window.innerWidth * 0.45 - JOYSTICK_RADIUS);
        const minTop = JOYSTICK_RADIUS + 70;
        const maxTop = Math.max(minTop, window.innerHeight - JOYSTICK_RADIUS - 16);
        this._joyOriginX = Math.max(JOYSTICK_RADIUS + 14, Math.min(maxLeft, t.clientX));
        this._joyOriginY = Math.max(minTop, Math.min(maxTop, t.clientY));
        this._joyBase.style.left = `${this._joyOriginX.toFixed(1)}px`;
        this._joyBase.style.top = `${this._joyOriginY.toFixed(1)}px`;
        this._joyBase.classList.remove('hidden');
        updateStick(t.clientX, t.clientY);
      },
      { passive: false }
    );

    this._leftZone.addEventListener(
      'touchmove',
      (e) => {
        if (this._joyId === null) return;
        for (const t of e.changedTouches) {
          if (t.identifier === this._joyId) {
            e.preventDefault();
            updateStick(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    this._leftZone.addEventListener('touchend', releaseStick, { passive: false });
    this._leftZone.addEventListener('touchcancel', releaseStick, { passive: false });
  }

  _bindCameraLookEvents() {
    const releaseCam = (e) => {
      if (this._camId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this._camId) {
          this._camId = null;
          break;
        }
      }
    };

    this._lookZone.addEventListener(
      'touchstart',
      (e) => {
        if (!this._visible) return;
        e.preventDefault();
        if (this._camId !== null) return;
        const t = e.changedTouches[0];
        if (!t) return;
        this._camId = t.identifier;
        this._camLastX = t.clientX;
        this._camLastY = t.clientY;
      },
      { passive: false }
    );

    this._lookZone.addEventListener(
      'touchmove',
      (e) => {
        if (this._camId === null) return;
        for (const t of e.changedTouches) {
          if (t.identifier === this._camId) {
            e.preventDefault();
            const dx = t.clientX - this._camLastX;
            const dy = t.clientY - this._camLastY;
            this._camLastX = t.clientX;
            this._camLastY = t.clientY;
            if (this.input) {
              this.input.addTouchCameraDelta(dx * CAMERA_DRAG_SCALE, dy * CAMERA_DRAG_SCALE);
            }
            break;
          }
        }
      },
      { passive: false }
    );

    this._lookZone.addEventListener('touchend', releaseCam, { passive: false });
    this._lookZone.addEventListener('touchcancel', releaseCam, { passive: false });
  }

  _isPointInCancelZone(clientX, clientY) {
    if (!this._cancelCastEl || this._cancelCastEl.classList.contains('hidden')) return false;
    const rect = this._cancelCastEl.getBoundingClientRect();
    const pad = 10;
    return (
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad
    );
  }

  _syncAimingVisuals(pointerX = null, pointerY = null) {
    let anyAiming = false;
    let showCancel = false;
    for (const b of Object.values(this._buttons)) {
      if (b.activeTouch) {
        anyAiming = true;
        if (b.cancellable && !b.activeTouch.isHeldMist) {
          showCancel = true;
        }
      }
    }
    if (this._cancelCastEl) {
      this._cancelCastEl.classList.toggle('hidden', !showCancel);
      const hovering =
        showCancel && pointerX !== null && pointerY !== null && this._isPointInCancelZone(pointerX, pointerY);
      this._cancelCastEl.classList.toggle('hover', hovering);
    }
    if (this.onAimingStateChange) {
      this.onAimingStateChange(anyAiming);
    }
  }

  _pulseVirtualTap(btn) {
    if (btn._releaseTimer) {
      clearTimeout(btn._releaseTimer);
      btn._releaseTimer = null;
    }
    this._emitVirtualAction(btn, true);
    btn._releaseTimer = setTimeout(() => {
      btn._releaseTimer = null;
      this._emitVirtualAction(btn, false);
    }, 28);
  }

  _bindButtonEvents(btn) {
    if (!btn.aimOnDrag) {
      const releaseInstant = (e) => {
        let changed = false;
        for (const t of e.changedTouches) {
          if (btn.touchIds.delete(t.identifier)) {
            changed = true;
          }
        }
        if (changed && btn.touchIds.size === 0) {
          btn.el.classList.remove('pressed');
          this._emitVirtualAction(btn, false);
        }
      };

      btn.el.addEventListener(
        'touchstart',
        (e) => {
          if (!this._visible) return;
          e.preventDefault();
          e.stopPropagation();
          const wasEmpty = btn.touchIds.size === 0;
          for (const t of e.changedTouches) {
            btn.touchIds.add(t.identifier);
          }
          if (wasEmpty && btn.touchIds.size > 0) {
            btn.el.classList.add('pressed');
            this._emitVirtualAction(btn, true);
          }
        },
        { passive: false }
      );

      btn.el.addEventListener(
        'touchmove',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );

      btn.el.addEventListener('touchend', releaseInstant, { passive: false });
      btn.el.addEventListener('touchcancel', releaseInstant, { passive: false });
      return;
    }

    // Botones de combate con apuntado al arrastrar (ATK, DEF/ESP, Q, E)
    btn.el.addEventListener(
      'touchstart',
      (e) => {
        if (!this._visible) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.activeTouch) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const isHeldMist = btn.key === 'secondary' && this._currentElement === 'storm';
        btn.activeTouch = {
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          lastX: t.clientX,
          lastY: t.clientY,
          isHeldMist,
        };
        btn.el.classList.add('pressed', 'btn-aiming');
        if (isHeldMist) {
          this._emitVirtualAction(btn, true);
        }
        this._syncAimingVisuals(t.clientX, t.clientY);
      },
      { passive: false }
    );

    btn.el.addEventListener(
      'touchmove',
      (e) => {
        if (!btn.activeTouch) return;
        for (const t of e.changedTouches) {
          if (t.identifier === btn.activeTouch.id) {
            e.preventDefault();
            e.stopPropagation();
            const dx = t.clientX - btn.activeTouch.lastX;
            const dy = t.clientY - btn.activeTouch.lastY;
            btn.activeTouch.lastX = t.clientX;
            btn.activeTouch.lastY = t.clientY;
            if (this.input) {
              this.input.addTouchCameraDelta(dx * CAMERA_DRAG_SCALE, dy * CAMERA_DRAG_SCALE);
            }
            this._syncAimingVisuals(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    const endAimTouch = (e, cancelled) => {
      if (!btn.activeTouch) return;
      for (const t of e.changedTouches) {
        if (t.identifier === btn.activeTouch.id) {
          e.preventDefault();
          e.stopPropagation();
          const wasHeldMist = btn.activeTouch.isHeldMist;
          const droppedInCancel =
            !cancelled && btn.cancellable && !wasHeldMist && this._isPointInCancelZone(t.clientX, t.clientY);
          btn.activeTouch = null;
          btn.el.classList.remove('pressed', 'btn-aiming');
          this._syncAimingVisuals();

          if (wasHeldMist) {
            this._emitVirtualAction(btn, false);
          } else if (!cancelled && !droppedInCancel) {
            this._pulseVirtualTap(btn);
          }
          break;
        }
      }
    };

    btn.el.addEventListener('touchend', (e) => endAimTouch(e, false), { passive: false });
    btn.el.addEventListener('touchcancel', (e) => endAimTouch(e, true), { passive: false });
  }
}
