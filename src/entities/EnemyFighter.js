import * as THREE from 'three';
import { BaseFighter } from './BaseFighter.js';
import { createElementController } from '../combat/ElementFactory.js';
import { DIFFICULTY_PROFILES } from '../ai/EnemyAI.js';

/**
 * EnemyFighter
 * ------------------------------------------------------------
 * Rival controlado por IA (`id = 'bot_1' | 'bot_2'`). Soporta múltiples
 * bots simultáneos con elemento configurable y `+0.95s` de recarga extra
 * respecto al jugador para combates tácticos justos.
 */

export class EnemyFighter extends BaseFighter {
  /**
   * Acepta un objeto de configuración `{ id, theme, scene, arena, combat, element, cooldownBonus }`
   * o los argumentos posicionales legados `(scene, arena, combat)`.
   */
  constructor(sceneOrOpts, arenaArg, combatArg) {
    const opts =
      sceneOrOpts && sceneOrOpts.scene
        ? sceneOrOpts
        : { scene: sceneOrOpts, arena: arenaArg, combat: combatArg };

    const id = opts.id ?? 'bot_1';
    const theme = opts.theme ?? 'rival';
    const element = opts.element ?? 'earth';
    const cooldownBonus = opts.cooldownBonus ?? DIFFICULTY_PROFILES.master.cooldownBonus;

    super({ id, theme, scene: opts.scene, arena: opts.arena });
    this.combat = opts.combat;
    this.combatEnabled = true;
    this.difficulty = 'master';
    this.cooldownBonus = cooldownBonus;
    this.ai = null;

    /** Punto y ángulo de mira controlados por `EnemyAI` */
    this.aimYaw = 0;
    this.aimPoint = new THREE.Vector3(0, 1.2, 12);

    /** Comando de locomoción establecido cada frame por `EnemyAI` */
    this.aiWishDir = new THREE.Vector3();
    this.aiWantsJump = false;
    this.aiWantsDash = false;

    this.element = element;
    this.elementController = createElementController(
      element,
      this.combat,
      this,
      {
        getAimYaw: () => this.aimYaw,
        getAimPoint: () => this.aimPoint.clone(),
      },
      cooldownBonus
    );
    this.combat.registerFighter(this, this.elementController);

    this.resetFighter(new THREE.Vector3(0, 0, -15), 0, false);
  }

  /** Configura perfil de dificultad ('apprentice' | 'master' | 'grandmaster') */
  setDifficulty(level = 'master') {
    const profile = DIFFICULTY_PROFILES[level] || DIFFICULTY_PROFILES.master;
    this.difficulty = profile.id;
    this.cooldownBonus = profile.cooldownBonus;
    if (this.elementController) {
      this.elementController.cooldownBonus = profile.cooldownBonus;
    }
    if (this.ai && this.ai.difficulty !== profile.id) {
      this.ai.setDifficulty(profile.id);
    }
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (!this.isAlive || !this.combatEnabled) {
      this.aiWishDir.set(0, 0, 0);
      this.aiWantsJump = false;
      this.aiWantsDash = false;
    }

    this.stepPhysics(dt, {
      wishDir: this.aiWishDir,
      wantsJump: this.aiWantsJump,
      wantsDash: this.aiWantsDash,
      aimYaw: this.aimYaw,
    });

    this.aiWantsJump = false;
    this.aiWantsDash = false;
  }
}
