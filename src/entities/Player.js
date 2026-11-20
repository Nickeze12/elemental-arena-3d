import * as THREE from 'three';
import { BaseFighter } from './BaseFighter.js';

/**
 * Player
 * ------------------------------------------------------------
 * Luchador controlado por el usuario. Extiende `BaseFighter` y traduce
 * la entrada de teclado/mouse (`InputManager`) en movimiento y habilidades.
 */

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

export class Player extends BaseFighter {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../world/Arena.js').Arena} arena
   * @param {import('../core/InputManager.js').InputManager} input
   */
  constructor(scene, arena, input) {
    super({ id: 'player', theme: 'player', scene, arena });
    this.input = input;
    this.combatEnabled = true;

    this.resetFighter(new THREE.Vector3(0, 0, 12), Math.PI, false);
  }

  /**
   * @param {number} dt
   * @param {number} cameraYaw yaw horizontal de la cámara
   */
  update(dt, cameraYaw) {
    const input = this.input;

    // --- Dirección deseada relativa a la cámara (invertida si está Confundido) ---
    const axis = this.isAlive
      ? (input.getMoveVector ? input.getMoveVector() : input.getMoveAxis())
      : { x: 0, y: 0 };
    if (this.isConfused) {
      axis.x = -axis.x;
      axis.y = -axis.y;
    }
    _forward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    _right.set(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    _wish.set(0, 0, 0).addScaledVector(_forward, axis.y).addScaledVector(_right, axis.x);
    if (_wish.lengthSq() > 1) _wish.normalize();

    const wantsJump = this.isAlive && !this.isStunned && input.wasPressed('Space');
    const wantsDash = this.isAlive && !this.isStunned && (input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight'));

    // --- Habilidades de combate (bloqueadas si está congelado o aturdido) ---
    if (this.isAlive && this.combatEnabled && !this.isFrozen && !this.isStunned && this.combat) {
      this.combat.processInput(input);
    }

    this.stepPhysics(dt, {
      wishDir: _wish,
      wantsJump,
      wantsDash,
      aimYaw: cameraYaw,
    });
  }

  /** Compatibilidad con llamadas previas */
  respawn(withEffect = true) {
    this.resetFighter(new THREE.Vector3(0, 0, 0), this.yaw, withEffect);
  }
}
