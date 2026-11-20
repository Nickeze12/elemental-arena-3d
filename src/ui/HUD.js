import * as THREE from 'three';
import { ELEMENTS, ELEMENT_KEYS, getElementConfig } from '../combat/ElementFactory.js';
import { TouchControls } from './TouchControls.js';
import {
  economyManager,
  CLASSIC_ELEMENTS,
  LEGENDARY_ELEMENTS,
} from '../core/EconomyManager.js';

/**
 * HUD
 * ------------------------------------------------------------
 * Interfaz HTML/CSS superpuesta al canvas:
 *  - Pantalla inicial de Selección de Maestro Elemental (Tierra, Fuego, Agua, Aire)
 *    con tarjetas interactivas, selector de rival (Aleatorio o específico) y
 *    botón "¡ENTRAR A LA ARENA!".
 *  - Barras de vida enfrentadas en la parte superior con nombres dinámicos según
 *    el elemento elegido y barra secundaria de daño reciente (damage trail).
 *  - Botón discreto de silencio (Mute) con atajo `M`.
 *  - Números de daño flotantes proyectados desde 3D a 2D.
 *  - Viñeta roja de peligro de Ring-Out.
 *  - Cartel central de cuenta regresiva ("¡PREPARADOS...!", "¡A LUCHAR!").
 *  - Retícula central con pulso al disparar.
 *  - Menú de pausa al presionar Escape.
 *  - Pantalla final de resultado con botones "Jugar de nuevo (R)" y "Cambiar Elemento (C)".
 *  - Barra inferior central de 4 habilidades elementales + indicador de Dash.
 */

const SLOT_ORDER = ['primary', 'secondary', 'skill1', 'skill2'];
const _projVec = new THREE.Vector3();
const _camToBot = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();

export class HUD {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.onPlayAgain = null;
    this.onNextStage = null;
    this.onReplayStage = null;
    this.onRestartRun = null;
    this.onChangeElement = null;
    this.onStartDuel = null;
    this.onToggleMute = null;
    this.onDojoToggleBehavior = null;
    this.onDojoToggleInstantCd = null;
    this.onDojoResetPositions = null;
    this.onDojoBackToMenu = null;
    this.onSelectUpgrade = null;
    this.onToggleTouchMode = null;
    this.onTouchPause = null;
    this.onTouchResume = null;

    this._isGameOver = false;
    this._isSelecting = true;
    this._isChoosingUpgrade = false;
    this._isLocked = false;
    this._isTouchMode = false;
    this._manualPauseOpen = false;
    this._dojoActive = false;
    this._dojoCollapsed = false;
    this._lastAbilities = [];
    this._lastDashReadiness = 1;
    this._lastAuraState = null;
    this._currentElementCfg = ELEMENTS.earth;
    this._stage = 1;
    this._mode = 'classic';
    this._format = 'ffa';
    this._menuStep = 1;
    this._classicBotCount = 1;
    this._sanctuaryBotCount = 3;
    this._survivalRecord = { maxWave: 0, highScore: 0 };

    this.selectedPlayerElement = 'classic_roulette';
    this.economy = economyManager;
    this._sound = null;
    this._rouletteSpinning = false;
    this.goldToastLayer = el('div', 'gold-toast-layer');
    this.selectedRivalChoice = 'random'; // 'random' | 'earth' | 'fire' | 'water' | 'air'
    this.selectedMode = 'classic'; // 'classic' | 'sanctuary'
    this.selectedFormat = 'ffa'; // 'ffa' | 'teams' | 'dojo' | 'survival'
    this.selectedDifficulty = 'master'; // 'apprentice' | 'master' | 'grandmaster'
    this.selectedSurvivalCompanion = 'solo'; // 'solo' | 'ally'
    this.selectedBotCount = 1; // 1..2 (classic ffa) | 1..6 (sanctuary ffa) | 3 (teams) | 1 (dojo)
    this.onConfigChange = null;

    // --- Viñeta roja de peligro de Ring-Out ---
    this.dangerVignette = el('div', 'danger-vignette');

    // --- Viñeta violeta hipnótica y aviso de Confusión ---
    this.confuseVignette = el('div', 'confuse-vignette');
    this.confuseBanner = el('div', 'confuse-banner hidden');
    this.confuseBanner.innerHTML = `<span>🌀 ¡CONTROLES INVERTIDOS!</span>`;

    // --- Capa de barras flotantes sobre bots en la arena ---
    this.worldBarsLayer = el('div', 'world-bars-layer');
    this._worldBars = new Map();

    // --- Indicadores direccionales alrededor de la retícula ---
    this.directionalLayer = el('div', 'directional-indicators-layer');
    this._dirPointers = new Map();

    // --- Kill-feed (esquina superior izquierda) ---
    this.killFeedLayer = el('div', 'kill-feed');

    // --- Banner de cámara espectador (cuando muere jugador en 2v2 con aliado vivo) ---
    this.spectatorBanner = el('div', 'spectator-banner hidden');
    this.spectatorBanner.innerHTML = `<span class="spectator-eye">👁️</span><span>ESPECTANDO A TU ALIADO (IA)</span>`;

    // --- Panel interactivo del Modo Dojo + Telemetría + Botón flotante para colapsar ---
    this.dojoRestoreBtn = el('button', 'dojo-restore-btn hidden');
    this.dojoRestoreBtn.type = 'button';
    this.dojoRestoreBtn.setAttribute('data-dojo-restore', '');
    this.dojoRestoreBtn.title = 'Abrir Panel del Dojo (H)';
    this.dojoRestoreBtn.textContent = '🥋 Panel Dojo';
    this.dojoRestoreBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.dojoRestoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setDojoPanelCollapsed(false);
    });

    this.dojoPanel = el('div', 'dojo-hud-stack hidden');
    this.dojoPanel.setAttribute('data-dojo-panel', '');
    this.dojoPanel.innerHTML = `
      <div class="dojo-card">
        <div class="dojo-card-header">
          <span>🥋 PANEL DEL DOJO</span>
          <div class="dojo-header-right">
            <small class="dojo-esc-hint">Esc: cursor</small>
            <button type="button" class="dojo-close-btn" data-dojo-close title="Minimizar panel (H)" aria-label="Minimizar panel del Dojo">✕</button>
          </div>
        </div>
        <div class="dojo-controls-list">
          <button type="button" class="dojo-ctrl-btn" data-dojo-behavior>
            <span class="dojo-btn-left"><kbd>F1</kbd> Bot IA</span>
            <strong class="dojo-val" data-dojo-behavior-label>Pasivo</strong>
          </button>
          <button type="button" class="dojo-ctrl-btn" data-dojo-instant>
            <span class="dojo-btn-left"><kbd>F2</kbd> Sin Cooldown</span>
            <strong class="dojo-val" data-dojo-instant-label>OFF</strong>
          </button>
          <button type="button" class="dojo-ctrl-btn" data-dojo-reset>
            <span class="dojo-btn-left"><kbd>F3</kbd> Reiniciar Posiciones</span>
            <strong class="dojo-val">↺</strong>
          </button>
          <button type="button" class="dojo-ctrl-btn dojo-menu-btn" data-dojo-menu>
            <span class="dojo-btn-left">← Volver al Menú</span>
          </button>
        </div>
      </div>
      <div class="dojo-telemetry-card" data-dojo-telemetry>
        <div class="dojo-telem-row">
          <span>Último Daño:</span>
          <strong data-dojo-last-dmg>0</strong>
        </div>
        <div class="dojo-telem-row">
          <span>Daño Combo:</span>
          <strong class="dojo-combo-val" data-dojo-combo-dmg>0</strong>
        </div>
        <div class="dojo-telem-row">
          <span>Estado Objetivo:</span>
          <strong class="dojo-status-val" data-dojo-status>Normal</strong>
        </div>
      </div>`;

    this._dojoCloseBtn = this.dojoPanel.querySelector('[data-dojo-close]');
    this._dojoBehaviorBtn = this.dojoPanel.querySelector('[data-dojo-behavior]');
    this._dojoBehaviorLabel = this.dojoPanel.querySelector('[data-dojo-behavior-label]');
    this._dojoInstantBtn = this.dojoPanel.querySelector('[data-dojo-instant]');
    this._dojoInstantLabel = this.dojoPanel.querySelector('[data-dojo-instant-label]');
    this._dojoResetBtn = this.dojoPanel.querySelector('[data-dojo-reset]');
    this._dojoMenuBtn = this.dojoPanel.querySelector('[data-dojo-menu]');
    this._dojoLastDmgEl = this.dojoPanel.querySelector('[data-dojo-last-dmg]');
    this._dojoComboDmgEl = this.dojoPanel.querySelector('[data-dojo-combo-dmg]');
    this._dojoStatusEl = this.dojoPanel.querySelector('[data-dojo-status]');

    this.dojoPanel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    if (this._dojoCloseBtn) {
      this._dojoCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setDojoPanelCollapsed(true);
      });
    }
    this._dojoBehaviorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDojoToggleBehavior) this.onDojoToggleBehavior();
    });
    this._dojoInstantBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDojoToggleInstantCd) this.onDojoToggleInstantCd();
    });
    this._dojoResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDojoResetPositions) this.onDojoResetPositions();
    });
    this._dojoMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onDojoBackToMenu) this.onDojoBackToMenu();
      else if (this.onChangeElement) this.onChangeElement(1);
    });

    // --- Capa de números de daño flotantes ---
    this.damageLayer = el('div', 'damage-numbers-layer');
    this._floatingNumbers = [];

    const enemySlotsHtml = Array.from({ length: 6 }, (_, idx) => `
      <div class="enemy-bar-slot ${idx > 0 ? 'enemy-sub-slot hidden' : ''}" data-enemy-slot="${idx}">
        <div class="fighter-info">
          <span class="fighter-hp-text" data-hp="enemy${idx}">100 / 100</span>
          <span class="fighter-name" data-name="enemy${idx}">RIVAL ${idx + 1} (IA)</span>
        </div>
        <div class="hp-bar-track enemy-track ${idx > 0 ? 'compact' : ''}">
          <div class="hp-bar-trail" data-trail="enemy${idx}" style="width: 100%"></div>
          <div class="hp-bar-fill enemy-fill" data-fill="enemy${idx}" style="width: 100%"></div>
        </div>
      </div>`).join('');

    // --- Barras de vida superiores ---
    this.topHud = el('div', 'duel-header');
    this.topHud.innerHTML = `
      <div class="fighter-hud left-hud-col">
        <div class="player-hud">
          <div class="fighter-info">
            <span class="fighter-name" data-name="player">MAESTRO TIERRA (TÚ)</span>
            <span class="fighter-hp-text" data-hp="player">100 / 100</span>
          </div>
          <div class="hp-bar-track">
            <div class="hp-bar-trail" data-trail="player" style="width: 100%"></div>
            <div class="hp-bar-fill player-fill" data-fill="player" style="width: 100%"></div>
          </div>
        </div>
        <div class="ally-bar-slot hidden" data-ally-slot>
          <div class="fighter-info">
            <span class="fighter-name" data-name="ally">🛡️ ALIADO (IA)</span>
            <span class="fighter-hp-text" data-hp="ally">100 / 100</span>
          </div>
          <div class="hp-bar-track compact ally-track">
            <div class="hp-bar-trail" data-trail="ally" style="width: 100%"></div>
            <div class="hp-bar-fill ally-fill" data-fill="ally" style="width: 100%"></div>
          </div>
        </div>
      </div>

      <div class="center-hud-col">
        <div class="stage-badge" data-stage-badge>ETAPA 1: DUELO</div>
        <div class="br-stats-pill hidden" data-br-stats>
          VIVOS: <strong data-br-alive>4 / 4</strong> · TUS BAJAS: <strong data-br-kills>0</strong>
        </div>
        <div class="survival-stats-pill hidden" data-survival-stats>
          OLEADA <strong data-surv-wave>1</strong> · ENEMIGOS: <strong data-surv-enemies>2</strong> · PUNTOS: <strong data-surv-score>0</strong>
        </div>
        <div class="team-score-pill hidden" data-team-stats>
          <span class="team-blue-tag">AZUL <strong data-blue-alive>2</strong></span>
          <span class="team-vs-sep">VS</span>
          <span class="team-red-tag"><strong data-red-alive>2</strong> ROJO</span>
        </div>
        <div class="vs-badge" data-vs-badge>VS</div>
      </div>

      <div class="fighter-hud enemy-hud" data-enemy-hud>
        ${enemySlotsHtml}
        <div class="boss-bar-slot hidden" data-boss-bar>
          <div class="fighter-info">
            <span class="fighter-hp-text" data-boss-hp>250 / 250</span>
            <span class="fighter-name boss-name" data-boss-name>👑 COLOSO ELEMENTAL</span>
          </div>
          <div class="hp-bar-track boss-track">
            <div class="hp-bar-fill boss-fill" data-boss-fill style="width: 100%"></div>
          </div>
        </div>
      </div>`;

    this._stageBadgeEl = this.topHud.querySelector('[data-stage-badge]');
    this._brStatsEl = this.topHud.querySelector('[data-br-stats]');
    this._brAliveEl = this.topHud.querySelector('[data-br-alive]');
    this._brKillsEl = this.topHud.querySelector('[data-br-kills]');
    this._survivalStatsEl = this.topHud.querySelector('[data-survival-stats]');
    this._survWaveEl = this.topHud.querySelector('[data-surv-wave]');
    this._survEnemiesEl = this.topHud.querySelector('[data-surv-enemies]');
    this._survScoreEl = this.topHud.querySelector('[data-surv-score]');
    this._bossBarEl = this.topHud.querySelector('[data-boss-bar]');
    this._bossNameEl = this.topHud.querySelector('[data-boss-name]');
    this._bossHpTextEl = this.topHud.querySelector('[data-boss-hp]');
    this._bossFillEl = this.topHud.querySelector('[data-boss-fill]');
    this._teamStatsEl = this.topHud.querySelector('[data-team-stats]');
    this._blueAliveEl = this.topHud.querySelector('[data-blue-alive]');
    this._redAliveEl = this.topHud.querySelector('[data-red-alive]');
    this._vsBadgeEl = this.topHud.querySelector('[data-vs-badge]');
    this._enemyHudEl = this.topHud.querySelector('[data-enemy-hud]');
    this._playerNameEl = this.topHud.querySelector('[data-name="player"]');
    this._playerFill = this.topHud.querySelector('[data-fill="player"]');
    this._playerTrail = this.topHud.querySelector('[data-trail="player"]');
    this._playerHpText = this.topHud.querySelector('[data-hp="player"]');

    this._allySlot = {
      root: this.topHud.querySelector('[data-ally-slot]'),
      nameEl: this.topHud.querySelector('[data-name="ally"]'),
      fillEl: this.topHud.querySelector('[data-fill="ally"]'),
      trailEl: this.topHud.querySelector('[data-trail="ally"]'),
      hpTextEl: this.topHud.querySelector('[data-hp="ally"]'),
      trailPct: 100,
    };

    this._enemySlots = Array.from({ length: 6 }, (_, idx) => ({
      root: this.topHud.querySelector(`[data-enemy-slot="${idx}"]`),
      nameEl: this.topHud.querySelector(`[data-name="enemy${idx}"]`),
      fillEl: this.topHud.querySelector(`[data-fill="enemy${idx}"]`),
      trailEl: this.topHud.querySelector(`[data-trail="enemy${idx}"]`),
      hpTextEl: this.topHud.querySelector(`[data-hp="enemy${idx}"]`),
      trailPct: 100,
    }));
    // Alias legado
    this._enemyNameEl = this._enemySlots[0].nameEl;
    this._enemyFill = this._enemySlots[0].fillEl;
    this._enemyTrail = this._enemySlots[0].trailEl;
    this._enemyHpText = this._enemySlots[0].hpTextEl;

    this._playerTrailPct = 100;
    this._enemyTrailPct = 100;

    // --- Barra de acciones rápidas superior derecha (Silencio, Pausa Táctil, Pantalla Completa) ---
    this.topActionsBar = el('div', 'hud-top-actions');

    this.muteBtn = el('button', 'mute-btn');
    this.muteBtn.type = 'button';
    this.muteBtn.title = 'Silenciar / Activar audio (M)';
    this.setMuted(false);
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onToggleMute) this.onToggleMute();
    });

    this.pauseBtn = el('button', 'hud-util-btn touch-pause-btn hidden');
    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('data-touch-pause-btn', '');
    this.pauseBtn.title = 'Menú / Pausa';
    this.pauseBtn.innerHTML = `<span class="util-icon">⏸</span><small>Pausa</small>`;
    this.pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleManualPause();
    });

    this.fullscreenBtn = el('button', 'hud-util-btn fullscreen-btn');
    this.fullscreenBtn.type = 'button';
    this.fullscreenBtn.setAttribute('data-fullscreen-btn', '');
    this.fullscreenBtn.title = 'Pantalla Completa';
    this.fullscreenBtn.innerHTML = `<span class="util-icon">⛶</span>`;
    this.fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });

    this.topActionsBar.append(this.muteBtn, this.pauseBtn, this.fullscreenBtn);

    if (typeof document !== 'undefined') {
      const syncFs = () => this._syncFullscreenState();
      document.addEventListener('fullscreenchange', syncFs);
      document.addEventListener('webkitfullscreenchange', syncFs);
    }

    // --- Aviso sutil de orientación vertical en dispositivos táctiles ---
    this.portraitWarning = el('div', 'portrait-warning hidden');
    this.portraitWarning.setAttribute('data-portrait-warning', '');
    this.portraitWarning.innerHTML = `<span>📱 Gira tu dispositivo en horizontal para mejor visibilidad</span>`;

    // --- Controles multi-touch (Joystick virtual + arrastre cámara + arco de habilidades) ---
    this.touchControls = new TouchControls(null);
    this.touchControls.onAimingStateChange = (aiming) => {
      if (this.crosshair) {
        this.crosshair.classList.toggle('aiming', !!aiming);
      }
    };

    // --- Cartel de cuenta regresiva ---
    this.countdownEl = el('div', 'countdown-banner hidden');

    // --- Retícula con contorno de contraste sobre suelo claro y cielo luminoso ---
    this.crosshair = el('div', 'crosshair');
    this.crosshair.setAttribute('aria-hidden', 'true');
    for (const part of ['ch-top', 'ch-bottom', 'ch-left', 'ch-right', 'ch-dot']) {
      this.crosshair.appendChild(el('span', part));
    }

    // --- Pantalla de Selección de Maestro Elemental ---
    this.selectOverlay = el('div', 'element-select-overlay');
    this._buildElementSelector();

    // --- Cartel de Pausa (cuando ya inició un duelo y se suelta el PointerLock con Escape) ---
    this.overlay = el('div', 'start-overlay hidden');
    this.overlay.innerHTML = `
      <div class="start-panel">
        <h1 class="overlay-title">JUEGO EN PAUSA</h1>
        <p class="subtitle" data-pause-subtitle>Duelo Elemental</p>
        <p class="cta">Haz clic en la arena para continuar</p>
        <div class="controls" data-pause-controls></div>
        <div class="pause-actions">
          <button type="button" class="enter-arena-btn pause-resume-btn" data-pause-resume>▶ Continuar</button>
          <button type="button" class="secondary-btn" data-pause-change>Cambiar Elemento</button>
        </div>
      </div>`;
    this._overlayTitle = this.overlay.querySelector('.overlay-title');
    this._overlayCta = this.overlay.querySelector('.cta');
    this._pauseSubtitle = this.overlay.querySelector('[data-pause-subtitle]');
    this._pauseControls = this.overlay.querySelector('[data-pause-controls]');
    this._pauseResumeBtn = this.overlay.querySelector('[data-pause-resume]');
    this._pauseChangeBtn = this.overlay.querySelector('[data-pause-change]');
    this._pauseResumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._resumeFromPause();
    });
    this._pauseChangeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._manualPauseOpen = false;
      if (this.onChangeElement) this.onChangeElement(2);
    });

    // --- Pantalla de resultado final (Game Over / Etapa completada) ---
    this.gameOverOverlay = el('div', 'gameover-overlay hidden');
    this.gameOverOverlay.innerHTML = `
      <div class="gameover-panel">
        <h2 class="gameover-title">¡VICTORIA!</h2>
        <div class="gameover-gold-badge hidden" data-gameover-gold></div>
        <p class="gameover-subtitle"></p>
        <div class="gameover-buttons">
          <button type="button" class="play-again-btn hidden" data-next-stage>Siguiente Etapa: Batalla Campal</button>
          <button type="button" class="play-again-btn" data-replay-stage>Jugar de nuevo <small>(R)</small></button>
          <button type="button" class="play-again-btn hidden" data-restart-run>Jugar desde Etapa 1</button>
          <button type="button" class="play-again-btn hidden" data-return-lobby>Volver a la Sala (Lobby)</button>
          <button type="button" class="change-element-btn" data-change-element-step2>Cambiar Elemento</button>
          <button type="button" class="change-element-btn" data-main-menu>Menú Principal <small>(C)</small></button>
        </div>
      </div>`;
    this._goTitle = this.gameOverOverlay.querySelector('.gameover-title');
    this._goGoldBadge = this.gameOverOverlay.querySelector('[data-gameover-gold]');
    this._goSubtitle = this.gameOverOverlay.querySelector('.gameover-subtitle');
    this._nextStageBtn = this.gameOverOverlay.querySelector('[data-next-stage]');
    this._playAgainBtn = this.gameOverOverlay.querySelector('[data-replay-stage]');
    this._restartRunBtn = this.gameOverOverlay.querySelector('[data-restart-run]');
    this._returnLobbyBtn = this.gameOverOverlay.querySelector('[data-return-lobby]');
    this._changeElementStep2Btn = this.gameOverOverlay.querySelector('[data-change-element-step2]');
    this._changeElementBtn = this.gameOverOverlay.querySelector('[data-main-menu]');

    this._nextStageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onNextStage) this.onNextStage();
    });
    if (this._returnLobbyBtn) {
      this._returnLobbyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onReturnToLobby) this.onReturnToLobby();
      });
    }
    this._playAgainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onReplayStage) this.onReplayStage();
      else if (this.onPlayAgain) this.onPlayAgain();
    });
    this._restartRunBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onRestartRun) this.onRestartRun();
      else if (this.onPlayAgain) this.onPlayAgain();
    });
    this._changeElementStep2Btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onChangeElement) this.onChangeElement(2);
    });
    this._changeElementBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onChangeElement) this.onChangeElement(1);
    });

    // --- Barra de 4 habilidades (parte inferior central) ---
    this.abilityBar = el('div', 'ability-bar');
    /** @type {Record<string, {root:HTMLElement, fill:HTMLElement, nameEl:HTMLElement, keyEl:HTMLElement, cdText:HTMLElement}>} */
    this.slots = {};
    this._idToSlot = {};

    const defaultAbilities = ELEMENTS.earth.abilities;
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const slotKey = SLOT_ORDER[i];
      const ab = defaultAbilities[i];
      const slot = el('div', 'ability-slot ready');
      slot.dataset.slot = slotKey;
      slot.dataset.ability = ab.id;
      slot.innerHTML = `
        <div class="ability-fill" style="height: 100%"></div>
        <span class="ability-charges hidden"></span>
        <div class="ability-content">
          <span class="ability-key">${ab.key}</span>
          <span class="ability-name">${ab.name}</span>
          <span class="ability-cd"></span>
        </div>`;
      this.abilityBar.appendChild(slot);
      const slotObj = {
        root: slot,
        fill: slot.querySelector('.ability-fill'),
        chargesEl: slot.querySelector('.ability-charges'),
        keyEl: slot.querySelector('.ability-key'),
        nameEl: slot.querySelector('.ability-name'),
        cdText: slot.querySelector('.ability-cd'),
      };
      this.slots[slotKey] = slotObj;
      this.slots[ab.id] = slotObj;
      this._idToSlot[ab.id] = slotKey;
    }

    // 5.ª ranura exclusiva del Modo Supervivencia: Aura Elemental [R]
    const auraEl = el('div', 'ability-slot aura-slot locked hidden');
    auraEl.dataset.slot = 'aura';
    auraEl.dataset.ability = 'aura_r';
    auraEl.innerHTML = `
      <div class="ability-fill" style="height: 0%"></div>
      <div class="ability-content">
        <span class="ability-key">R</span>
        <span class="ability-name">Aura</span>
        <span class="ability-cd">Ol. 2</span>
      </div>`;
    this.abilityBar.appendChild(auraEl);
    this.auraSlot = {
      root: auraEl,
      fill: auraEl.querySelector('.ability-fill'),
      keyEl: auraEl.querySelector('.ability-key'),
      nameEl: auraEl.querySelector('.ability-name'),
      cdText: auraEl.querySelector('.ability-cd'),
    };
    this.slots.aura_r = this.auraSlot;

    // --- Indicador de Dash (anillo SVG) ---
    const R = 28;
    this._circumference = 2 * Math.PI * R;
    this.dash = el('div', 'dash-indicator ready');
    this.dash.innerHTML = `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle class="ring-bg" cx="32" cy="32" r="${R}"></circle>
        <circle class="ring-fg" cx="32" cy="32" r="${R}"
          stroke-dasharray="${this._circumference}" stroke-dashoffset="0"></circle>
      </svg>
      <div class="label">DASH<small>Shift</small></div>`;
    this._ring = this.dash.querySelector('.ring-fg');
    this._lastReadiness = 1;

    // --- Modal de Selección de 3 Cartas de Mejora entre Oleadas ---
    this.upgradeOverlay = el('div', 'upgrade-overlay hidden');
    this.upgradeOverlay.setAttribute('data-upgrade-overlay', '');
    this.upgradeOverlay.innerHTML = `
      <div class="upgrade-panel" data-upgrade-panel>
        <div class="upgrade-kicker" data-upgrade-kicker>¡OLEADA 1 SUPERADA! · +25 HP</div>
        <h2 class="upgrade-title">ELIGE UNA MEJORA ACUMULABLE</h2>
        <p class="upgrade-sub" data-upgrade-sub>Haz clic o presiona <kbd>1</kbd>, <kbd>2</kbd> o <kbd>3</kbd></p>
        <div class="upgrade-cards-grid" data-upgrade-grid></div>
      </div>`;
    this._upgradePanelEl = this.upgradeOverlay.querySelector('[data-upgrade-panel]');
    this._upgradeKickerEl = this.upgradeOverlay.querySelector('[data-upgrade-kicker]');
    this._upgradeSubEl = this.upgradeOverlay.querySelector('[data-upgrade-sub]');
    this._upgradeGridEl = this.upgradeOverlay.querySelector('[data-upgrade-grid]');

    // --- Destello de reaparición y ceguera por Destello Solar ---
    this.flashEl = el('div', 'respawn-flash');
    this.solarBlindEl = el('div', 'solar-blind-flash');

    root.append(
      this.dangerVignette,
      this.confuseVignette,
      this.flashEl,
      this.solarBlindEl,
      this.worldBarsLayer,
      this.directionalLayer,
      this.killFeedLayer,
      this.goldToastLayer,
      this.spectatorBanner,
      this.confuseBanner,
      this.damageLayer,
      this.topHud,
      this.dojoRestoreBtn,
      this.dojoPanel,
      this.topActionsBar,
      this.portraitWarning,
      this.countdownEl,
      this.crosshair,
      this.touchControls.root,
      this.abilityBar,
      this.dash,
      this.overlay,
      this.upgradeOverlay,
      this.selectOverlay,
      this.gameOverOverlay
    );

    this.setMatchupInfo('earth', 'earth');
    this.showElementSelector(true, 1);
  }

  _buildElementSelector() {
    const classicRouletteCardHtml = `
      <div class="element-card classic-roulette-card ${this.selectedPlayerElement === 'classic_roulette' ? 'selected' : ''}"
           data-element-card="classic_roulette"
           style="--el-color: #facc15; --el-accent: #f59e0b">
        <div class="card-header">
          <span class="card-icon">🎲</span>
          <h3 class="card-title">RULETA CLÁSICA</h3>
        </div>
        <div class="roulette-mini-icons">
          <span>⛰️</span><span>🔥</span><span>🌊</span><span>🌪️</span>
        </div>
        <div class="roulette-odds-tag">25% cada clásico</div>
      </div>`;

    const cardsHtml =
      classicRouletteCardHtml +
      ELEMENT_KEYS.map((key) => {
        const cfg = ELEMENTS[key];
        const abList = cfg.abilities
          .map((a) => `<li><kbd>${a.key}</kbd><span>${a.name}</span></li>`)
          .join('');
        return `
        <div class="element-card ${key === this.selectedPlayerElement ? 'selected' : ''}"
             data-element-card="${key}"
             style="--el-color: ${cfg.color}; --el-accent: ${cfg.accent}">
          <div class="card-header">
            <span class="card-icon">${cfg.icon}</span>
            <h3 class="card-title">${cfg.name}</h3>
          </div>
          <ul class="card-abilities">${abList}</ul>
          <div class="card-lock-badge hidden" data-lock-badge>🔒 Ruleta Legendaria</div>
        </div>`;
      }).join('');

    const rivalOptions = [
      { id: 'random', label: '🎲 Aleatorios' },
      { id: 'earth', label: '⛰️ Tierra' },
      { id: 'fire', label: '🔥 Fuego' },
      { id: 'water', label: '🌊 Agua' },
      { id: 'air', label: '🌪️ Aire' },
      { id: 'nature', label: '🌿 Naturaleza' },
      { id: 'psychic', label: '🔮 Psíquico' },
      { id: 'storm', label: '⛈️ Tormenta' },
      { id: 'light', label: '✨ Luz' },
      { id: 'shadow', label: '🌑 Sombra' },
      { id: 'samurai', label: '⚔️ Samurái' },
    ]
      .map(
        (opt) => `
        <button type="button"
                class="rival-pill ${opt.id === this.selectedRivalChoice ? 'active' : ''}"
                data-rival-choice="${opt.id}">
          ${opt.label}
        </button>`
      )
      .join('');

    const modeOptions = [
      { id: 'classic', icon: '🏛️', title: 'ARENA CLÁSICA' },
      { id: 'sanctuary', icon: '⛩️', title: 'SANTUARIO ELEMENTAL' },
    ]
      .map(
        (m) => `
        <button type="button"
                class="mode-card ${m.id === this.selectedMode ? 'active' : ''}"
                data-mode-choice="${m.id}">
          <span class="mode-icon">${m.icon}</span>
          <span class="mode-text">
            <strong>${m.title}</strong>
          </span>
        </button>`
      )
      .join('');

    const formatOptions = [
      { id: 'ffa', icon: '⚔️', title: 'BATALLA CAMPAL' },
      { id: 'teams', icon: '🛡️', title: 'EQUIPOS (2v2)' },
      { id: 'dojo', icon: '🥋', title: 'DOJO (ENTRENAMIENTO)' },
      { id: 'survival', icon: '🌊', title: 'SUPERVIVENCIA (OLEADAS)' },
    ]
      .map(
        (f) => `
        <button type="button"
                class="mode-card format-card ${f.id === this.selectedFormat ? 'active' : ''}"
                data-format-choice="${f.id}">
          <span class="mode-icon">${f.icon}</span>
          <span class="mode-text">
            <strong>${f.title}</strong>
          </span>
        </button>`
      )
      .join('');

    const difficultyOptions = [
      { id: 'apprentice', label: '🌱 Aprendiz (Fácil)' },
      { id: 'master', label: '⚔️ Maestro (Normal)' },
      { id: 'grandmaster', label: '👑 Gran Maestro (Difícil)' },
    ]
      .map(
        (d) => `
        <button type="button"
                class="rival-pill difficulty-pill ${d.id === this.selectedDifficulty ? 'active' : ''}"
                data-difficulty="${d.id}">
          ${d.label}
        </button>`
      )
      .join('');

    const botCountOptions = [1, 2, 3, 4, 5, 6]
      .map(
        (n) => `
        <button type="button"
                class="rival-pill ${n === this.selectedBotCount ? 'active' : ''}"
                data-bot-count="${n}">
          ${n} ${n === 1 ? 'Bot' : 'Bots'}
        </button>`
      )
      .join('');

    this.selectOverlay.innerHTML = `
      <div class="select-panel">
        <div class="select-header">
          <div class="header-top-row">
            <div class="menu-step-pills" data-local-step-pills>
              <span class="step-pill active" data-step-pill="1">1. CONFIGURACIÓN</span>
              <span class="step-arrow">→</span>
              <span class="step-pill" data-step-pill="2">2. MAESTRO ELEMENTAL</span>
            </div>
            <div class="header-right-actions">
              <div class="gold-balance-pill" data-gold-balance>
                🪙 <span data-gold-amount>0</span>
              </div>
              <button type="button" class="legendary-gacha-btn" data-open-gacha>
                🎰 RULETA LEGENDARIA <span class="gacha-cost-tag" data-gacha-btn-cost>150 🪙</span>
              </button>
              <button type="button" class="touch-toggle-btn" data-touch-toggle-btn>
                📱 Táctil: OFF
              </button>
              <button type="button" class="online-entry-btn" data-open-online>
                🌐 MULTIJUGADOR ONLINE
              </button>
            </div>
          </div>
          <h1 class="select-title">ARENA ELEMENTAL</h1>
        </div>

        <!-- PASO 1: Configuración de Partida -->
        <div class="menu-step-view" data-step="1">
          <div class="mode-selector-row">
            <span class="rival-label">1. ESCENARIO DE COMBATE</span>
            <div class="mode-cards">
              ${modeOptions}
            </div>
          </div>

          <div class="mode-selector-row">
            <span class="rival-label">2. FORMATO DE COMBATE</span>
            <div class="mode-cards format-cards-grid">
              ${formatOptions}
            </div>
          </div>

          <div class="rival-selector-row botcount-block" data-botcount-row>
            <span class="rival-label" data-botcount-label>CANTIDAD DE BOTS:</span>
            <div class="rival-pills">
              ${botCountOptions}
            </div>
            <span class="format-hint" data-ffa-hint>1 Bot en Arena Clásica activa progresión Etapas 1 → 2</span>
          </div>

          <div class="rival-selector-row difficulty-block" data-difficulty-row>
            <span class="rival-label">3. DIFICULTAD DE IA:</span>
            <div class="rival-pills">
              ${difficultyOptions}
            </div>
          </div>

          <div class="teams-formation-card hidden" data-teams-summary>
            <div class="formation-team blue">
              <span class="team-badge-title">🛡️ EQUIPO AZUL</span>
              <span class="team-members">Tú + 1 Aliado IA (Maestro)</span>
            </div>
            <div class="formation-vs">2 vs 2</div>
            <div class="formation-team red">
              <span class="team-badge-title">🔥 EQUIPO ROJO</span>
              <span class="team-members" data-teams-red-desc>2 Rivales IA</span>
            </div>
          </div>

          <div class="dojo-formation-card hidden" data-dojo-summary>
            <span class="dojo-sum-icon">🥋</span>
            <div class="dojo-sum-text">
              <strong>DOJO DE ENTRENAMIENTO LIBRE</strong>
            </div>
          </div>

          <div class="survival-config-card hidden" data-survival-options>
            <div class="survival-companion-col">
              <span class="rival-label">COMPAÑERO EN HORDA:</span>
              <div class="rival-pills">
                <button type="button" class="rival-pill active" data-survival-companion="solo">
                  🛡️ Solo (1 vs Horda)
                </button>
                <button type="button" class="rival-pill" data-survival-companion="ally">
                  🤝 Con Aliado IA (2 vs Horda)
                </button>
              </div>
            </div>
            <div class="survival-record-badge" data-survival-record>
              🏆 Récord: Oleada 0 · 0 pts
            </div>
          </div>

          <button type="button" class="enter-arena-btn" data-next-step>
            SIGUIENTE: ELEGIR ELEMENTO →
          </button>
        </div>

        <!-- PASO 2: Selección de Maestro Elemental -->
        <div class="menu-step-view hidden" data-step="2">
          <div class="step2-header-bar">
            <button type="button" class="back-step-btn" data-prev-step>← Volver</button>
            <div class="step2-match-summary" data-step2-summary></div>
          </div>

          <div class="element-cards-grid">
            ${cardsHtml}
          </div>

          <div class="rival-selector-row" data-rival-row>
            <span class="rival-label" data-rival-label>ELEMENTOS DE LOS BOTS (IA):</span>
            <div class="rival-pills">
              ${rivalOptions}
            </div>
          </div>

          <button type="button" class="enter-arena-btn" data-enter-arena>
            ¡COMENZAR PARTIDA!
          </button>
        </div>

        <!-- VISTA ONLINE (P2P Host-Authoritativo) -->
        <div class="menu-step-view hidden" data-online-view>
          <!-- Subvista 1: Crear o Unirse a Sala -->
          <div class="online-entry-card" data-online-entry>
            <div class="step2-header-bar">
              <button type="button" class="back-step-btn" data-online-back-local>← Volver al Modo Local</button>
              <span class="online-pill-tag">P2P · HASTA 4 JUGADORES</span>
            </div>

            <div class="online-name-row">
              <label class="rival-label" for="online-player-name">TU NOMBRE DE MAESTRO:</label>
              <input id="online-player-name" type="text" maxlength="16" class="online-input" data-online-name value="Maestro" />
            </div>

            <div class="online-actions-grid">
              <div class="online-box">
                <h3 class="online-box-title">CREAR SALA</h3>
                <p class="online-box-desc">Genera un código de 4 dígitos para invitar a tus amigos como Host.</p>
                <button type="button" class="enter-arena-btn online-btn-compact" data-online-create>
                  CREAR SALA
                </button>
              </div>

              <div class="online-box">
                <h3 class="online-box-title">UNIRSE A SALA</h3>
                <p class="online-box-desc">Ingresa el código de 4 dígitos compartido por el Host.</p>
                <div class="online-join-row">
                  <input type="text" maxlength="4" inputmode="numeric" placeholder="0000" class="online-input code-input" data-online-code-input />
                  <button type="button" class="enter-arena-btn online-btn-compact" data-online-join>
                    Unirse a Sala
                  </button>
                </div>
              </div>
            </div>

            <div class="online-status-banner hidden" data-online-status></div>
          </div>

          <!-- Subvista 2: Sala de Espera (Lobby) -->
          <div class="online-lobby-card hidden" data-online-lobby>
            <div class="lobby-top-bar">
              <button type="button" class="back-step-btn" data-lobby-leave>← Salir de la Sala</button>
              <div class="lobby-code-box">
                <span class="lobby-code-label">CÓDIGO DE SALA</span>
                <strong class="lobby-code-value" data-lobby-code>----</strong>
                <button type="button" class="copy-code-btn" data-lobby-copy>📋 Copiar Código</button>
              </div>
            </div>

            <div class="lobby-main-grid">
              <div class="lobby-col">
                <span class="rival-label">JUGADORES EN SALA (<span data-lobby-count>0</span>/4):</span>
                <div class="lobby-players-list" data-lobby-players></div>
              </div>

              <div class="lobby-col">
                <span class="rival-label">TU ELEMENTO EN EL LOBBY:</span>
                <div class="lobby-elem-grid" data-lobby-elements>
                  <button type="button" class="lobby-elem-btn lobby-elem-classic active" data-lobby-element="classic_roulette">🎲 Ruleta Clásica</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-nature" data-lobby-element="nature">🌿 Naturaleza</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-psychic" data-lobby-element="psychic">🔮 Psíquico</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-storm" data-lobby-element="storm">⛈️ Tormenta</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-light" data-lobby-element="light">✨ Luz</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-shadow" data-lobby-element="shadow">🌑 Sombra</button>
                  <button type="button" class="lobby-elem-btn lobby-elem-samurai" data-lobby-element="samurai">⚔️ Samurái</button>
                </div>

                <div class="lobby-host-config hidden" data-lobby-host-config>
                  <span class="rival-label">CONFIGURACIÓN DE PARTIDA (SOLO HOST):</span>
                  <div class="lobby-config-pills">
                    <button type="button" class="rival-pill active" data-lobby-mode="classic">🏛️ Arena Clásica</button>
                    <button type="button" class="rival-pill" data-lobby-mode="sanctuary">⛩️ Santuario</button>
                  </div>
                  <div class="lobby-config-pills">
                    <button type="button" class="rival-pill active" data-lobby-format="ffa">⚔️ Todos vs Todos</button>
                    <button type="button" class="rival-pill" data-lobby-format="teams">🛡️ Equipos 2v2</button>
                    <button type="button" class="rival-pill" data-lobby-format="survival">🌊 Supervivencia Coop</button>
                  </div>
                </div>

                <div class="lobby-guest-summary hidden" data-lobby-guest-summary></div>
              </div>
            </div>

            <div class="lobby-footer-actions">
              <button type="button" class="secondary-btn lobby-ready-btn" data-lobby-ready>
                ¡Listo!
              </button>
              <button type="button" class="enter-arena-btn lobby-start-btn hidden" data-lobby-start disabled>
                ¡INICIAR PARTIDA ONLINE!
              </button>
            </div>
            <div class="online-status-banner hidden" data-lobby-status></div>
          </div>
        </div>
      </div>

      <!-- Modal Ruleta Legendaria (Gacha sin repetidos) -->
      <div class="roulette-modal-overlay hidden" data-gacha-modal>
        <div class="roulette-modal-card">
          <div class="roulette-modal-header">
            <h3>🎰 RULETA LEGENDARIA</h3>
            <div class="roulette-modal-right">
              <div class="gold-balance-pill">🪙 <span data-gacha-gold-amount>0</span></div>
              <button type="button" class="roulette-close-btn" data-gacha-close>✕</button>
            </div>
          </div>
          <div class="gacha-slots-grid" data-gacha-slots>
            ${LEGENDARY_ELEMENTS.map((key) => {
              const cfg = ELEMENTS[key];
              return `
                <div class="gacha-slot-card" data-gacha-slot="${key}" style="--el-color: ${cfg.color}; --el-accent: ${cfg.accent}">
                  <span class="gacha-slot-icon">${cfg.icon}</span>
                  <strong class="gacha-slot-name">${cfg.name}</strong>
                  <span class="gacha-slot-state" data-gacha-slot-state>🔒 Bloqueado</span>
                </div>`;
            }).join('')}
          </div>
          <div class="gacha-result-banner hidden" data-gacha-result></div>
          <div class="roulette-modal-actions">
            <button type="button" class="enter-arena-btn gacha-spin-btn" data-gacha-spin>
              GIRAR RULETA (150 🪙)
            </button>
            <button type="button" class="secondary-btn hidden" data-gacha-equip>
              Equipar Maestro
            </button>
          </div>
        </div>
      </div>

      <!-- Overlay Ruleta Clásica Pre-Partida -->
      <div class="roulette-modal-overlay hidden" data-classic-roulette-modal>
        <div class="roulette-modal-card classic-roulette-modal">
          <h3 class="classic-roulette-title">🎲 RULETA CLÁSICA</h3>
          <div class="classic-slots-grid" data-classic-slots>
            ${CLASSIC_ELEMENTS.map((key) => {
              const cfg = ELEMENTS[key];
              return `
                <div class="classic-slot-card" data-classic-slot="${key}" style="--el-color: ${cfg.color}; --el-accent: ${cfg.accent}">
                  <span class="classic-slot-icon">${cfg.icon}</span>
                  <strong class="classic-slot-name">${cfg.name}</strong>
                </div>`;
            }).join('')}
          </div>
          <div class="classic-roulette-status" data-classic-roulette-status>Sorteando elemento...</div>
        </div>
      </div>`;

    this._step1El = this.selectOverlay.querySelector('[data-step="1"]');
    this._step2El = this.selectOverlay.querySelector('[data-step="2"]');
    this._stepPill1 = this.selectOverlay.querySelector('[data-step-pill="1"]');
    this._stepPill2 = this.selectOverlay.querySelector('[data-step-pill="2"]');
    this._step2SummaryEl = this.selectOverlay.querySelector('[data-step2-summary]');
    this._botCountRowEl = this.selectOverlay.querySelector('[data-botcount-row]');
    this._botCountLabelEl = this.selectOverlay.querySelector('[data-botcount-label]');
    this._ffaHintEl = this.selectOverlay.querySelector('[data-ffa-hint]');
    this._difficultyRowEl = this.selectOverlay.querySelector('[data-difficulty-row]');
    this._teamsSummaryEl = this.selectOverlay.querySelector('[data-teams-summary]');
    this._teamsRedDescEl = this.selectOverlay.querySelector('[data-teams-red-desc]');
    this._dojoSummaryEl = this.selectOverlay.querySelector('[data-dojo-summary]');
    this._survivalOptionsEl = this.selectOverlay.querySelector('[data-survival-options]');
    this._survivalRecordEl = this.selectOverlay.querySelector('[data-survival-record]');
    this._survivalCompPills = Array.from(this.selectOverlay.querySelectorAll('[data-survival-companion]'));
    this._rivalRowEl = this.selectOverlay.querySelector('[data-rival-row]');
    this._rivalLabelEl = this.selectOverlay.querySelector('[data-rival-label]');
    this._nextStepBtn = this.selectOverlay.querySelector('[data-next-step]');
    this._prevStepBtn = this.selectOverlay.querySelector('[data-prev-step]');
    this._enterArenaBtn = this.selectOverlay.querySelector('[data-enter-arena]');

    // Referencias e interacción de Multijugador Online + Lobby
    this._localStepPillsEl = this.selectOverlay.querySelector('[data-local-step-pills]');
    this._touchToggleBtn = this.selectOverlay.querySelector('[data-touch-toggle-btn]');
    this._openOnlineBtn = this.selectOverlay.querySelector('[data-open-online]');
    this._onlineViewEl = this.selectOverlay.querySelector('[data-online-view]');
    this._onlineEntryEl = this.selectOverlay.querySelector('[data-online-entry]');
    this._onlineLobbyEl = this.selectOverlay.querySelector('[data-online-lobby]');
    this._onlineBackLocalBtn = this.selectOverlay.querySelector('[data-online-back-local]');
    this._onlineNameInput = this.selectOverlay.querySelector('[data-online-name]');
    this._onlineCreateBtn = this.selectOverlay.querySelector('[data-online-create]');
    this._onlineCodeInput = this.selectOverlay.querySelector('[data-online-code-input]');
    this._onlineJoinBtn = this.selectOverlay.querySelector('[data-online-join]');
    this._onlineStatusEl = this.selectOverlay.querySelector('[data-online-status]');
    this._lobbyCodeEl = this.selectOverlay.querySelector('[data-lobby-code]');
    this._lobbyCopyBtn = this.selectOverlay.querySelector('[data-lobby-copy]');
    this._lobbyLeaveBtn = this.selectOverlay.querySelector('[data-lobby-leave]');
    this._lobbyCountEl = this.selectOverlay.querySelector('[data-lobby-count]');
    this._lobbyPlayersEl = this.selectOverlay.querySelector('[data-lobby-players]');
    this._lobbyElemBtns = Array.from(this.selectOverlay.querySelectorAll('[data-lobby-element]'));
    this._lobbyHostConfigEl = this.selectOverlay.querySelector('[data-lobby-host-config]');
    this._lobbyModeBtns = Array.from(this.selectOverlay.querySelectorAll('[data-lobby-mode]'));
    this._lobbyFormatBtns = Array.from(this.selectOverlay.querySelectorAll('[data-lobby-format]'));
    this._lobbyGuestSummaryEl = this.selectOverlay.querySelector('[data-lobby-guest-summary]');
    this._lobbyReadyBtn = this.selectOverlay.querySelector('[data-lobby-ready]');
    this._lobbyStartBtn = this.selectOverlay.querySelector('[data-lobby-start]');
    this._lobbyStatusEl = this.selectOverlay.querySelector('[data-lobby-status]');
    this._lobbyReadyState = false;
    this._lobbyElement = 'classic_roulette';
    this._isOnline = false;

    // Economía & Ruletas
    this._goldAmountEl = this.selectOverlay.querySelector('[data-gold-amount]');
    this._openGachaBtn = this.selectOverlay.querySelector('[data-open-gacha]');
    this._gachaBtnCostEl = this.selectOverlay.querySelector('[data-gacha-btn-cost]');
    this._gachaModalEl = this.selectOverlay.querySelector('[data-gacha-modal]');
    this._gachaGoldAmountEl = this.selectOverlay.querySelector('[data-gacha-gold-amount]');
    this._gachaCloseBtn = this.selectOverlay.querySelector('[data-gacha-close]');
    this._gachaSlotEls = Array.from(this.selectOverlay.querySelectorAll('[data-gacha-slot]'));
    this._gachaResultEl = this.selectOverlay.querySelector('[data-gacha-result]');
    this._gachaSpinBtn = this.selectOverlay.querySelector('[data-gacha-spin]');
    this._gachaEquipBtn = this.selectOverlay.querySelector('[data-gacha-equip]');
    this._classicRouletteModalEl = this.selectOverlay.querySelector('[data-classic-roulette-modal]');
    this._classicSlotEls = Array.from(this.selectOverlay.querySelectorAll('[data-classic-slot]'));
    this._classicRouletteStatusEl = this.selectOverlay.querySelector('[data-classic-roulette-status]');
    this._lastGachaUnlocked = null;

    if (this._openGachaBtn) {
      this._openGachaBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openGachaModal();
      });
    }
    if (this._gachaCloseBtn) {
      this._gachaCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeGachaModal();
      });
    }
    if (this._gachaSpinBtn) {
      this._gachaSpinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._spinGachaRoulette();
      });
    }
    if (this._gachaEquipBtn) {
      this._gachaEquipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const elem = this._lastGachaUnlocked;
        this.closeGachaModal();
        if (elem && this.economy.isUnlocked(elem)) {
          this.selectedPlayerElement = elem;
          this._lobbyElement = elem;
          this._syncStep2ElementCards();
          this._syncEconomyUI();
          if (this._isOnline && this.onOnlineUpdateProfile) {
            this.onOnlineUpdateProfile({ element: elem });
          }
        }
      });
    }

    if (this._touchToggleBtn) {
      this._touchToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onToggleTouchMode) this.onToggleTouchMode();
      });
    }
    if (this._openOnlineBtn) {
      this._openOnlineBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMenuStep('online');
        if (this.onOpenOnline) this.onOpenOnline();
      });
    }
    if (this._onlineBackLocalBtn) {
      this._onlineBackLocalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOnlineLobbyVisible(false);
        this.setMenuStep(1);
        if (this.onCloseOnline) this.onCloseOnline();
      });
    }
    if (this._onlineCreateBtn) {
      this._onlineCreateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onOnlineCreateRoom) {
          const elem = this._lobbyElement === 'classic_roulette' || this.economy.isUnlocked(this._lobbyElement)
            ? this._lobbyElement
            : 'classic_roulette';
          this.onOnlineCreateRoom({
            name: this._onlineNameInput?.value || 'Maestro',
            element: elem || 'classic_roulette',
          });
        }
      });
    }
    if (this._onlineJoinBtn) {
      this._onlineJoinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onOnlineJoinRoom) {
          const elem = this._lobbyElement === 'classic_roulette' || this.economy.isUnlocked(this._lobbyElement)
            ? this._lobbyElement
            : 'classic_roulette';
          this.onOnlineJoinRoom({
            code: this._onlineCodeInput?.value || '',
            name: this._onlineNameInput?.value || 'Maestro',
            element: elem || 'classic_roulette',
          });
        }
      });
    }
    if (this._lobbyCopyBtn) {
      this._lobbyCopyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = this._lobbyCodeEl?.textContent?.trim() || '';
        if (code && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).catch(() => {});
        }
        const orig = this._lobbyCopyBtn.textContent;
        this._lobbyCopyBtn.textContent = '✅ ¡Copiado!';
        setTimeout(() => {
          if (this._lobbyCopyBtn) this._lobbyCopyBtn.textContent = orig;
        }, 1200);
      });
    }
    if (this._lobbyLeaveBtn) {
      this._lobbyLeaveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOnlineLobbyVisible(false);
        this.setMenuStep('online');
        if (this.onCloseOnline) this.onCloseOnline();
      });
    }
    for (const eb of this._lobbyElemBtns) {
      eb.addEventListener('click', (e) => {
        e.stopPropagation();
        const elemId = eb.dataset.lobbyElement;
        if (elemId !== 'classic_roulette' && !this.economy.isUnlocked(elemId)) {
          this.openGachaModal();
          return;
        }
        this._lobbyElement = elemId;
        for (const b of this._lobbyElemBtns) b.classList.toggle('active', b === eb);
        if (this.onOnlineUpdateProfile) this.onOnlineUpdateProfile({ element: this._lobbyElement });
      });
    }
    if (this._lobbyReadyBtn) {
      this._lobbyReadyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._rouletteSpinning) return;
        const nextReady = !this._lobbyReadyState;
        if (nextReady && (this._lobbyElement === 'classic_roulette' || !this.economy.isUnlocked(this._lobbyElement))) {
          this._spinClassicRoulette((resolvedElement) => {
            this._lobbyElement = resolvedElement;
            this._lobbyReadyState = true;
            this._lobbyReadyBtn.classList.add('is-ready');
            this._lobbyReadyBtn.textContent = '✅ Listo';
            if (this.onOnlineUpdateProfile) {
              this.onOnlineUpdateProfile({ element: resolvedElement, ready: true });
            }
          });
          return;
        }
        this._lobbyReadyState = nextReady;
        this._lobbyReadyBtn.classList.toggle('is-ready', this._lobbyReadyState);
        this._lobbyReadyBtn.textContent = this._lobbyReadyState ? '✅ Listo' : '¡Listo!';
        if (this.onOnlineUpdateProfile) this.onOnlineUpdateProfile({ ready: this._lobbyReadyState });
      });
    }
    for (const mb of this._lobbyModeBtns) {
      mb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onOnlineUpdateSettings) this.onOnlineUpdateSettings({ mode: mb.dataset.lobbyMode });
      });
    }
    for (const fb of this._lobbyFormatBtns) {
      fb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onOnlineUpdateSettings) this.onOnlineUpdateSettings({ format: fb.dataset.lobbyFormat });
      });
    }
    if (this._lobbyStartBtn) {
      this._lobbyStartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onOnlineStartMatch) this.onOnlineStartMatch();
      });
    }

    this._cardEls = Array.from(this.selectOverlay.querySelectorAll('[data-element-card]'));
    this._elementGridEl = this.selectOverlay.querySelector('.element-cards-grid');
    for (const card of this._cardEls) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const elemId = card.dataset.elementCard;
        if (card.classList.contains('locked')) {
          this.openGachaModal();
          return;
        }
        this.selectedPlayerElement = elemId;
        for (const c of this._cardEls) {
          c.classList.toggle('selected', c.dataset.elementCard === this.selectedPlayerElement);
        }
      });
    }

    this._modeCardEls = Array.from(this.selectOverlay.querySelectorAll('[data-mode-choice]'));
    for (const mc of this._modeCardEls) {
      mc.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedMode = mc.dataset.modeChoice;
        this.selectedBotCount = this.selectedMode === 'sanctuary' ? this._sanctuaryBotCount : this._classicBotCount;
        this._syncStep1UI();
        this._emitConfigChange();
      });
    }

    this._formatCardEls = Array.from(this.selectOverlay.querySelectorAll('[data-format-choice]'));
    for (const fc of this._formatCardEls) {
      fc.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedFormat = fc.dataset.formatChoice;
        this._syncStep1UI();
        this._emitConfigChange();
      });
    }

    this._difficultyPillEls = Array.from(this.selectOverlay.querySelectorAll('[data-difficulty]'));
    for (const dp of this._difficultyPillEls) {
      dp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedDifficulty = dp.dataset.difficulty;
        this._syncStep1UI();
        this._emitConfigChange();
      });
    }

    this._rivalPillEls = Array.from(this.selectOverlay.querySelectorAll('[data-rival-choice]'));
    for (const pill of this._rivalPillEls) {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedRivalChoice = pill.dataset.rivalChoice;
        for (const p of this._rivalPillEls) {
          p.classList.toggle('active', p.dataset.rivalChoice === this.selectedRivalChoice);
        }
      });
    }

    this._botCountPillEls = Array.from(this.selectOverlay.querySelectorAll('[data-bot-count]'));
    for (const pill of this._botCountPillEls) {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const count = Number(pill.dataset.botCount) || 1;
        this.selectedBotCount = count;
        if (this.selectedMode === 'sanctuary') this._sanctuaryBotCount = count;
        else this._classicBotCount = Math.min(2, count);
        this._syncStep1UI();
        this._emitConfigChange();
      });
    }

    for (const cp of this._survivalCompPills) {
      cp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedSurvivalCompanion = cp.dataset.survivalCompanion;
        this._syncStep1UI();
        this._emitConfigChange();
      });
    }

    this._nextStepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMenuStep(2);
    });

    this._prevStepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMenuStep(1);
    });

    this._enterArenaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._triggerStartFromSelector();
    });

    this._syncStep1UI();
    this.setMenuStep(1);
  }

  _emitConfigChange() {
    if (!this.onConfigChange) return;
    const botCount =
      this.selectedFormat === 'teams'
        ? 3
        : this.selectedFormat === 'dojo'
          ? 1
          : this.selectedFormat === 'survival'
            ? (this.selectedSurvivalCompanion === 'ally' ? 1 : 0)
            : this.selectedBotCount;
    this.onConfigChange({
      mode: this.selectedMode,
      format: this.selectedFormat,
      difficulty: this.selectedDifficulty,
      survivalCompanion: this.selectedSurvivalCompanion,
      botCount,
    });
  }

  /** Actualiza el récord mostrado en el Paso 1 de Supervivencia */
  setSurvivalRecord({ maxWave = 0, highScore = 0 } = {}) {
    this._survivalRecord = { maxWave, highScore };
    if (this._survivalRecordEl) {
      this._survivalRecordEl.textContent =
        maxWave > 0
          ? `🏆 Récord: Oleada ${maxWave} · ${highScore} pts`
          : '🏆 Récord: Sin registro aún';
    }
  }

  _getDifficultyLabel(id = this.selectedDifficulty) {
    return id === 'apprentice' ? 'Aprendiz' : id === 'grandmaster' ? 'Gran Maestro' : 'Maestro';
  }

  _syncStep1UI() {
    const isSanctuary = this.selectedMode === 'sanctuary';
    const isTeams = this.selectedFormat === 'teams';
    const isDojo = this.selectedFormat === 'dojo';
    const isSurvival = this.selectedFormat === 'survival';

    if (!isSanctuary && this.selectedBotCount > 2) {
      this.selectedBotCount = 1;
    }

    for (const btn of this._modeCardEls) {
      btn.classList.toggle('active', btn.dataset.modeChoice === this.selectedMode);
    }
    for (const btn of this._formatCardEls) {
      btn.classList.toggle('active', btn.dataset.formatChoice === this.selectedFormat);
    }
    for (const dp of this._difficultyPillEls) {
      dp.classList.toggle('active', dp.dataset.difficulty === this.selectedDifficulty);
    }
    for (const cp of this._survivalCompPills) {
      cp.classList.toggle('active', cp.dataset.survivalCompanion === this.selectedSurvivalCompanion);
    }

    if (this._botCountRowEl) {
      this._botCountRowEl.classList.toggle('hidden', isTeams || isDojo || isSurvival);
    }
    if (this._difficultyRowEl) {
      this._difficultyRowEl.classList.toggle('hidden', isDojo);
    }
    if (this._teamsSummaryEl) {
      this._teamsSummaryEl.classList.toggle('hidden', !isTeams);
    }
    if (this._teamsRedDescEl) {
      this._teamsRedDescEl.textContent = `2 Rivales IA (${this._getDifficultyLabel()})`;
    }
    if (this._dojoSummaryEl) {
      this._dojoSummaryEl.classList.toggle('hidden', !isDojo);
    }
    if (this._survivalOptionsEl) {
      this._survivalOptionsEl.classList.toggle('hidden', !isSurvival);
    }
    if (!isDojo) {
      this.selectedRivalChoice = 'random';
      if (this._rivalPillEls) {
        for (const p of this._rivalPillEls) {
          p.classList.toggle('active', p.dataset.rivalChoice === 'random');
        }
      }
    }
    if (this._rivalRowEl) {
      this._rivalRowEl.classList.toggle('hidden', !isDojo);
    }
    if (this._rivalLabelEl) {
      this._rivalLabelEl.textContent = 'ELEMENTO DEL RIVAL DE PRÁCTICA:';
    }

    for (const pill of this._botCountPillEls) {
      const n = Number(pill.dataset.botCount);
      const allowed = isSanctuary || n <= 2;
      pill.classList.toggle('hidden', !allowed);
      pill.classList.toggle('active', n === this.selectedBotCount);
    }

    if (this._botCountLabelEl) {
      this._botCountLabelEl.textContent = isSanctuary
        ? 'CANTIDAD DE BOTS (SANTUARIO):'
        : 'CANTIDAD DE BOTS (ARENA CLÁSICA):';
    }
    if (this._ffaHintEl) {
      this._ffaHintEl.classList.toggle('hidden', isSanctuary);
      this._ffaHintEl.textContent =
        this.selectedBotCount === 1
          ? 'Modo Campaña: Etapa 1 (Duelo 1v1) → Etapa 2 (Campal)'
          : 'Batalla Campal directa de 3 luchadores en Arena Clásica';
    }

    this._updateStep2Summary();
    this._syncStep2ElementCards();
    this._syncEconomyUI();
  }

  _updateStep2Summary() {
    if (!this._step2SummaryEl) return;
    const modeLabel = this.selectedMode === 'sanctuary' ? '⛩️ Santuario Elemental' : '🏛️ Arena Clásica';
    const diffLabel = this._getDifficultyLabel();
    let formatLabel = '';
    if (this.selectedFormat === 'survival') {
      const compLabel = this.selectedSurvivalCompanion === 'ally' ? 'Con Aliado IA (2 vs Horda)' : 'Solo (1 vs Horda)';
      formatLabel = `🌊 Supervivencia · ${compLabel} · IA ${diffLabel}`;
    } else if (this.selectedFormat === 'dojo') {
      formatLabel = '🥋 Dojo (Entrenamiento Libre)';
    } else if (this.selectedFormat === 'teams') {
      formatLabel = `🛡️ Equipos 2v2 · IA ${diffLabel}`;
    } else if (this.selectedMode === 'classic' && this.selectedBotCount === 1) {
      formatLabel = `⚔️ Campal · 1 Bot (Etapas 1→2) · IA ${diffLabel}`;
    } else {
      formatLabel = `⚔️ Campal · ${this.selectedBotCount} ${this.selectedBotCount === 1 ? 'Bot' : 'Bots'} · IA ${diffLabel}`;
    }
    this._step2SummaryEl.textContent = `${modeLabel} · ${formatLabel}`;
  }

  /** Cambia entre Paso 1, Paso 2 o la vista Multijugador Online */
  setMenuStep(step = 1) {
    const isOnlineStep = step === 'online';
    this._menuStep = isOnlineStep ? 'online' : step === 2 ? 2 : 1;
    if (this._step1El) this._step1El.classList.toggle('hidden', this._menuStep !== 1);
    if (this._step2El) this._step2El.classList.toggle('hidden', this._menuStep !== 2);
    if (this._onlineViewEl) this._onlineViewEl.classList.toggle('hidden', !isOnlineStep);
    if (this._localStepPillsEl) this._localStepPillsEl.classList.toggle('hidden', isOnlineStep);
    if (this._openOnlineBtn) this._openOnlineBtn.classList.toggle('hidden', isOnlineStep);
    if (this._stepPill1) this._stepPill1.classList.toggle('active', this._menuStep === 1);
    if (this._stepPill2) this._stepPill2.classList.toggle('active', this._menuStep === 2);
    if (this._rivalRowEl) this._rivalRowEl.classList.toggle('hidden', this.selectedFormat !== 'dojo');
    if (this._menuStep === 2) {
      this._updateStep2Summary();
      this._syncStep2ElementCards();
    }
    this._syncEconomyUI();
  }

  setOnlineMode(active) {
    this._isOnline = !!active;
  }

  setOnlineStatus(msg = '', isError = false) {
    const targets = [this._onlineStatusEl, this._lobbyStatusEl];
    for (const elBox of targets) {
      if (!elBox) continue;
      elBox.textContent = msg;
      elBox.classList.toggle('hidden', !msg);
      elBox.classList.toggle('is-error', !!isError);
    }
  }

  setOnlineLobbyVisible(visible) {
    if (this._onlineEntryEl) this._onlineEntryEl.classList.toggle('hidden', !!visible);
    if (this._onlineLobbyEl) this._onlineLobbyEl.classList.toggle('hidden', !visible);
  }

  /** Actualiza la Sala de Espera (Lobby) con la lista de jugadores y configuración */
  updateOnlineLobby({ roomCode, players = [], settings = {} }, role = 'guest', localId = '') {
    this.setMenuStep('online');
    this.setOnlineLobbyVisible(true);
    if (this._lobbyCodeEl) this._lobbyCodeEl.textContent = roomCode || '----';
    if (this._lobbyCountEl) this._lobbyCountEl.textContent = String(players.length);

    if (this._lobbyPlayersEl) {
      const slotsHtml = [];
      for (let i = 0; i < 4; i++) {
        const p = players[i];
        if (!p) {
          slotsHtml.push(`
            <div class="lobby-player-row empty">
              <span class="lp-name">Esperando jugador...</span>
              <span class="lp-status">Vacío</span>
            </div>`);
          continue;
        }
        const isRoulette = p.element === 'classic_roulette';
        const cfg = isRoulette ? { color: '#facc15', icon: '🎲', name: 'Ruleta Clásica' } : getElementConfig(p.element || 'earth');
        const isMe = p.id === localId;
        slotsHtml.push(`
          <div class="lobby-player-row ${p.ready ? 'ready' : ''}" data-lobby-player-id="${p.id}">
            <div class="lp-left">
              <span class="lp-role-badge ${p.isHost ? 'host' : 'guest'}">${p.isHost ? 'HOST' : 'INVITADO'}</span>
              <span class="lp-name">${p.name}${isMe ? ' (Tú)' : ''}</span>
            </div>
            <div class="lp-right">
              <span class="lp-elem" style="color:${cfg.color}">${cfg.icon} ${cfg.name}</span>
              <span class="lp-ready ${p.ready ? 'ok' : ''}">${p.ready ? '✅ Listo' : '⏳ Espera'}</span>
            </div>
          </div>`);
      }
      this._lobbyPlayersEl.innerHTML = slotsHtml.join('');
    }

    const me = players.find((p) => p.id === localId);
    if (me) {
      this._lobbyReadyState = !!me.ready;
      this._lobbyElement = me.element || this._lobbyElement;
      for (const b of this._lobbyElemBtns) {
        b.classList.toggle('active', b.dataset.lobbyElement === this._lobbyElement);
      }
      if (this._lobbyReadyBtn) {
        this._lobbyReadyBtn.classList.toggle('is-ready', this._lobbyReadyState);
        this._lobbyReadyBtn.textContent = this._lobbyReadyState ? '✅ Listo' : '¡Listo!';
      }
    }

    const isHost = role === 'host';
    if (this._lobbyHostConfigEl) this._lobbyHostConfigEl.classList.toggle('hidden', !isHost);
    if (this._lobbyGuestSummaryEl) this._lobbyGuestSummaryEl.classList.toggle('hidden', isHost);

    const curMode = settings.mode || 'classic';
    const curFormat = settings.format || 'ffa';
    for (const mb of this._lobbyModeBtns) {
      mb.classList.toggle('active', mb.dataset.lobbyMode === curMode);
    }
    for (const fb of this._lobbyFormatBtns) {
      fb.classList.toggle('active', fb.dataset.lobbyFormat === curFormat);
    }

    if (!isHost && this._lobbyGuestSummaryEl) {
      const mLabel = curMode === 'sanctuary' ? '⛩️ Santuario Elemental' : '🏛️ Arena Clásica';
      const fLabel =
        curFormat === 'teams'
          ? '🛡️ Equipos 2v2'
          : curFormat === 'survival'
            ? '🌊 Supervivencia Cooperativa'
            : '⚔️ Todos contra Todos';
      this._lobbyGuestSummaryEl.textContent = `Sala configurada por Host: ${mLabel} · ${fLabel}`;
    }

    if (this._lobbyStartBtn) {
      this._lobbyStartBtn.classList.toggle('hidden', !isHost);
      const allReady = players.length >= 2 && players.every((p) => p.ready);
      this._lobbyStartBtn.disabled = !allReady;
      if (isHost) {
        if (players.length < 2) {
          this.setOnlineStatus('Comparte el código de sala para que se una al menos 1 jugador.');
        } else if (!allReady) {
          this.setOnlineStatus('Esperando a que todos los jugadores marquen "¡Listo!".');
        } else {
          this.setOnlineStatus('¡Todos listos! Ya puedes iniciar la partida online.');
        }
      } else {
        this.setOnlineStatus(me?.ready ? '¡Listo! Esperando a que el Host inicie la partida.' : 'Elige tu elemento y presiona "¡Listo!".');
      }
    }
  }

  _triggerStartFromSelector() {
    if (this._rouletteSpinning) return;
    const format = this.selectedFormat || 'ffa';
    const rawElement = this.selectedPlayerElement || (format === 'dojo' ? 'earth' : 'classic_roulette');
    const launch = (resolvedElement) => {
      let rivalElement = format === 'dojo' ? this.selectedRivalChoice : 'random';
      if (!rivalElement || rivalElement === 'random') {
        rivalElement = ELEMENT_KEYS[Math.floor(Math.random() * ELEMENT_KEYS.length)];
      }
      const botCount =
        format === 'teams'
          ? 3
          : format === 'dojo'
            ? 1
            : format === 'survival'
              ? (this.selectedSurvivalCompanion === 'ally' ? 1 : 0)
              : this.selectedBotCount || 1;
      if (this.onStartDuel) {
        this.onStartDuel({
          playerElement: resolvedElement,
          rivalElement,
          mode: this.selectedMode || 'classic',
          format,
          difficulty: this.selectedDifficulty || 'master',
          survivalCompanion: this.selectedSurvivalCompanion || 'solo',
          botCount,
        });
      }
    };

    if (format !== 'dojo' && (rawElement === 'classic_roulette' || !this.economy.isUnlocked(rawElement))) {
      this._spinClassicRoulette((resolved) => launch(resolved));
      return;
    }
    launch(rawElement);
  }

  /** Conecta SoundManager para efectos de ruleta y monedas */
  setSoundManager(sound) {
    this._sound = sound;
    if (this.economy && !this._econUnsub) {
      this._econUnsub = this.economy.onChange(() => {
        this._syncEconomyUI();
        this._syncStep2ElementCards();
      });
      this._syncEconomyUI();
      this._syncStep2ElementCards();
    }
  }

  /** Aviso flotante limpio al cobrar oro en oleadas de Supervivencia */
  showGoldToast(amount, label = 'Oleada completada') {
    if (!this.goldToastLayer || !amount) return;
    const toast = el('div', 'gold-toast');
    toast.innerHTML = `<span class="gt-amount">+${amount} 🪙</span><span class="gt-label">${label}</span>`;
    this.goldToastLayer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, 2400);
  }

  /** Sincroniza contadores de oro, botón de Ruleta Legendaria y botones del Lobby */
  _syncEconomyUI() {
    const gold = this.economy.getGold();
    const nextCost = this.economy.getNextLegendaryCost();
    if (this._goldAmountEl) this._goldAmountEl.textContent = String(gold);
    if (this._gachaGoldAmountEl) this._gachaGoldAmountEl.textContent = String(gold);
    if (this._gachaBtnCostEl) {
      this._gachaBtnCostEl.textContent = nextCost !== null ? `${nextCost} 🪙` : 'COMPLETO';
    }
    if (this._openGachaBtn) {
      this._openGachaBtn.classList.toggle('can-afford', nextCost !== null && gold >= nextCost);
      this._openGachaBtn.classList.toggle('is-complete', nextCost === null);
    }

    if (this._gachaSlotEls) {
      for (const slot of this._gachaSlotEls) {
        const key = slot.dataset.gachaSlot;
        const unlocked = this.economy.isUnlocked(key);
        slot.classList.toggle('unlocked', unlocked);
        slot.classList.toggle('locked', !unlocked);
        const stateEl = slot.querySelector('[data-gacha-slot-state]');
        if (stateEl) stateEl.textContent = unlocked ? '✅ Desbloqueado' : '🔒 Bloqueado';
      }
    }

    if (this._gachaSpinBtn) {
      if (nextCost === null) {
        this._gachaSpinBtn.textContent = '¡TODOS DESBLOQUEADOS!';
        this._gachaSpinBtn.disabled = true;
      } else {
        this._gachaSpinBtn.textContent = `GIRAR RULETA (${nextCost} 🪙)`;
        this._gachaSpinBtn.disabled = this._rouletteSpinning || gold < nextCost;
      }
    }

    if (this._lobbyElemBtns) {
      if (this._lobbyElement !== 'classic_roulette' && !this.economy.isUnlocked(this._lobbyElement)) {
        this._lobbyElement = 'classic_roulette';
      }
      for (const eb of this._lobbyElemBtns) {
        const elemId = eb.dataset.lobbyElement;
        const unlocked = elemId === 'classic_roulette' || this.economy.isUnlocked(elemId);
        eb.classList.toggle('locked', !unlocked);
        eb.classList.toggle('active', elemId === this._lobbyElement);
        const cfg = elemId === 'classic_roulette' ? null : ELEMENTS[elemId];
        if (cfg) {
          eb.textContent = unlocked ? `${cfg.icon} ${cfg.name}` : `🔒 ${cfg.name}`;
        }
      }
    }
  }

  /** Muestra los 10 personajes en Dojo (5×2) o Ruleta Clásica + Legendarios en los demás formatos */
  _syncStep2ElementCards() {
    if (!this._cardEls) return;
    const isDojo = this.selectedFormat === 'dojo';
    if (this._elementGridEl) {
      this._elementGridEl.classList.toggle('dojo-grid-5x2', isDojo);
    }

    if (isDojo) {
      if (this.selectedPlayerElement === 'classic_roulette' || !ELEMENT_KEYS.includes(this.selectedPlayerElement)) {
        this.selectedPlayerElement = 'earth';
      }
    } else if (
      this.selectedPlayerElement !== 'classic_roulette' &&
      !(this.economy.isLegendary(this.selectedPlayerElement) && this.economy.isUnlocked(this.selectedPlayerElement))
    ) {
      this.selectedPlayerElement = 'classic_roulette';
    }

    for (const card of this._cardEls) {
      const id = card.dataset.elementCard;
      const lockBadge = card.querySelector('[data-lock-badge]');
      if (isDojo) {
        const show = id !== 'classic_roulette';
        card.classList.toggle('hidden', !show);
        card.classList.remove('locked');
        if (lockBadge) lockBadge.classList.add('hidden');
      } else if (id === 'classic_roulette') {
        card.classList.remove('hidden', 'locked');
      } else if (this.economy.isClassic(id)) {
        card.classList.add('hidden');
        card.classList.remove('locked');
      } else {
        const unlocked = this.economy.isUnlocked(id);
        card.classList.remove('hidden');
        card.classList.toggle('locked', !unlocked);
        if (lockBadge) lockBadge.classList.toggle('hidden', unlocked);
      }
      card.classList.toggle('selected', id === this.selectedPlayerElement);
    }
  }

  openGachaModal() {
    if (!this._gachaModalEl || this._rouletteSpinning) return;
    this._lastGachaUnlocked = null;
    if (this._gachaResultEl) this._gachaResultEl.classList.add('hidden');
    if (this._gachaEquipBtn) this._gachaEquipBtn.classList.add('hidden');
    for (const s of this._gachaSlotEls) s.classList.remove('spinning', 'won');
    this._syncEconomyUI();
    this._gachaModalEl.classList.remove('hidden');
  }

  closeGachaModal() {
    if (!this._gachaModalEl || this._rouletteSpinning) return;
    this._gachaModalEl.classList.add('hidden');
  }

  _spinGachaRoulette() {
    if (this._rouletteSpinning || !this.economy.canRollLegendary()) return;
    const lockedBefore = this.economy.getLockedLegendaries();
    const res = this.economy.rollLegendaryGacha();
    if (!res) return;

    this._rouletteSpinning = true;
    this._lastGachaUnlocked = res.unlockedElement;
    if (this._gachaSpinBtn) this._gachaSpinBtn.disabled = true;
    if (this._gachaCloseBtn) this._gachaCloseBtn.disabled = true;
    if (this._gachaEquipBtn) this._gachaEquipBtn.classList.add('hidden');
    if (this._gachaResultEl) this._gachaResultEl.classList.add('hidden');

    const candidateEls = this._gachaSlotEls.filter((elSlot) =>
      lockedBefore.includes(elSlot.dataset.gachaSlot)
    );
    const totalSteps = Math.max(12, candidateEls.length * 4 + 3);
    const winnerIdx = Math.max(0, candidateEls.findIndex((elSlot) => elSlot.dataset.gachaSlot === res.unlockedElement));
    let step = 0;
    const totalDuration = 2200;
    const startTime = performance.now();

    const advance = () => {
      for (const s of this._gachaSlotEls) s.classList.remove('spinning', 'won');
      const isFinal = step >= totalSteps;
      const activeSlot = isFinal
        ? candidateEls[winnerIdx]
        : candidateEls[(winnerIdx + step) % candidateEls.length];
      if (activeSlot) activeSlot.classList.add(isFinal ? 'won' : 'spinning');

      if (isFinal) {
        if (this._sound && this._sound.playRouletteWin) this._sound.playRouletteWin(true);
        this._rouletteSpinning = false;
        if (this._gachaCloseBtn) this._gachaCloseBtn.disabled = false;
        this._syncEconomyUI();
        this._syncStep2ElementCards();
        const cfg = ELEMENTS[res.unlockedElement];
        if (this._gachaResultEl && cfg) {
          this._gachaResultEl.innerHTML = `✨ ¡Desbloqueaste a <strong>${cfg.icon} ${cfg.name}</strong>!`;
          this._gachaResultEl.classList.remove('hidden');
        }
        if (this._gachaEquipBtn) this._gachaEquipBtn.classList.remove('hidden');
        return;
      }

      if (this._sound && this._sound.playRouletteTick) {
        this._sound.playRouletteTick(step / totalSteps);
      }
      step += 1;
      const progress = step / totalSteps;
      const delay = 55 + Math.pow(progress, 2.2) * 195;
      const elapsed = performance.now() - startTime;
      const clampedDelay = step === totalSteps ? Math.max(120, totalDuration - elapsed) : delay;
      setTimeout(advance, Math.max(40, clampedDelay));
    };

    advance();
  }

  _spinClassicRoulette(onComplete) {
    if (!this._classicRouletteModalEl || this._classicSlotEls.length === 0) {
      if (onComplete) onComplete(this.economy.rollClassicElement());
      return;
    }
    this._rouletteSpinning = true;
    const winner = this.economy.rollClassicElement();
    const winnerIdx = Math.max(0, CLASSIC_ELEMENTS.indexOf(winner));
    for (const s of this._classicSlotEls) s.classList.remove('spinning', 'won');
    if (this._classicRouletteStatusEl) {
      this._classicRouletteStatusEl.textContent = 'Sorteando elemento clásico...';
    }
    this._classicRouletteModalEl.classList.remove('hidden');

    const totalSteps = 16;
    let step = 0;

    const advance = () => {
      for (const s of this._classicSlotEls) s.classList.remove('spinning', 'won');
      const isFinal = step >= totalSteps;
      const idx = isFinal ? winnerIdx : (winnerIdx + step) % this._classicSlotEls.length;
      const slot = this._classicSlotEls[idx];
      if (slot) slot.classList.add(isFinal ? 'won' : 'spinning');

      if (isFinal) {
        if (this._sound && this._sound.playRouletteWin) this._sound.playRouletteWin(false);
        const cfg = ELEMENTS[winner];
        if (this._classicRouletteStatusEl && cfg) {
          this._classicRouletteStatusEl.textContent = `¡Elemento asignado: ${cfg.icon} ${cfg.name}!`;
        }
        setTimeout(() => {
          this._classicRouletteModalEl.classList.add('hidden');
          this._rouletteSpinning = false;
          if (onComplete) onComplete(winner);
        }, 500);
        return;
      }

      if (this._sound && this._sound.playRouletteTick) {
        this._sound.playRouletteTick(step / totalSteps);
      }
      step += 1;
      const progress = step / totalSteps;
      const delay = 55 + Math.pow(progress, 2.0) * 145;
      setTimeout(advance, delay);
    };

    advance();
  }

  /** Conecta TouchControls con InputManager */
  setTouchInput(input) {
    if (this.touchControls) this.touchControls.setInput(input);
  }

  /** Actualiza UI cuando se activa/desactiva el Modo Táctil */
  setTouchMode(enabled) {
    this._isTouchMode = !!enabled;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('touch-mode', this._isTouchMode);
      document.body.classList.toggle('touch-mode-active', this._isTouchMode);
    }
    if (this.root) {
      this.root.classList.toggle('touch-mode-active', this._isTouchMode);
    }
    if (this._touchToggleBtn) {
      this._touchToggleBtn.classList.toggle('active', this._isTouchMode);
      this._touchToggleBtn.textContent = this._isTouchMode ? '📱 Táctil: ON' : '📱 Táctil: OFF';
    }
    if (this._overlayCta) {
      this._overlayCta.textContent = this._isTouchMode
        ? 'Toca Continuar para volver al combate'
        : 'Haz clic en la arena para continuar';
    }
    this._refreshTouchOverlay();
    this._syncCrosshairVisibility();
  }

  /** Alterna Pantalla Completa e intenta bloquear orientación horizontal */
  async toggleFullscreen() {
    if (typeof document === 'undefined') return false;
    const rootEl = document.documentElement;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!fsEl) {
        if (rootEl.requestFullscreen) {
          await rootEl.requestFullscreen();
        } else if (rootEl.webkitRequestFullscreen) {
          rootEl.webkitRequestFullscreen();
        }
        try {
          if (screen && screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          }
        } catch {
          // Navegador o dispositivo no permite orientation.lock
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch {
      // Ignora silenciosamente rechazos de permisos de fullscreen en entornos headless
    }
    this._syncFullscreenState();
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  _syncFullscreenState() {
    if (!this.fullscreenBtn) return;
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    this.fullscreenBtn.classList.toggle('active', active);
    this.fullscreenBtn.innerHTML = active ? `<span class="util-icon">🗗</span>` : `<span class="util-icon">⛶</span>`;
  }

  _toggleManualPause() {
    if (this._isSelecting || this._isGameOver || this._isChoosingUpgrade) return;
    if (this._isOnline) {
      this._manualPauseOpen = !this._manualPauseOpen;
      this.overlay.classList.toggle('hidden', !this._manualPauseOpen);
      this._refreshTouchOverlay();
      this._syncCrosshairVisibility();
      return;
    }
    if (this._isLocked) {
      this._manualPauseOpen = true;
      if (this.onTouchPause) this.onTouchPause();
      this._syncCrosshairVisibility();
    } else {
      this._resumeFromPause();
    }
  }

  _resumeFromPause() {
    this._manualPauseOpen = false;
    if (this._isOnline) {
      this.overlay.classList.add('hidden');
      this._refreshTouchOverlay();
      this._syncCrosshairVisibility();
      return;
    }
    if (this.onTouchResume) this.onTouchResume();
  }

  /** Actualiza visibilidad del HUD táctil, botón pausa móvil y aviso de orientación */
  _refreshTouchOverlay() {
    const inGameplay = !this._isSelecting && !this._isGameOver && !this._isChoosingUpgrade;
    const showTouchHud = this._isTouchMode && this._isLocked && inGameplay && !this._manualPauseOpen;
    if (this.topActionsBar) {
      this.topActionsBar.classList.toggle('in-match', !this._isSelecting);
    }
    if (this.touchControls) {
      this.touchControls.setVisible(showTouchHud);
    }
    if (this.pauseBtn) {
      this.pauseBtn.classList.toggle('hidden', !this._isTouchMode || !inGameplay);
    }
    this.updateOrientationNotice();
  }

  /** Muestra aviso sutil no bloqueante si el móvil está en vertical durante el combate */
  updateOrientationNotice() {
    if (!this.portraitWarning) return;
    const isPortrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const inCombat = !this._isSelecting && !this._isGameOver && !this._isChoosingUpgrade;
    this.portraitWarning.classList.toggle('hidden', !(this._isTouchMode && inCombat && isPortrait));
  }

  /** Muestra u oculta la pantalla de selección de elemento */
  showElementSelector(visible, step = null) {
    this._isSelecting = !!visible;
    if (visible) this._manualPauseOpen = false;
    this.selectOverlay.classList.toggle('hidden', !visible);
    if (visible) {
      if (step === 1 || step === 2 || step === 'online') {
        this.setMenuStep(step);
      }
      this._isGameOver = false;
      this.gameOverOverlay.classList.add('hidden');
      this.overlay.classList.add('hidden');
      this.crosshair.classList.remove('visible');
      this.setSpectatingAlly(false);
      this.setDojoPanelVisible(false);
      this.hideUpgradeModal();
      this._refreshTouchOverlay();
    } else {
      this.setLocked(this._isLocked);
    }
  }

  /**
   * Actualiza los títulos superiores, colores, barras de rivales y nombres
   * de las 4 ranuras inferiores según los elementos activos y la etapa actual.
   * @param {'earth'|'fire'|'water'|'air'} playerElement
   * @param {'earth'|'fire'|'water'|'air'} enemyElement
   * @param {number} [stage=1]
   * @param {string[]|null} [enemyElements=null]
   */
  setMatchupInfo(playerElement, enemyElement, stage = 1, enemyElements = null, mode = 'classic', format = 'ffa', allyElement = null, onlineRivalNames = null) {
    this._stage = stage;
    this._mode = mode;
    this._format = format;
    const pCfg = getElementConfig(playerElement);
    this._currentElementCfg = pCfg;
    if (this.touchControls) {
      this.touchControls.setElement(playerElement);
      this.touchControls.syncState({
        abilities: this._lastAbilities,
        dashReadiness: this._lastDashReadiness,
        auraState: this._lastAuraState,
        elementConfig: pCfg,
      });
    }
    const eList = enemyElements && enemyElements.length > 0 ? enemyElements : [enemyElement];
    const isSanctuary = mode === 'sanctuary';
    const isTeams = format === 'teams';
    const isDojo = format === 'dojo';
    const isSurvival = format === 'survival';
    const hasAllyInMatch = isTeams || (isSurvival && !!allyElement);

    if (this._stageBadgeEl) {
      this._stageBadgeEl.classList.remove('stage-2', 'sanctuary-badge', 'teams-badge', 'dojo-badge', 'survival-badge');
      if (isSurvival) {
        this._stageBadgeEl.textContent = `SUPERVIVENCIA · ${isSanctuary ? 'SANTUARIO' : 'ARENA'}`;
        this._stageBadgeEl.classList.add('survival-badge');
      } else if (isDojo) {
        this._stageBadgeEl.textContent = `DOJO · ${isSanctuary ? 'SANTUARIO' : 'ARENA CLÁSICA'}`;
        this._stageBadgeEl.classList.add('dojo-badge');
      } else if (isTeams) {
        this._stageBadgeEl.textContent = `EQUIPOS 2v2 · ${isSanctuary ? 'SANTUARIO' : 'ARENA'}`;
        this._stageBadgeEl.classList.add('teams-badge');
      } else if (isSanctuary) {
        this._stageBadgeEl.textContent = `SANTUARIO ELEMENTAL · ${eList.length} ${eList.length === 1 ? 'RIVAL' : 'RIVALES'}`;
        this._stageBadgeEl.classList.add('sanctuary-badge');
      } else {
        this._stageBadgeEl.textContent = stage === 2 ? 'ETAPA 2: BATALLA CAMPAL' : 'ETAPA 1: DUELO';
        this._stageBadgeEl.classList.toggle('stage-2', stage === 2);
      }
    }

    if (this._brStatsEl) {
      this._brStatsEl.classList.toggle('hidden', isTeams || isDojo || isSurvival || !isSanctuary);
    }
    if (this._survivalStatsEl) {
      this._survivalStatsEl.classList.toggle('hidden', !isSurvival);
    }
    if (this._teamStatsEl) {
      this._teamStatsEl.classList.toggle('hidden', !isTeams);
    }
    if (this._vsBadgeEl) {
      this._vsBadgeEl.classList.toggle('hidden', isSanctuary || isTeams || isSurvival);
    }
    if (this._bossBarEl) {
      this._bossBarEl.classList.add('hidden');
    }

    if (this._enemyHudEl) {
      this._enemyHudEl.classList.toggle('multi-grid', !isTeams && !isSurvival && eList.length > 2);
    }

    if (this._playerNameEl) {
      this._playerNameEl.textContent = `${pCfg.icon} ${pCfg.title} (TÚ)`;
      this._playerNameEl.style.color = pCfg.color;
    }

    if (this._allySlot) {
      this._allySlot.root.classList.toggle('hidden', !hasAllyInMatch);
      if (hasAllyInMatch) {
        const aCfg = getElementConfig(allyElement || playerElement);
        this._allySlot.root.classList.remove('ally-down');
        this._allySlot.nameEl.textContent = `🛡️ ALIADO · ${aCfg.name.toUpperCase()}`;
        this._allySlot.nameEl.style.color = '#6be6ff';
        this._allySlot.fillEl.style.background = 'linear-gradient(90deg, #1b9cfc, #4ce6ff)';
        this._allySlot.fillEl.style.boxShadow = '0 0 10px rgba(56, 214, 255, 0.55)';
      }
    }

    for (let i = 0; i < this._enemySlots.length; i++) {
      const slot = this._enemySlots[i];
      const elem = isSurvival ? null : eList[i];
      if (!slot) continue;
      if (!elem) {
        slot.root.classList.add('hidden');
        continue;
      }
      slot.root.classList.remove('hidden');
      const eCfg = getElementConfig(elem);
      const customName = onlineRivalNames && onlineRivalNames[i];
      slot.nameEl.textContent = customName
        ? `${eCfg.icon} ${customName}`
        : isDojo
          ? `${eCfg.icon} PRÁCTICA · ${eCfg.name.toUpperCase()}`
          : isTeams
            ? `${eCfg.icon} RIVAL ROJO ${i + 1} · ${eCfg.name.toUpperCase()}`
            : isSanctuary || stage === 2
              ? `${eCfg.icon} RIVAL ${i + 1} · ${eCfg.name.toUpperCase()}`
              : `${eCfg.icon} ${eCfg.rivalTitle} (IA)`;
      slot.nameEl.style.color = isTeams ? '#ff7c89' : eCfg.color;
      slot.fillEl.style.background = isTeams
        ? 'linear-gradient(270deg, #ff3b4e, #ff7a66)'
        : `linear-gradient(270deg, ${eCfg.color}, ${eCfg.accent})`;
      slot.fillEl.style.boxShadow = isTeams
        ? '0 0 10px rgba(255, 59, 78, 0.55)'
        : `0 0 10px ${eCfg.color}66`;
    }

    this.abilityBar.style.setProperty('--ability-color', pCfg.color);
    this.abilityBar.style.setProperty('--ability-accent', pCfg.accent);

    this._idToSlot = {};
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const slotKey = SLOT_ORDER[i];
      const ab = pCfg.abilities[i];
      const slotObj = this.slots[slotKey];
      if (!slotObj || !ab) continue;

      slotObj.root.dataset.ability = ab.id;
      slotObj.keyEl.textContent = ab.key;
      slotObj.nameEl.textContent = ab.name;
      this.slots[ab.id] = slotObj;
      this._idToSlot[ab.id] = slotKey;
    }

    if (this.auraSlot) {
      this.auraSlot.root.classList.toggle('hidden', !isSurvival);
    }

    if (this._pauseSubtitle) {
      this._pauseSubtitle.textContent = isSurvival
        ? `${pCfg.title} — Supervivencia por Oleadas (${isSanctuary ? 'Santuario' : 'Arena'})`
        : isDojo
          ? `${pCfg.title} — Dojo de Entrenamiento (${isSanctuary ? 'Santuario' : 'Arena'})`
          : isTeams
            ? `${pCfg.title} — Batalla por Equipos 2v2 (${isSanctuary ? 'Santuario' : 'Arena'})`
            : isSanctuary
              ? `${pCfg.title} — Santuario de las Cuatro Naciones (${eList.length} rivales)`
              : stage === 2
                ? `${pCfg.title} — Batalla Campal (Etapa 2)`
                : `${pCfg.title} vs ${getElementConfig(eList[0]).rivalTitle}`;
    }
    if (this._pauseControls) {
      this._pauseControls.innerHTML = `
        <span><kbd>WASD</kbd>Moverse</span>
        <span><kbd>Espacio</kbd>Saltar</span>
        <span><kbd>Shift</kbd>Dash</span>
        ${pCfg.abilities.map((a) => `<span><kbd>${a.key}</kbd>${a.name}</span>`).join('')}
        ${isSurvival ? '<span><kbd>R</kbd>Aura Elemental</span>' : ''}
        <span><kbd>M</kbd>Audio</span>`;
    }
  }

  /** Actualiza el icono/estado del botón de silencio */
  setMuted(muted) {
    this.muteBtn.classList.toggle('muted', !!muted);
    this.muteBtn.innerHTML = muted
      ? `<span class="mute-icon">🔇</span><small>M</small>`
      : `<span class="mute-icon">🔊</span><small>M</small>`;
  }

  /** Activa o desactiva la viñeta roja de peligro de Ring-Out para el jugador */
  setRingOutDanger(active) {
    this.dangerVignette.classList.toggle('active', !!active);
  }

  /** Activa o desactiva la viñeta violeta hipnótica y el aviso de controles invertidos */
  setConfusedState(active) {
    const on = !!active;
    if (this.confuseVignette) this.confuseVignette.classList.toggle('active', on);
    if (this.confuseBanner) this.confuseBanner.classList.toggle('hidden', !on);
  }

  /**
   * Crea un número de daño flotante sobre el punto 3D golpeado.
   */
  spawnDamageNumber(worldPos, amount, isHeavy = false, targetId = 'enemy', kind = 'normal') {
    const isBurn = kind === 'burn';
    const isPoison = kind === 'poison';
    const isFall = kind === 'fall';
    const isCrit = kind === 'crit';
    const classes = [
      'damage-number',
      isHeavy ? 'heavy' : '',
      isCrit ? 'crit-dmg' : '',
      targetId === 'player' && !isBurn && !isPoison && !isFall ? 'self-dmg' : '',
      isBurn ? 'burn-dmg' : '',
      isPoison ? 'poison-dmg' : '',
      isFall ? 'fall-dmg' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const itemEl = el('div', classes);
    const rounded = Math.round(amount);
    itemEl.textContent = isFall ? `-${rounded}` : isCrit ? `-${rounded}!★` : isHeavy ? `-${rounded}!` : `-${rounded}`;
    this.damageLayer.appendChild(itemEl);

    this._floatingNumbers.push({
      el: itemEl,
      worldPos: worldPos.clone(),
      age: 0,
      duration: isHeavy ? 1.05 : (isBurn || isPoison) ? 0.72 : 0.85,
      driftX: (Math.random() - 0.5) * 34,
    });
  }

  /**
   * Proyecta y anima cada frame los números de daño flotantes activos.
   */
  updateDamageNumbers(dt, camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this._floatingNumbers.length - 1; i >= 0; i--) {
      const f = this._floatingNumbers[i];
      f.age += dt;
      const t = f.age / f.duration;
      if (t >= 1) {
        f.el.remove();
        this._floatingNumbers.splice(i, 1);
        continue;
      }

      _projVec.copy(f.worldPos);
      _projVec.y += 0.45 + t * 1.15;
      _projVec.project(camera);

      if (_projVec.z > 1) {
        f.el.style.opacity = '0';
        continue;
      }

      const x = (_projVec.x * 0.5 + 0.5) * w + f.driftX * t;
      const y = (-_projVec.y * 0.5 + 0.5) * h - t * 28;
      const alpha = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.3);
      const scale = t < 0.14 ? 0.65 + (t / 0.14) * 0.5 : 1.15 - t * 0.2;

      f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
      f.el.style.opacity = alpha.toFixed(2);
    }
  }

  clearDamageNumbers() {
    for (const f of this._floatingNumbers) f.el.remove();
    this._floatingNumbers.length = 0;
  }

  /** Proyecta barras de vida compactas sobre la cabeza de cada bot o monstruo vivo */
  updateWorldBars(enemies = [], camera, hide = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const activeIds = new Set();
    const isTeams = this._format === 'teams';
    const isSurvival = this._format === 'survival';
    let rivalIndex = 0;

    if (!hide) {
      for (let i = 0; i < enemies.length; i++) {
        const bot = enemies[i].fighter || enemies[i];
        const isAlly = (isTeams || isSurvival) && (bot.team || bot.id) === 'team_blue';
        if (!isAlly) rivalIndex++;
        if (!bot || !bot.isAlive) continue;

        // En Supervivencia proyecta barras sobre monstruos dañados, cercanos (< 24u) o jefes, y sobre el aliado
        if (bot.isMonster && camera) {
          const dCam = bot.position.distanceTo(camera.position);
          if (bot.hp >= bot.maxHp && dCam > 24 && bot.monsterType !== 'colossus') continue;
        }
        activeIds.add(bot.id);

        let bar = this._worldBars.get(bot.id);
        if (!bar) {
          const rootEl = el('div', 'bot-world-hp');
          rootEl.innerHTML = `
            <div class="bot-world-label"></div>
            <div class="bot-world-track"><div class="bot-world-fill"></div></div>`;
          this.worldBarsLayer.appendChild(rootEl);
          bar = {
            root: rootEl,
            label: rootEl.querySelector('.bot-world-label'),
            fill: rootEl.querySelector('.bot-world-fill'),
          };
          this._worldBars.set(bot.id, bar);
        }

        const eCfg = getElementConfig(bot.element || 'earth');
        bar.root.classList.toggle('ally-world-hp', isAlly);
        bar.root.classList.toggle('enemy-world-hp', (isTeams || bot.isMonster) && !isAlly);
        if (isAlly) {
          bar.label.textContent = `🛡️ ALIADO`;
          bar.fill.style.background = '#38d6ff';
        } else if (bot.isMonster) {
          const tag = bot.monsterType === 'colossus' ? '👑 COLOSO' : bot.monsterType === 'golem' ? '🪨 GÓLEM' : `${eCfg.icon} ESPÍRITU`;
          bar.label.textContent = tag;
          bar.fill.style.background = bot.monsterType === 'colossus' ? '#ff3b4e' : eCfg.color;
        } else if (this._format === 'dojo') {
          bar.label.textContent = `${eCfg.icon} PRÁCTICA`;
          bar.fill.style.background = eCfg.color;
        } else if (bot.isRemote && bot.displayName) {
          bar.label.textContent = `${eCfg.icon} ${bot.displayName}`;
          bar.fill.style.background = isTeams ? '#ff3b4e' : eCfg.color;
        } else if (isTeams) {
          bar.label.textContent = `${eCfg.icon} RIVAL ${rivalIndex}`;
          bar.fill.style.background = '#ff3b4e';
        } else {
          bar.label.textContent = `${eCfg.icon} RIVAL ${i + 1}`;
          bar.fill.style.background = eCfg.color;
        }
        const pct = Math.max(0, Math.min(100, (bot.hp / bot.maxHp) * 100));
        bar.fill.style.width = `${pct.toFixed(1)}%`;

        _projVec.copy(bot.position);
        _projVec.y += bot.monsterType === 'colossus' ? 3.5 : 2.42;
        _projVec.project(camera);

        if (_projVec.z > 1 || _projVec.z < -1) {
          bar.root.style.opacity = '0';
          continue;
        }
        const x = (_projVec.x * 0.5 + 0.5) * w;
        const y = (-_projVec.y * 0.5 + 0.5) * h;
        bar.root.style.opacity = '1';
        bar.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }

    for (const [id, bar] of this._worldBars.entries()) {
      if (!activeIds.has(id)) {
        bar.root.remove();
        this._worldBars.delete(id);
      }
    }
  }

  /** Actualiza el contador superior de Batalla Campal (Vivos / Tus bajas) */
  updateBattleRoyaleStats(aliveCount, totalCount, kills = 0) {
    if (this._brAliveEl) this._brAliveEl.textContent = `${aliveCount} / ${totalCount}`;
    if (this._brKillsEl) this._brKillsEl.textContent = `${kills}`;
  }

  /** Actualiza el marcador central de 2v2 */
  updateTeamStats(blueAlive, redAlive) {
    if (this._blueAliveEl) this._blueAliveEl.textContent = `${blueAlive}`;
    if (this._redAliveEl) this._redAliveEl.textContent = `${redAlive}`;
  }

  /** Actualiza barra superior central de Supervivencia */
  updateSurvivalStats(wave, remainingEnemies, score) {
    if (this._survWaveEl) this._survWaveEl.textContent = `${wave}`;
    if (this._survEnemiesEl) this._survEnemiesEl.textContent = `${remainingEnemies}`;
    if (this._survScoreEl) this._survScoreEl.textContent = `${score}`;
  }

  /** Muestra y actualiza la barra destacada de Jefe (Coloso Elemental) en Supervivencia */
  updateBossBar(boss = null) {
    if (!this._bossBarEl) return;
    if (!boss || !boss.isAlive) {
      this._bossBarEl.classList.add('hidden');
      return;
    }
    this._bossBarEl.classList.remove('hidden');
    const eCfg = getElementConfig(boss.element || 'fire');
    this._bossNameEl.textContent = `👑 COLOSO ${eCfg.name.toUpperCase()}`;
    this._bossHpTextEl.textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
    const pct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
    this._bossFillEl.style.width = `${pct.toFixed(1)}%`;
  }

  /** Actualiza la 5.ª ranura [R] de Aura Elemental en Modo Supervivencia */
  setSurvivalAura(auraState) {
    this._lastAuraState = auraState || null;
    if (this.touchControls) {
      this.touchControls.syncState({
        abilities: this._lastAbilities,
        dashReadiness: this._lastDashReadiness,
        auraState: this._lastAuraState,
        elementConfig: this._currentElementCfg,
      });
    }
    if (!this.auraSlot) return;
    const s = this.auraSlot;
    if (!auraState || !auraState.unlocked) {
      s.root.classList.add('locked');
      s.root.classList.remove('ready', 'aura-active');
      s.fill.style.height = '0%';
      s.nameEl.textContent = 'Aura [R]';
      s.cdText.textContent = 'Ol. 2';
      return;
    }

    s.root.classList.remove('locked');
    s.root.style.setProperty('--aura-color', auraState.color || '#ffd166');
    s.nameEl.textContent = auraState.name || 'Aura';

    if (auraState.active) {
      s.root.classList.add('aura-active');
      s.root.classList.remove('ready');
      s.fill.style.height = `${(auraState.activeRatio * 100).toFixed(1)}%`;
      s.cdText.textContent = `${auraState.activeRemaining.toFixed(1)}s`;
    } else if (auraState.ready) {
      s.root.classList.remove('aura-active');
      s.root.classList.add('ready');
      s.fill.style.height = '100%';
      s.cdText.textContent = '';
    } else {
      s.root.classList.remove('aura-active', 'ready');
      const total = Math.max(1, auraState.cooldownTotal || 14);
      const pct = Math.max(0, Math.min(1, 1 - auraState.cooldownRemaining / total)) * 100;
      s.fill.style.height = `${pct.toFixed(1)}%`;
      s.cdText.textContent = `${auraState.cooldownRemaining.toFixed(1)}s`;
    }
  }

  /** Muestra el selector modal de 3 o 4 cartas de mejora acumulable entre oleadas */
  showUpgradeModal(choices = [], clearedWave = 1) {
    if (!this.upgradeOverlay || !this._upgradeGridEl) return;
    this._isChoosingUpgrade = true;
    this._upgradeKickerEl.textContent = `¡OLEADA ${clearedWave} SUPERADA! · +25 HP`;

    const hasFour = choices.length === 4;
    const hasFive = choices.length >= 5;
    if (this._upgradePanelEl) {
      this._upgradePanelEl.classList.toggle('four-cards', hasFour);
      this._upgradePanelEl.classList.toggle('five-cards', hasFive);
    }
    this._upgradeGridEl.classList.toggle('four-cards', hasFour);
    this._upgradeGridEl.classList.toggle('five-cards', hasFive);
    if (this._upgradeSubEl) {
      const keyList = choices.map((_, i) => `<kbd>${i + 1}</kbd>`);
      const last = keyList.pop();
      this._upgradeSubEl.innerHTML = `Haz clic o presiona ${keyList.join(', ')} o ${last}`;
    }

    this._upgradeGridEl.innerHTML = choices
      .map((c, idx) => {
        const isAura = !!c.isAuraCard;
        const isRevive = !!c.isReviveCard;
        const accentStyle = isAura && c.accentColor ? `style="--aura-accent: ${c.accentColor}"` : '';
        return `
        <button type="button"
                class="upgrade-card ${isAura ? 'is-aura' : ''} ${isRevive ? 'is-revive' : ''}"
                data-upgrade-idx="${idx}"
                data-upgrade-id="${c.id}"
                ${accentStyle}>
          <span class="upgrade-hotkey">${idx + 1}</span>
          ${c.badge ? `<span class="upgrade-badge ${isAura ? 'is-aura-badge' : ''}">${c.badge}</span>` : ''}
          <span class="upgrade-icon">${c.icon}</span>
          <strong class="upgrade-card-title">${c.title}</strong>
          <span class="upgrade-card-desc">${c.desc}</span>
        </button>`;
      })
      .join('');

    for (const btn of this._upgradeGridEl.querySelectorAll('[data-upgrade-id]')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onSelectUpgrade) this.onSelectUpgrade(btn.dataset.upgradeId);
      });
    }

    this.upgradeOverlay.classList.remove('hidden');
    this.overlay.classList.add('hidden');
    this.crosshair.classList.remove('visible');
    this._refreshTouchOverlay();
    this._syncCrosshairVisibility();
  }

  hideUpgradeModal() {
    this._isChoosingUpgrade = false;
    if (this.upgradeOverlay) this.upgradeOverlay.classList.add('hidden');
    this._refreshTouchOverlay();
    this._syncCrosshairVisibility();
  }

  /** Muestra u oculta el aviso de cámara espectador sobre el aliado en 2v2 */
  setSpectatingAlly(active, allyFighter = null) {
    if (!this.spectatorBanner) return;
    this.spectatorBanner.classList.toggle('hidden', !active);
    if (active && allyFighter) {
      const cfg = getElementConfig(allyFighter.element || 'earth');
      this.spectatorBanner.innerHTML = `<span class="spectator-eye">👁️</span><span>ESPECTANDO A TU ALIADO · ${cfg.icon} MAESTRO ${cfg.name.toUpperCase()}</span>`;
    }
  }

  /** Muestra u oculta el Panel interactivo + Telemetría del Modo Dojo */
  setDojoPanelVisible(visible, { startCollapsed } = {}) {
    this._dojoActive = !!visible;
    if (!this._dojoActive) {
      this._dojoCollapsed = false;
      if (this.dojoPanel) this.dojoPanel.classList.add('hidden');
      if (this.dojoRestoreBtn) this.dojoRestoreBtn.classList.add('hidden');
      return;
    }
    const initialCollapsed = typeof startCollapsed === 'boolean' ? startCollapsed : !!this._isTouchMode;
    this.setDojoPanelCollapsed(initialCollapsed);
  }

  /** Colapsa o despliega el Panel del Dojo mostrando en su lugar el botón flotante compacto */
  setDojoPanelCollapsed(collapsed) {
    this._dojoCollapsed = !!collapsed;
    if (!this._dojoActive) {
      if (this.dojoPanel) this.dojoPanel.classList.add('hidden');
      if (this.dojoRestoreBtn) this.dojoRestoreBtn.classList.add('hidden');
      return;
    }
    if (this.dojoPanel) this.dojoPanel.classList.toggle('hidden', this._dojoCollapsed);
    if (this.dojoRestoreBtn) this.dojoRestoreBtn.classList.toggle('hidden', !this._dojoCollapsed);
  }

  /** Alterna el estado colapsado del Panel del Dojo (tecla H o botones ✕ / Panel Dojo) */
  toggleDojoPanelCollapsed() {
    if (!this._dojoActive) return;
    this.setDojoPanelCollapsed(!this._dojoCollapsed);
  }

  /** Actualiza etiquetas y estados de los controles del Panel Dojo */
  updateDojoControls({ behavior = 'passive', instantCooldown = false } = {}) {
    if (this._dojoBehaviorLabel) {
      this._dojoBehaviorLabel.textContent =
        behavior === 'defensive' ? 'Defensivo' : behavior === 'active' ? 'Combate Activo' : 'Pasivo';
    }
    if (this._dojoBehaviorBtn) {
      this._dojoBehaviorBtn.dataset.mode = behavior;
    }
    if (this._dojoInstantLabel) {
      this._dojoInstantLabel.textContent = instantCooldown ? 'ON' : 'OFF';
    }
    if (this._dojoInstantBtn) {
      this._dojoInstantBtn.classList.toggle('active', !!instantCooldown);
    }
  }

  /** Actualiza telemetría de último golpe, daño acumulado de combo y estado activo del rival */
  updateDojoTelemetry({ lastDamage = 0, comboDamage = 0, status = 'Normal' } = {}) {
    if (this._dojoLastDmgEl) this._dojoLastDmgEl.textContent = `${Math.round(lastDamage)}`;
    if (this._dojoComboDmgEl) {
      this._dojoComboDmgEl.textContent = `${Math.round(comboDamage)}`;
      this._dojoComboDmgEl.classList.toggle('has-combo', comboDamage > 0);
    }
    if (this._dojoStatusEl) {
      this._dojoStatusEl.textContent = status;
      this._dojoStatusEl.classList.toggle('is-frozen', status.includes('Congelado'));
      this._dojoStatusEl.classList.toggle('is-burned', status.includes('Quemado'));
      this._dojoStatusEl.classList.toggle('is-rooted', status.includes('Enredado'));
      this._dojoStatusEl.classList.toggle('is-poisoned', status.includes('Envenenado'));
      this._dojoStatusEl.classList.toggle('is-confused', status.includes('Confundido'));
      this._dojoStatusEl.classList.toggle('is-stunned', status.includes('Cegado'));
    }
  }

  /** Muestra un aviso breve en el kill-feed superior izquierdo */
  addKillFeedEntry(killerName, victimName, killerColor = '#f4cb6e', victimColor = '#d6c8ad') {
    const item = el('div', 'kill-feed-item');
    item.innerHTML = `<span class="kf-killer" style="color:${killerColor}">${killerName}</span><span class="kf-verb">eliminó a</span><span class="kf-victim" style="color:${victimColor}">${victimName}</span>`;
    this.killFeedLayer.prepend(item);

    while (this.killFeedLayer.children.length > 4) {
      this.killFeedLayer.lastElementChild.remove();
    }

    setTimeout(() => {
      item.classList.add('fading');
      setTimeout(() => item.remove(), 350);
    }, 3600);
  }

  clearKillFeed() {
    this.killFeedLayer.innerHTML = '';
  }

  /**
   * Proyecta flechas angulares orbitando alrededor de la retícula central (~85px)
   * para localizar aliados (celeste/verde + escudo) y rivales fuera del campo visual.
   */
  updateDirectionalIndicators(enemies = [], camera, hide = false) {
    const activeIds = new Set();
    const showInMode = (this._mode === 'sanctuary' || this._format === 'teams' || this._format === 'survival') && !hide && !this._isGameOver;
    this.directionalLayer.classList.toggle('hidden', !showInMode);

    if (showInMode && camera) {
      camera.updateMatrixWorld();
      _camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      _camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      _camForward.setFromMatrixColumn(camera.matrixWorld, 2).negate().normalize();

      const ringRadius = 85;
      const isTeamsOrSurvAlly = this._format === 'teams' || this._format === 'survival';

      for (const entry of enemies) {
        const bot = entry.fighter || entry;
        if (!bot || !bot.isAlive) continue;
        activeIds.add(bot.id);

        let ptr = this._dirPointers.get(bot.id);
        if (!ptr) {
          const rootEl = el('div', 'dir-indicator');
          const arrowEl = el('div', 'dir-arrow');
          const shieldEl = el('span', 'dir-shield hidden');
          shieldEl.textContent = '🛡️';
          rootEl.append(arrowEl, shieldEl);
          this.directionalLayer.appendChild(rootEl);
          ptr = { root: rootEl, arrow: arrowEl, shield: shieldEl };
          this._dirPointers.set(bot.id, ptr);
        }

        _camToBot.set(
          bot.position.x - camera.position.x,
          bot.position.y + 1.1 - camera.position.y,
          bot.position.z - camera.position.z
        );
        const dist = _camToBot.length() || 0.001;
        const fwdDot = _camToBot.dot(_camForward);
        const rightDot = _camToBot.dot(_camRight);
        const upDot = _camToBot.dot(_camUp);

        _projVec.set(bot.position.x, bot.position.y + 1.1, bot.position.z).project(camera);
        const inFrontView = fwdDot > 0.5 && Math.abs(_projVec.x) <= 0.78 && Math.abs(_projVec.y) <= 0.78;

        if (inFrontView) {
          ptr.root.style.opacity = '0';
          continue;
        }

        const ang = Math.atan2(-upDot, rightDot);
        const ox = Math.cos(ang) * ringRadius;
        const oy = Math.sin(ang) * ringRadius;
        const rotDeg = (ang * 180) / Math.PI + 90;

        const opacity = dist < 18
          ? Math.max(0.78, 1.0 - (dist / 18) * 0.18)
          : Math.max(0.32, 0.78 - (dist - 18) / 55);

        const isAlly = isTeamsOrSurvAlly && (bot.team || bot.id) === 'team_blue';
        ptr.root.classList.toggle('is-ally', isAlly);
        ptr.shield.classList.toggle('hidden', !isAlly);
        if (isAlly) {
          ptr.arrow.style.borderBottomColor = '#38e8b0';
          ptr.shield.style.transform = `rotate(${(-rotDeg).toFixed(1)}deg)`;
        } else if (this._format === 'teams' || bot.isMonster) {
          ptr.arrow.style.borderBottomColor = bot.monsterType === 'colossus' ? '#ffbe3b' : '#ff4757';
        } else {
          const eCfg = getElementConfig(bot.element || 'earth');
          ptr.arrow.style.borderBottomColor = eCfg.color;
        }
        ptr.root.style.opacity = opacity.toFixed(2);
        ptr.root.style.transform = `translate(calc(-50% + ${ox.toFixed(1)}px), calc(-50% + ${oy.toFixed(1)}px)) rotate(${rotDeg.toFixed(1)}deg)`;
      }
    }

    for (const [id, ptr] of this._dirPointers.entries()) {
      if (!activeIds.has(id)) {
        ptr.root.remove();
        this._dirPointers.delete(id);
      }
    }
  }

  /** Actualiza la barra del jugador, la del aliado (en 2v2) y las barras de rivales */
  updateMultiHealthBars(playerHp, playerMax, enemies = [], instant = false, dt = 0.016) {
    const pPct = Math.max(0, Math.min(100, (playerHp / playerMax) * 100));
    if (instant) {
      this._playerTrailPct = pPct;
    } else {
      const rate = 28 * dt;
      this._playerTrailPct = this._playerTrailPct > pPct ? Math.max(pPct, this._playerTrailPct - rate) : pPct;
    }
    this._playerFill.style.width = `${pPct.toFixed(1)}%`;
    this._playerTrail.style.width = `${this._playerTrailPct.toFixed(1)}%`;
    this._playerHpText.textContent = `${Math.ceil(playerHp)} / ${playerMax}`;

    const isTeams = this._format === 'teams';
    const isSurvival = this._format === 'survival';
    let ally = null;
    const hostileList = [];
    for (const entry of enemies) {
      const bot = entry.fighter || entry;
      if (!bot) continue;
      if ((isTeams || isSurvival) && (bot.team || bot.id) === 'team_blue') {
        ally = bot;
      } else if (!isSurvival) {
        hostileList.push(bot);
      }
    }

    if (this._allySlot && (isTeams || isSurvival) && ally) {
      this._allySlot.root.classList.remove('hidden');
      const aPct = Math.max(0, Math.min(100, (ally.hp / ally.maxHp) * 100));
      if (instant) {
        this._allySlot.trailPct = aPct;
      } else {
        const rate = 28 * dt;
        this._allySlot.trailPct = this._allySlot.trailPct > aPct ? Math.max(aPct, this._allySlot.trailPct - rate) : aPct;
      }
      this._allySlot.fillEl.style.width = `${aPct.toFixed(1)}%`;
      this._allySlot.trailEl.style.width = `${this._allySlot.trailPct.toFixed(1)}%`;
      this._allySlot.root.classList.toggle('ally-down', !ally.isAlive);
      this._allySlot.hpTextEl.textContent = ally.isAlive ? `${Math.ceil(ally.hp)} / ${ally.maxHp}` : 'ELIMINADO';
    } else if (this._allySlot) {
      this._allySlot.root.classList.add('hidden');
    }

    for (let i = 0; i < this._enemySlots.length; i++) {
      const slot = this._enemySlots[i];
      const bot = hostileList[i] || null;
      if (!bot) {
        slot.root.classList.add('hidden');
        continue;
      }
      slot.root.classList.remove('hidden');
      const ePct = Math.max(0, Math.min(100, (bot.hp / bot.maxHp) * 100));
      if (instant) {
        slot.trailPct = ePct;
      } else {
        const rate = 28 * dt;
        slot.trailPct = slot.trailPct > ePct ? Math.max(ePct, slot.trailPct - rate) : ePct;
      }
      slot.fillEl.style.width = `${ePct.toFixed(1)}%`;
      slot.trailEl.style.width = `${slot.trailPct.toFixed(1)}%`;
      slot.hpTextEl.textContent = `${Math.ceil(bot.hp)} / ${bot.maxHp}`;
    }
  }

  /** Muestra la pantalla de fin de etapa / partida */
  showGameOver({ victory, title, subtitle, mode = 'defeat', isOnline = false, isHost = false, goldReward = 0, totalGold = null }) {
    this._isGameOver = true;
    this.hideUpgradeModal();
    this._goTitle.textContent = title;
    this._goSubtitle.textContent = subtitle || '';
    if (this._goGoldBadge) {
      if (goldReward > 0) {
        const balance = totalGold ?? this.economy.getGold();
        this._goGoldBadge.innerHTML = `<span class="go-gold-earned">+${goldReward} 🪙</span><span class="go-gold-total">Saldo: ${balance} 🪙</span>`;
        this._goGoldBadge.classList.remove('hidden');
      } else {
        this._goGoldBadge.classList.add('hidden');
      }
    }
    this.gameOverOverlay.classList.toggle('victory', !!victory);
    this.gameOverOverlay.classList.toggle('defeat', !victory);

    this._nextStageBtn.classList.toggle('hidden', isOnline || mode !== 'stage1_clear');
    this._restartRunBtn.classList.toggle('hidden', isOnline || mode !== 'champion');
    this._playAgainBtn.classList.toggle('hidden', isOnline);
    this._changeElementStep2Btn.classList.toggle('hidden', isOnline);
    if (this._returnLobbyBtn) {
      this._returnLobbyBtn.classList.toggle('hidden', !isOnline);
      this._returnLobbyBtn.disabled = isOnline && !isHost;
      this._returnLobbyBtn.textContent = isHost ? 'Volver a la Sala (Lobby)' : 'Esperando al Host (Lobby)...';
    }
    this._playAgainBtn.innerHTML = 'Jugar de nuevo <small>(R)</small>';
    this._changeElementStep2Btn.textContent = 'Cambiar Elemento';
    this._changeElementBtn.innerHTML = isOnline ? 'Salir de la Sala <small>(C)</small>' : 'Menú Principal <small>(C)</small>';

    this.setSpectatingAlly(false);
    this._manualPauseOpen = false;
    this.gameOverOverlay.classList.remove('hidden');
    this.overlay.classList.add('hidden');
    this.selectOverlay.classList.add('hidden');
    this.directionalLayer.classList.add('hidden');
    this.crosshair.classList.remove('visible');
    this._refreshTouchOverlay();
    this._syncCrosshairVisibility();
  }

  /** Actualiza visibilidad de la retícula central tanto en escritorio como en móvil */
  _syncCrosshairVisibility() {
    if (!this.crosshair) return;
    const canShow =
      (this._isLocked || this._isTouchMode) &&
      !this._isGameOver &&
      !this._isSelecting &&
      !this._isChoosingUpgrade &&
      !this._manualPauseOpen;
    this.crosshair.classList.toggle('visible', canShow);
  }

  /** Muestra/oculta elementos según el estado del PointerLock */
  setLocked(locked) {
    this._isLocked = locked;
    if (locked) {
      this._isSelecting = false;
      this._manualPauseOpen = false;
      this.selectOverlay.classList.add('hidden');
    }
    const showPause =
      this._manualPauseOpen ||
      (!locked && !this._isGameOver && !this._isSelecting && !this._isChoosingUpgrade && !this._isOnline);
    this.overlay.classList.toggle('hidden', !showPause);
    this._refreshTouchOverlay();
    this._syncCrosshairVisibility();
  }

  /**
   * Actualiza ambas barras de salud y su rastro de daño reciente (damage trail).
   */
  updateHealthBars(playerHp, playerMax, enemyHp, enemyMax, instant = false, dt = 0.016) {
    const pPct = Math.max(0, Math.min(100, (playerHp / playerMax) * 100));
    const ePct = Math.max(0, Math.min(100, (enemyHp / enemyMax) * 100));

    if (instant) {
      this._playerTrailPct = pPct;
      this._enemyTrailPct = ePct;
    } else {
      const rate = 28 * dt;
      if (this._playerTrailPct > pPct) {
        this._playerTrailPct = Math.max(pPct, this._playerTrailPct - rate);
      } else {
        this._playerTrailPct = pPct;
      }
      if (this._enemyTrailPct > ePct) {
        this._enemyTrailPct = Math.max(ePct, this._enemyTrailPct - rate);
      } else {
        this._enemyTrailPct = ePct;
      }
    }

    this._playerFill.style.width = `${pPct.toFixed(1)}%`;
    this._playerTrail.style.width = `${this._playerTrailPct.toFixed(1)}%`;
    this._playerHpText.textContent = `${Math.ceil(playerHp)} / ${playerMax}`;

    this._enemyFill.style.width = `${ePct.toFixed(1)}%`;
    this._enemyTrail.style.width = `${this._enemyTrailPct.toFixed(1)}%`;
    this._enemyHpText.textContent = `${Math.ceil(enemyHp)} / ${enemyMax}`;
  }

  /** Muestra u oculta el cartel central de cuenta regresiva */
  setCountdown(text, visible) {
    if (visible && text) {
      if (this.countdownEl.textContent !== text) {
        this.countdownEl.textContent = text;
        this.countdownEl.classList.remove('pop');
        void this.countdownEl.offsetWidth;
        this.countdownEl.classList.add('pop');
      }
      this.countdownEl.classList.remove('hidden');
    } else {
      this.countdownEl.classList.add('hidden');
    }
  }

  hideGameOver() {
    this._isGameOver = false;
    this.gameOverOverlay.classList.add('hidden');
    this.setLocked(this._isLocked);
  }

  /** @param {number} readiness progreso de recarga [0..1] */
  setDashReadiness(readiness) {
    if (Math.abs(readiness - this._lastReadiness) < 0.001) return;
    this._lastReadiness = readiness;
    this._lastDashReadiness = readiness;
    const offset = this._circumference * (1 - readiness);
    this._ring.setAttribute('stroke-dashoffset', offset.toFixed(2));
    this.dash.classList.toggle('ready', readiness >= 1);
    if (this.touchControls) {
      this.touchControls.syncState({
        abilities: this._lastAbilities,
        dashReadiness: this._lastDashReadiness,
        auraState: this._lastAuraState,
        elementConfig: this._currentElementCfg,
      });
    }
  }

  /**
   * Actualiza el estado visual de las 4 ranuras de habilidades.
   */
  setAbilities(states) {
    this._lastAbilities = states || [];
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const slot = this.slots[st.slot] || this.slots[st.id] || this.slots[SLOT_ORDER[i]];
      if (!slot) continue;
      if (st.name && slot.nameEl.textContent !== st.name) {
        slot.nameEl.textContent = st.name;
      }
      const active = !!st.active;
      const pct = active
        ? Math.max(0, Math.min(1, st.activeRatio ?? 0)) * 100
        : Math.max(0, Math.min(1, st.readiness)) * 100;
      slot.fill.style.height = `${pct.toFixed(1)}%`;
      slot.root.classList.toggle('mist-active', active);
      slot.root.classList.toggle('ready', !active && st.ready);
      slot.cdText.textContent = active
        ? `${Math.max(0, st.remaining).toFixed(1)}s`
        : st.ready || st.remaining <= 0.05
          ? ''
          : `${st.remaining.toFixed(1)}s`;
      if (slot.chargesEl) {
        const hasCharges = typeof st.maxCharges === 'number' && st.maxCharges > 1;
        slot.chargesEl.classList.toggle('hidden', !hasCharges);
        if (hasCharges) {
          slot.chargesEl.textContent = `${st.charges}`;
        }
      }
    }
    if (this.touchControls) {
      this.touchControls.syncState({
        abilities: this._lastAbilities,
        dashReadiness: this._lastDashReadiness,
        auraState: this._lastAuraState,
        elementConfig: this._currentElementCfg,
      });
    }
  }

  /** Pulso leve en la retícula central y la ranura usada */
  pulseCrosshair(abilityId) {
    this.crosshair.classList.remove('pulse');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add('pulse');

    const slot = this.slots[abilityId] || (this._idToSlot[abilityId] && this.slots[this._idToSlot[abilityId]]);
    if (slot) {
      const elSlot = slot.root;
      elSlot.classList.remove('triggered');
      void elSlot.offsetWidth;
      elSlot.classList.add('triggered');
    }
  }

  /** Destello breve a pantalla completa */
  flash() {
    this.flashEl.classList.remove('active');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('active');
  }

  /** Destello blanco cegador de Destello Solar (2.0s por defecto) */
  triggerSolarBlind(duration = 2.0) {
    if (!this.solarBlindEl) return;
    this.solarBlindEl.style.setProperty('--solar-blind-dur', `${duration}s`);
    this.solarBlindEl.classList.remove('active');
    void this.solarBlindEl.offsetWidth;
    this.solarBlindEl.classList.add('active');
  }

  clearSolarBlind() {
    if (this.solarBlindEl) {
      this.solarBlindEl.classList.remove('active');
    }
  }
}

function el(tag, className) {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
