import * as THREE from 'three';

/**
 * Projectile
 * ------------------------------------------------------------
 * Proyectil genérico (independiente del elemento). El CombatManager lo
 * integra con sub-pasos y resuelve colisiones contra el mundo; el
 * controlador elemental define su aspecto y su reacción al impacto.
 */
export class Projectile {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.mesh objeto visual (su posición es la del proyectil)
   * @param {THREE.Vector3} o.velocity
   * @param {number} o.radius radio de colisión
   * @param {number} [o.gravity=0]
   * @param {number} [o.life=3] segundos antes de expirar
   * @param {number} [o.damage=10]
   * @param {number} [o.knockback=4]
   * @param {*} [o.owner]
   * @param {string} [o.tag]
   * @param {THREE.Vector3} [o.spin] velocidad angular (rad/s por eje)
   * @param {(hit: object, p: Projectile) => void} [o.onImpact]
   * @param {(dt: number, p: Projectile) => void} [o.onUpdate]
   * @param {(p: Projectile) => void} [o.onExpire]
   */
  constructor(o) {
    this.mesh = o.mesh;
    this.position = o.mesh.position;
    this.velocity = o.velocity.clone();
    this.radius = o.radius;
    this.gravity = o.gravity ?? 0;
    this.life = o.life ?? 3;
    this.damage = o.damage ?? 10;
    this.knockback = o.knockback ?? 4;
    this.owner = o.owner ?? null;
    this.ownerId = o.ownerId ?? (o.owner && o.owner.id) ?? null;
    this.tag = o.tag ?? 'projectile';
    this.spin = o.spin ? o.spin.clone() : new THREE.Vector3();
    this.onImpact = o.onImpact ?? null;
    this.onSubStep = o.onSubStep ?? null;
    this.onPierceHit = o.onPierceHit ?? null;
    this.onUpdate = o.onUpdate ?? null;
    this.onExpire = o.onExpire ?? null;
    this.piercing = !!o.piercing;
    this._piercedIds = this.piercing ? new Set() : null;
    this.alive = true;

    /** Hitbox reutilizable expuesta para dañar/empujar luchadores */
    this.hitbox = {
      type: 'sphere',
      tag: this.tag,
      owner: this.owner,
      ownerId: this.ownerId,
      position: this.position,
      radius: this.radius,
      damage: this.damage,
      knockback: this.knockback,
      direction: new THREE.Vector3(),
      source: this,
    };
  }

  /** Actualiza y devuelve la hitbox con la dirección de vuelo actual */
  getHitbox() {
    this.hitbox.direction.copy(this.velocity).normalize();
    return this.hitbox;
  }
}
