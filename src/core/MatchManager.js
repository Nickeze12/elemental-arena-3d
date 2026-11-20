import * as THREE from 'three';
import { ELEMENT_KEYS, getElementConfig } from '../combat/ElementFactory.js';
import { FIGHTER_CONFIG } from '../entities/BaseFighter.js';
import { EnemyFighter } from '../entities/EnemyFighter.js';
import { RemoteFighter } from '../entities/RemoteFighter.js';
import { MonsterEntity } from '../entities/MonsterEntity.js';
import { EnemyAI } from '../ai/EnemyAI.js';
import { WaveManager } from './WaveManager.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { economyManager } from './EconomyManager.js';

/**
 * MatchManager
 * ------------------------------------------------------------
 * Controla la progresión de etapas y estados del combate:
 *  - Etapa 1 (`stage = 1`): Duelo Elemental 1 vs 1 (`player` vs `bot_1`).
 *  - Etapa 2 (`stage = 2`): Batalla Campal Todos contra Todos (`player` vs `bot_1` y `bot_2`).
 *  - Estados: `SELECT` | `COUNTDOWN` | `FIGHTING` | `GAME_OVER`.
 */

const PLAYER_SPAWN_S1 = new THREE.Vector3(0, 0, 15);
const ENEMY_SPAWN_S1 = new THREE.Vector3(0, 0, -15);

const PLAYER_SPAWN_S2 = new THREE.Vector3(0, 0, 17);
const BOT1_SPAWN_S2 = new THREE.Vector3(-14.5, 0, -11.5);
const BOT2_SPAWN_S2 = new THREE.Vector3(14.5, 0, -11.5);

export class MatchManager {
  /**
   * @param {object} o
   * @param {import('../entities/Player.js').Player} o.player
   * @param {import('../entities/EnemyFighter.js').EnemyFighter} o.enemy
   * @param {import('../ai/EnemyAI.js').EnemyAI} o.enemyAI
   * @param {import('../combat/CombatManager.js').CombatManager} o.combat
   * @param {import('../world/Arena.js').Arena} o.arena
   * @param {import('./ThirdPersonCamera.js').ThirdPersonCamera} o.camera
   * @param {import('./InputManager.js').InputManager} o.input
   * @param {import('../ui/HUD.js').HUD} o.hud
   * @param {import('../audio/SoundManager.js').SoundManager} [o.sound]
   * @param {(fighter: any, amount: number, isHeavy: boolean, kind?: string) => void} [o.onFighterDamaged]
   */
  constructor({ player, enemy, enemyAI, combat, arena, elementalMap = null, camera, input, hud, sound = null, onFighterDamaged = null }) {
    this.player = player;
    this.enemy = enemy;
    this.enemyAI = enemyAI;
    this.combat = combat;
    this.classicArena = arena;
    this.sanctuaryMap = elementalMap;
    this.arena = arena;
    this.camera = camera;
    this.input = input;
    this.hud = hud;
    this.sound = sound;
    this.onFighterDamaged = onFighterDamaged;

    this.mode = 'classic'; // 'classic' | 'sanctuary'
    this.format = 'ffa'; // 'ffa' | 'teams' | 'dojo' | 'survival'
    this.difficulty = 'master'; // 'apprentice' | 'master' | 'grandmaster'
    this.survivalCompanion = 'solo'; // 'solo' | 'ally'
    this.stage = 1; // 1 = Duelo, 2 = Batalla Campal (Arena Clásica)
    this.botCount = 1; // 1..2 (classic) | 1..6 (sanctuary) | 3 (teams) | 1 (dojo)
    this.playerKills = 0;
    this.playerElement = 'earth';
    this.enemyElement = 'earth';
    this.bot2Element = 'fire';

    this.waveManager = new WaveManager({
      scene: combat.scene,
      combat,
      player,
      sound,
    });
    if (this.hud.setSurvivalRecord) {
      this.hud.setSurvivalRecord(this.waveManager.getRecord());
    }

    // Estado y telemetría del Modo Dojo
    this.dojoBehavior = 'passive'; // 'passive' | 'defensive' | 'active'
    this.dojoInstantCd = false;
    this.dojoStats = { lastDamage: 0, comboDamage: 0, comboTimer: 0 };

    this._bot1 = { fighter: enemy, ai: enemyAI };
    this._extraBots = [];
    /** Lista de bots o jugadores remotos activos en el combate actual */
    this.enemies = [this._bot1];

    // Capa de red P2P (por defecto 'offline')
    this.network = new NetworkManager();
    this._remoteFighters = new Map();
    this._lastSentActionRef = null;
    this._onlineActionNonce = 0;

    /** 'SELECT' | 'COUNTDOWN' | 'FIGHTING' | 'GAME_OVER' */
    this.state = 'SELECT';
    this.countdownTimer = 2.0;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;

    this.winner = null; // 'player' | 'enemy'
    this.reason = null; // 'KO' | 'RING_OUT'

    // Conecta callbacks de derrota
    this.player.onDefeated = (fighter, reason) => this._onFighterDefeated(fighter, reason);
    this.enemy.onDefeated = (fighter, reason) => this._onFighterDefeated(fighter, reason);

    // Conecta cambios de configuración en Paso 1 para actualizar vista previa de fondo
    this.hud.onConfigChange = ({ mode, format, difficulty, survivalCompanion, botCount }) => {
      if (this.state !== 'SELECT') return;
      this.mode = mode || 'classic';
      this.format = format || 'ffa';
      this.difficulty = difficulty || 'master';
      if (survivalCompanion) this.survivalCompanion = survivalCompanion;
      this.botCount = Math.max(1, Math.min(6, Number(botCount) || 1));
      this._setupPreviewScene();
    };

    // Conecta selector de elementos, modo, formato, dificultad y cantidad de bots
    this.hud.onStartDuel = ({ playerElement, rivalElement, mode = 'classic', format = 'ffa', difficulty = 'master', survivalCompanion = 'solo', botCount = 1 }) => {
      this.mode = mode;
      this.format = format;
      this.difficulty = difficulty || 'master';
      this.survivalCompanion = survivalCompanion || 'solo';
      this.botCount =
        format === 'teams'
          ? 3
          : format === 'dojo'
            ? 1
            : format === 'survival'
              ? (this.survivalCompanion === 'ally' ? 1 : 0)
              : Math.max(1, Math.min(6, Number(botCount) || 1));
      this.startMatchWithElements(playerElement, rivalElement);
    };

    const replayHandler = () => {
      if (this.format === 'survival') {
        this.startSurvivalMatch();
        this.input.requestLock();
        return;
      }
      if (this.format === 'dojo') {
        this.startDojoMatch();
        this.input.requestLock();
        return;
      }
      if (this.format === 'teams') {
        this.startTeamsMatch();
        this.input.requestLock();
        return;
      }
      if (this.mode === 'sanctuary') {
        this.startSanctuaryMatch();
        this.input.requestLock();
        return;
      }
      if (this.stage === 1 && this.hud.selectedRivalChoice === 'random') {
        const randomRival = ELEMENT_KEYS[Math.floor(Math.random() * ELEMENT_KEYS.length)];
        this.applyElements(this.playerElement, randomRival);
      }
      this.startStage(this.stage);
      this.input.requestLock();
    };

    this.hud.onSelectUpgrade = (upgradeId) => this.selectSurvivalUpgrade(upgradeId);

    this.hud.onNextStage = () => {
      this.startStage(2);
      this.input.requestLock();
    };
    this.hud.onReplayStage = replayHandler;
    this.hud.onPlayAgain = replayHandler;
    this.hud.onRestartRun = () => {
      this.startStage(1);
      this.input.requestLock();
    };
    this.hud.onChangeElement = (step = 1) => {
      this.openElementSelector(step);
    };

    // Controles interactivos del Modo Dojo
    this.hud.onDojoToggleBehavior = () => this.cycleDojoBehavior();
    this.hud.onDojoToggleInstantCd = () => this.toggleDojoInstantCooldown();
    this.hud.onDojoResetPositions = () => this.resetDojoPositions();
    this.hud.onDojoBackToMenu = () => this.openElementSelector(1);

    this._wireOnlineEvents();
    this.openElementSelector(1);
  }

  get isOnline() {
    return !!(this.network && this.network.role !== 'offline');
  }

  _wireOnlineEvents() {
    this.hud.onOpenOnline = () => {
      this.network.disconnect();
      this.hud.setOnlineMode(false);
      this.hud.setOnlineLobbyVisible(false);
      this.hud.setOnlineStatus('');
    };

    this.hud.onCloseOnline = () => {
      const wasInMatch = this.state !== 'SELECT';
      this.network.disconnect();
      this._clearRemoteFighters();
      this.hud.setOnlineMode(false);
      this.hud.setOnlineStatus('');
      if (wasInMatch) {
        this.openElementSelector(1);
      }
    };

    this.hud.onOnlineCreateRoom = ({ name, element }) => {
      this.network.createRoom({
        name,
        element,
        mode: this.mode || 'classic',
        format: this.format === 'teams' || this.format === 'survival' ? this.format : 'ffa',
      });
    };

    this.hud.onOnlineJoinRoom = ({ code, name, element }) => {
      this.network.joinRoom(code, { name, element });
    };

    this.hud.onOnlineUpdateProfile = (patch) => {
      this.network.updateLocalProfile(patch);
    };

    this.hud.onOnlineUpdateSettings = (settings) => {
      this.network.updateLobbySettings(settings);
    };

    this._remoteMonsters = new Map();
    this._remoteBots = new Map();
    this._guestAuras = new Map();
    this._coopPicks = new Map();
    this._coopUpgradeTimer = 0;
    this._pendingAbyssFall = false;
    this._guestAuraState = null;
    this._onlineRoster = [];
    this.economy = economyManager;
    this._matchGoldAwarded = false;
    this._survivalRunGold = 0;

    this.hud.onOnlineStartMatch = () => {
      this.startOnlineHostMatch();
    };

    this.hud.onReturnToLobby = () => {
      this.requestReturnToOnlineLobby();
    };

    this.network.onStatusChange = (status, msg) => {
      if (this.hud.setOnlineStatus) {
        this.hud.setOnlineStatus(msg, status === 'error');
      }
    };

    this.network.onLobbySync = (data) => {
      if (this.hud.updateOnlineLobby) {
        this.hud.updateOnlineLobby(data, this.network.role, this.network.localId);
      }
    };

    this.network.onStartMatch = (payload) => {
      this._startOnlineMatch(payload);
    };

    this.network.onRemoteInputState = (msg) => {
      const rf = this._remoteFighters.get(msg.id);
      if (!rf) return;
      rf.applyNetworkState(msg, this.network.role !== 'host');
      if (msg.abyssFall && this.network.role === 'host' && rf.isAlive) {
        rf.hp = 0;
        rf.combatEnabled = false;
        rf.mesh.root.visible = false;
        this.network.broadcastCombatEvent({
          status: 'fall',
          targetId: rf.id,
          attackerId: null,
          hp: 0,
          maxHp: rf.maxHp,
          isAlive: false,
          damage: 0,
        });
        rf._defeat('RING_OUT');
      }
    };

    this.network.onWorldSnapshot = (msg) => {
      if (!msg || !Array.isArray(msg.fighters)) return;
      const seenBots = new Set();
      for (const snap of msg.fighters) {
        if (snap.id === this.network.localId) {
          if (typeof snap.hp === 'number') this.player.hp = snap.hp;
          if (typeof snap.maxHp === 'number') this.player.maxHp = snap.maxHp;
          if (typeof snap.isAlive === 'boolean') {
            if (!snap.isAlive && this.player.isAlive) {
              this.player.isAlive = false;
              this.player.hp = 0;
              this.player.combatEnabled = false;
              this.player.mesh.root.visible = false;
            } else if (snap.isAlive && !this.player.isAlive) {
              this.player.isAlive = true;
              this.player.combatEnabled = this.state === 'FIGHTING';
              this.player.mesh.root.visible = true;
            }
          }
          if (typeof snap.isMistForm === 'boolean' && snap.isMistForm !== this.player.isMistFormActive) {
            this.player.isMistFormActive = snap.isMistForm;
            if (!snap.isMistForm) this.player.mistFormTimer = 0;
            if (this.player.mesh && this.player.mesh.setMistForm) {
              this.player.mesh.setMistForm(snap.isMistForm);
            }
          }
          if (typeof snap.isStunned === 'boolean') {
            this.player.stunTimer = snap.isStunned ? Math.max(this.player.stunTimer, 0.25) : 0;
            if (this.player.mesh && this.player.mesh.setStunned) {
              this.player.mesh.setStunned(snap.isStunned);
            }
          }
          if (typeof snap.earthOrbitCount === 'number' && this.player.mesh && this.player.mesh.setEarthOrbitRocks) {
            if (snap.earthOrbitCount === 0) this.player.earthRockTimers.length = 0;
            this.player.mesh.setEarthOrbitRocks(snap.earthOrbitCount);
          }
          if (typeof snap.isEarthTrapped === 'boolean') {
            this.player.earthTrapTimer = snap.isEarthTrapped ? Math.max(this.player.earthTrapTimer, 0.25) : 0;
            if (this.player.mesh && this.player.mesh.setEarthTrapped) {
              this.player.mesh.setEarthTrapped(snap.isEarthTrapped);
            }
          }
          if (typeof snap.isShogunArmor === 'boolean') {
            this.player.shogunArmorTimer = snap.isShogunArmor ? Math.max(this.player.shogunArmorTimer, 0.25) : 0;
            if (this.player.mesh && this.player.mesh.setShogunArmor) {
              this.player.mesh.setShogunArmor(snap.isShogunArmor);
            }
          }
          if (typeof snap.isAttackSlowed === 'boolean') {
            this.player.attackSlowTimer = snap.isAttackSlowed ? Math.max(this.player.attackSlowTimer, 0.25) : 0;
            if (this.player.mesh && this.player.mesh.setAttackSlowed) {
              this.player.mesh.setAttackSlowed(snap.isAttackSlowed);
            }
          }
          if (typeof snap.auraActive === 'boolean' && this._guestAuraState) {
            this._guestAuraState.active = snap.auraActive;
            this._guestAuraState.activeRemaining = snap.auraActiveRemaining ?? 0;
            this._guestAuraState.cooldownRemaining = snap.auraCooldownRemaining ?? 0;
            if (this.player.mesh && this.player.mesh.setElementalAura) {
              this.player.mesh.setElementalAura(this.player.element, snap.auraActive, 1.0);
            }
            if (this.hud && this.hud.setSurvivalAura) {
              this.hud.setSurvivalAura(this._getGuestAuraHudState());
            }
          }
          continue;
        }
        if (snap.isBot) {
          seenBots.add(snap.id);
          let botRf = this._remoteBots.get(snap.id);
          if (!botRf) {
            botRf = new RemoteFighter({
              id: snap.id,
              name: snap.name || 'Bot',
              element: snap.element || 'earth',
              team: snap.team || snap.id,
              scene: this.combat.scene,
              arena: this.arena,
            });
            const isAlly = this.player.team && snap.team === this.player.team;
            botRf.initCombat(this.combat, this.format === 'teams' ? (isAlly ? 'ally' : 'enemy') : null);
            this._remoteBots.set(snap.id, botRf);
          }
          botRf.applyNetworkState(snap);
          continue;
        }
        const rf = this._remoteFighters.get(snap.id);
        if (rf) {
          rf.applyNetworkState(snap);
          if (rf.mesh && rf.mesh.setElementalAura && typeof snap.auraActive === 'boolean') {
            rf.mesh.setElementalAura(rf.element, snap.auraActive, 1.0);
          }
        }
      }
      for (const [botId, botRf] of this._remoteBots.entries()) {
        if (!seenBots.has(botId)) {
          this.combat.removeFighter(botRf);
          botRf.dispose();
          this._remoteBots.delete(botId);
        }
      }

      if (this.format === 'survival' && Array.isArray(msg.monsters)) {
        const seenMonsters = new Set();
        for (const mSnap of msg.monsters) {
          seenMonsters.add(mSnap.id);
          let m = this._remoteMonsters.get(mSnap.id);
          if (!m) {
            m = new MonsterEntity({
              id: mSnap.id,
              monsterType: mSnap.type || 'spirit',
              element: mSnap.element || 'earth',
              scene: this.combat.scene,
              arena: this.arena,
              combat: this.combat,
            });
            m.isRemoteVisual = true;
            if (this.onFighterDamaged) m.onDamaged = this.onFighterDamaged;
            if (this.combat) this.combat.registerFighter(m, m.elementController);
            this._remoteMonsters.set(mSnap.id, m);
          }
          m.applyNetworkState(mSnap);
        }
        for (const [mId, m] of this._remoteMonsters.entries()) {
          if (!seenMonsters.has(mId)) {
            if (this.combat) this.combat.removeFighter(m);
            m.dispose();
            this._remoteMonsters.delete(mId);
          }
        }
        const activeBoss = Array.from(this._remoteMonsters.values()).find((m) => m.monsterType === 'colossus' && m.isAlive) || null;
        this.hud.updateBossBar(activeBoss);
      }

      if (this.format === 'survival' && msg.waveInfo) {
        this.hud.updateSurvivalStats(msg.waveInfo.wave, msg.waveInfo.remaining, msg.waveInfo.score);
      }

      this._syncOnlineHudBars();
    };

    this.network.onAbilityCast = (msg) => {
      if (!msg || !msg.senderId) return;
      if (this.network.role === 'host') {
        const rf = this._remoteFighters.get(msg.senderId);
        if (!rf) return;
        if (msg.slot === 'aura') {
          if (this.format === 'survival' && this._activateGuestAura(rf)) {
            this.network.broadcastAbilityCast({
              senderId: rf.id,
              slot: 'aura',
              origin: { x: rf.position.x, y: rf.position.y, z: rf.position.z },
              aimPoint: msg.aimPoint || { x: rf.position.x, y: rf.position.y, z: rf.position.z },
              yaw: typeof msg.yaw === 'number' ? msg.yaw : rf.yaw,
            }, null);
          }
          return;
        }
        const fired = rf.castNetworkSkill(msg, true);
        if (fired) {
          this.network.broadcastAbilityCast({ ...msg, senderId: rf.id }, msg.senderId);
        }
      } else if (this.network.role === 'guest') {
        if (msg.slot === 'aura') {
          this._playOnlineAuraVisual(msg.senderId);
          return;
        }
        if (msg.senderId === this.network.localId) return;
        const actor = this._remoteFighters.get(msg.senderId) || this._remoteBots.get(msg.senderId);
        if (actor && actor.castNetworkSkill) {
          actor.castNetworkSkill(msg, false);
        }
      }
    };

    this.network.onCombatEvent = (ev) => {
      if (!ev || this.network.role !== 'guest') return;
      if (ev.status === 'plant_hit') {
        const localPlantPrefix = `plant_${this.network.localId}_`;
        const altId = ev.targetId && ev.targetId.startsWith(localPlantPrefix)
          ? `plant_player_${ev.targetId.slice(localPlantPrefix.length)}`
          : null;
        const plant = this.combat && this.combat.turrets
          ? this.combat.turrets.find((t) => t && (t.id === ev.targetId || (altId && t.id === altId)))
          : null;
        if (plant && plant.alive) {
          plant.takeHit(1, ev.attackerId, true);
          if (!ev.isAlive && plant.alive && plant.destroyEarly) plant.destroyEarly();
        }
        return;
      }
      const target = ev.targetId === this.network.localId
        ? this.player
        : (this._remoteFighters.get(ev.targetId) || this._remoteBots.get(ev.targetId) || this._remoteMonsters.get(ev.targetId));
      if (target && target.applyRemoteCombatEvent) {
        target.applyRemoteCombatEvent(ev);
      }
      this._syncOnlineHudBars();
    };

    this.network.onBarrelDestroyed = (msg) => {
      if (!msg || msg.barrelId == null) return;
      if (this.arena && this.arena.breakBarrelById) {
        this.arena.breakBarrelById(msg.barrelId);
      }
    };

    this.network.onWaveUpgradeOpen = (msg) => {
      if (this.network.role !== 'guest' || !msg) return;
      this.state = 'UPGRADE';
      this.player.combatEnabled = false;
      this._coopWaveChoices = Array.isArray(msg.choices) ? msg.choices : [];
      this._coopUpgradePicked = false;
      this._coopUpgradeTimer = msg.timeout || 20;
      if (document.pointerLockElement && document.exitPointerLock) {
        try {
          document.exitPointerLock();
        } catch {
          // Ignora
        }
      }
      const clearedWave = msg.wave || 1;
      const isBossWave = clearedWave % 3 === 0;
      const waveGold = isBossWave ? 40 : 30;
      this.economy.addGold(waveGold);
      this._survivalRunGold += waveGold;
      if (this.sound && this.sound.playCoinReward) this.sound.playCoinReward();
      if (this.hud && this.hud.showGoldToast) {
        this.hud.showGoldToast(waveGold, isBossWave ? 'Coloso derrotado' : 'Oleada completada');
      }
      this.hud.showUpgradeModal(this._coopWaveChoices, clearedWave);
    };

    this.network.onUpgradeSelected = (msg) => {
      const pid = msg && (msg.playerId || msg.peerId);
      if (this.network.role !== 'host' || this.state !== 'UPGRADE' || !pid) return;
      this._handleHostCoopUpgradePick(pid, msg.upgradeId);
    };

    this.network.onStartNextWave = (msg) => {
      if (this.network.role !== 'guest' || !msg) return;
      this.hud.hideUpgradeModal();
      this._coopUpgradePicked = false;
      this._coopWaveChoices = [];
      const myAura = msg.auraStates && msg.auraStates[this.network.localId];
      if (myAura) {
        this._guestAuraState = { ...myAura };
        if (this.hud && this.hud.setSurvivalAura) {
          this.hud.setSurvivalAura(this._getGuestAuraHudState());
        }
      }
      const nextWave = msg.wave || 1;
      this.hud.updateSurvivalStats(nextWave, msg.remaining || 0, msg.score || 0);
      this.hud.updateBossBar(null);
      this._syncOnlineHudBars();
      this.state = 'COUNTDOWN';
      this.countdownTimer = 1.4;
      this._fightBannerTimer = 0;
      this._playedReadyTone = false;
      this._playedGoTone = false;
      this.hud.setCountdown(nextWave % 3 === 0 ? `¡OLEADA ${nextWave} · JEFE!` : `¡OLEADA ${nextWave}!`, true);
      this.input.requestLock();
    };

    this.network.onMatchOver = (msg) => {
      if (this.network.role !== 'guest' || !msg) return;
      this.state = 'GAME_OVER';
      this.player.combatEnabled = false;
      for (const rf of this._remoteFighters.values()) rf.combatEnabled = false;
      for (const brf of this._remoteBots.values()) brf.combatEnabled = false;
      this.hud.hideUpgradeModal();
      this.hud.setCountdown('', false);
      this.hud.setRingOutDanger(false);
      this.hud.setSpectatingAlly(false);
      if (this.arena) this.arena.setEdgeDanger(0);
      const didWin = msg.winnerTeam
        ? msg.winnerTeam === this.player.team
        : msg.winnerId
          ? msg.winnerId === this.network.localId
          : !!msg.victory;
      if (this.sound) this.sound.playMatchEnd(didWin);
      if (document.pointerLockElement && document.exitPointerLock) {
        try {
          document.exitPointerLock();
        } catch {
          // Ignora
        }
      }
      const goldReward = this._awardMatchEndGold(didWin, msg.mode || 'online_end');
      this.hud.showGameOver({
        victory: didWin,
        title: msg.title || 'FIN DE LA PARTIDA',
        subtitle: msg.subtitle || '',
        mode: msg.mode || 'online_end',
        isOnline: true,
        isHost: false,
        goldReward,
        totalGold: this.economy.getGold(),
      });
    };

    this.network.onReturnToLobby = () => {
      this._enterOnlineLobbyFromMatch();
    };

    this.network.onPeerDisconnected = (peerId) => {
      if (peerId === 'host') {
        this._clearRemoteFighters();
        this.hud.setOnlineMode(false);
        this.openElementSelector('online');
        this.hud.setOnlineLobbyVisible(false);
        this.hud.setOnlineStatus('El Host se desconectó de la sala.', true);
        return;
      }
      const rf = this._remoteFighters.get(peerId);
      if (rf) {
        this._remoteFighters.delete(peerId);
        this.enemies = this.enemies.filter((e) => e.fighter !== rf);
        this.combat.removeFighter(rf);
        rf.dispose();
        if (this.state === 'FIGHTING') {
          this.hud.addKillFeedEntry('Sistema', `${rf.displayName} salió`, '#ffd166', '#b8f4ff');
        }
      }
    };
  }

  _clearRemoteFighters() {
    if (!this._remoteFighters) return;
    for (const rf of this._remoteFighters.values()) {
      this.combat.removeFighter(rf);
      rf.dispose();
    }
    this._remoteFighters.clear();
  }

  _clearRemoteMonsters() {
    if (this._remoteMonsters) {
      for (const m of this._remoteMonsters.values()) {
        if (this.combat) this.combat.removeFighter(m);
        if (m.dispose) m.dispose();
      }
      this._remoteMonsters.clear();
    }
    if (this._remoteBots) {
      for (const botRf of this._remoteBots.values()) {
        if (this.combat) this.combat.removeFighter(botRf);
        if (botRf.dispose) botRf.dispose();
      }
      this._remoteBots.clear();
    }
  }

  _resetCombatNetworkHooks() {
    this.combat.isAuthoritative = true;
    this.combat.onLocalAbilityCast = null;
    this.combat.onAuthoritativeCombatEvent = null;
    this.player.onLocalAbyssFall = null;
    this._pendingAbyssFall = false;
    this._coopUpgradePicked = false;
    this._coopWaveChoices = [];
    if (this.classicArena) {
      this.classicArena.barrelsPassive = false;
      this.classicArena.onBarrelBreak = null;
    }
    if (this.sanctuaryMap) {
      this.sanctuaryMap.barrelsPassive = false;
      this.sanctuaryMap.onBarrelBreak = null;
    }
  }

  /** Devuelve los monstruos activos para proyectar marcadores en el HUD (offline, host y guest) */
  getSurvivalMonstersForHud() {
    if (this.format !== 'survival') return [];
    if (this.isOnline && this.network && this.network.role === 'guest') {
      return this._remoteMonsters ? Array.from(this._remoteMonsters.values()) : [];
    }
    return this.waveManager ? this.waveManager.activeMonsters : [];
  }

  _createGuestAuraState(element = 'earth') {
    return {
      unlocked: false,
      element,
      baseDuration: 5.0,
      baseCooldown: 14.0,
      activeTimer: 0,
      cooldownTimer: 0,
      tickAccum: 0,
      targetIcd: new Map(),
      upgrades: {},
    };
  }

  _getGuestAuraHudState() {
    const aura = this._guestAuraState || this._createGuestAuraState(this.playerElement);
    const elem = this.player?.element || aura.element || 'earth';
    const def = this.waveManager ? (this.waveManager.constructor?.AURA_DEFS?.[elem] || null) : null;
    const names = { earth: 'Baluarte Sísmico', fire: 'Tormenta Solar', water: 'Marea Sanadora', air: 'Vendaval Etéreo', nature: 'Bosque Vivo', psychic: 'Mente Trascendente', storm: 'Ojo del Huracán', light: 'Halo Radiante', shadow: 'Segador Nocturno', samurai: 'Espíritu Bushidō' };
    const colors = { earth: '#d49a45', fire: '#ff6a1a', water: '#46c8ff', air: '#90f2ff', nature: '#4ade80', psychic: '#e879f9', storm: '#38bdf8', light: '#facc15', shadow: '#f43f5e', samurai: '#ef4444' };
    const dur = aura.baseDuration || 5.0;
    const cd = aura.baseCooldown || 14.0;
    return {
      unlocked: !!aura.unlocked,
      element: elem,
      name: (def && def.name) || names[elem] || 'Aura Elemental',
      color: (def && def.color) || colors[elem] || '#d49a45',
      active: !!aura.active || (aura.activeRemaining || 0) > 0,
      activeRemaining: aura.activeRemaining || 0,
      activeRatio: dur > 0 ? Math.max(0, Math.min(1, (aura.activeRemaining || 0) / dur)) : 0,
      cooldownRemaining: aura.active ? 0 : (aura.cooldownRemaining || 0),
      cooldownTotal: cd,
      ready: !!aura.unlocked && !aura.active && (aura.cooldownRemaining || 0) <= 0,
    };
  }

  _activateGuestAura(rf) {
    const aura = this._guestAuras.get(rf.id);
    if (!aura || !aura.unlocked || !rf.isAlive || rf.isFrozen) return false;
    if (aura.activeTimer > 0 || aura.cooldownTimer > 0) return false;

    const hasEternal = !!(
      aura.upgrades.fire_eternal || aura.upgrades.earth_perpetual ||
      aura.upgrades.water_eternal || aura.upgrades.air_eternal ||
      aura.upgrades.nature_eternal || aura.upgrades.psychic_eternal ||
      aura.upgrades.storm_eternal || aura.upgrades.light_eternal ||
      aura.upgrades.shadow_eternal || aura.upgrades.samurai_immortal
    );
    aura.element = rf.element || aura.element || 'earth';
    aura.activeTimer = aura.baseDuration + (hasEternal ? 2.5 : 0);
    aura.cooldownTimer = Math.max(4.0, aura.baseCooldown - (hasEternal ? 2.5 : 0));
    aura.tickAccum = 0.12;
    aura.lightNovaTimer = 2.0;
    aura.targetIcd.clear();

    if (aura.element === 'samurai' && rf.survivalMods) {
      rf.survivalMods.auraBushido = true;
      rf.survivalMods.auraAttackSpeedMult = 1.3;
      rf.survivalMods.auraDamageTakenMult = 0.65;
      rf.survivalMods.auraSamuraiHealPerHit = aura.upgrades.samurai_bloodthirst ? 6 : 3;
      rf.survivalMods.auraMeleeMult = aura.upgrades.samurai_bloodthirst ? 1.25 : 1;
      rf.survivalMods.auraVoidEdge = !!aura.upgrades.samurai_void_edge;
    }

    if (rf.mesh && rf.mesh.setElementalAura) {
      rf.mesh.setElementalAura(aura.element, true, 1.0);
    }
    this._playOnlineAuraVisual(rf.id);
    return true;
  }

  _playOnlineAuraVisual(senderId) {
    const actor = senderId === this.network.localId
      ? this.player
      : (this._remoteFighters.get(senderId) || null);
    if (!actor) return;
    const elem = actor.element || 'earth';
    const colors = { earth: '#d49a45', fire: '#ff6a1a', water: '#46c8ff', air: '#90f2ff', nature: '#4ade80', psychic: '#e879f9', storm: '#38bdf8', light: '#facc15', shadow: '#f43f5e', samurai: '#ef4444' };
    const col = colors[elem] || '#ffd86b';
    if (actor === this.player) {
      if (this.hud && this.hud.pulseCrosshair) this.hud.pulseCrosshair('aura_r');
      if (this._guestAuraState) {
        this._guestAuraState.active = true;
        this._guestAuraState.activeRemaining = this._guestAuraState.baseDuration || 5.0;
        if (this.hud && this.hud.setSurvivalAura) this.hud.setSurvivalAura(this._getGuestAuraHudState());
      }
    }
    if (actor.mesh && actor.mesh.setElementalAura) {
      actor.mesh.setElementalAura(elem, true, 1.0);
      if (actor.mesh.flash) actor.mesh.flash(col);
    }
    if (this.sound && this.sound.playAuraActivate) {
      this.sound.playAuraActivate(elem);
    }
    if (this.combat && this.combat.vfx) {
      this.combat.vfx.spawnShockwave(actor.position, 3.8, 0.42, col);
    }
  }

  _updateGuestAurasTick(dt) {
    if (!this._guestAuras || this.format !== 'survival') return;
    const monsters = this.waveManager ? this.waveManager.activeMonsters : [];
    for (const [peerId, rf] of this._remoteFighters.entries()) {
      const aura = this._guestAuras.get(peerId);
      if (!aura || !aura.unlocked) continue;
      if (!rf.isAlive) {
        if (aura.activeTimer > 0) {
          aura.activeTimer = 0;
          if (rf.mesh && rf.mesh.setElementalAura) rf.mesh.setElementalAura(aura.element, false);
        }
        continue;
      }
      if (aura.activeTimer > 0) {
        aura.activeTimer = Math.max(0, aura.activeTimer - dt);
        if (aura.element === 'water') {
          rf.hp = Math.min(rf.maxHp, rf.hp + (aura.upgrades.water_spring ? 16 : 8) * dt);
        } else if (aura.element === 'nature') {
          rf.hp = Math.min(rf.maxHp, rf.hp + (aura.upgrades.nature_sap ? 12 : 6) * dt);
        }
        if (aura.element === 'light' && aura.upgrades.light_supernova) {
          aura.lightNovaTimer = (aura.lightNovaTimer ?? 2.0) - dt;
          if (aura.lightNovaTimer <= 0) {
            aura.lightNovaTimer = 2.0;
            const novaRadius = 7.25;
            if (this.sound && this.sound.playLightFlash) this.sound.playLightFlash();
            if (this.combat?.vfx) {
              this.combat.vfx.spawnShockwave(rf.position, novaRadius * 1.1, 0.34, '#facc15');
            }
            for (const m of monsters) {
              if (!m || !m.isAlive) continue;
              const dx = m.position.x - rf.position.x;
              const dz = m.position.z - rf.position.z;
              if (Math.hypot(dx, dz) <= novaRadius + m.config.radius) {
                const push = new THREE.Vector3(dx, 0.2, dz).normalize();
                m.takeDamage(12, push, 6.0, rf.id);
                if (m.applyStun) m.applyStun(1.1, rf.id);
              }
            }
          }
        }
        aura.tickAccum -= dt;
        if (aura.tickAccum <= 0) {
          aura.tickAccum = aura.element === 'storm' ? (aura.upgrades.storm_unleashed ? 0.55 : 0.8) : 0.5;
          const rMax = aura.element === 'nature'
            ? (aura.upgrades.nature_thorns ? 6.9 : 4.8)
            : aura.element === 'psychic'
              ? (aura.upgrades.psychic_dome ? 7.2 : 5.0)
              : aura.element === 'storm'
                ? (aura.upgrades.storm_unleashed ? 7.25 : 5.0)
                : aura.element === 'light'
                  ? (aura.upgrades.light_supernova ? 7.25 : 5.0)
                  : aura.element === 'shadow'
                    ? (aura.upgrades.shadow_voracious_eclipse ? 7.25 : 5.0)
                    : 4.4;
          let shadowDamageDealt = 0;
          for (const m of monsters) {
            if (!m || !m.isAlive) continue;
            const dx = m.position.x - rf.position.x;
            const dz = m.position.z - rf.position.z;
            if (Math.hypot(dx, dz) <= rMax + m.config.radius) {
              const push = new THREE.Vector3(dx, 0.16, dz).normalize();
              if (aura.element === 'fire') {
                m.takeDamage(5, push, 1.8, rf.id);
                m.applyBurn(2.2, 4.5, rf.id);
              } else if (aura.element === 'earth' || aura.element === 'air') {
                m.takeDamage(aura.element === 'earth' ? 6 : 3, push, 5.2, rf.id);
              } else if (aura.element === 'water') {
                m.applyFreeze(1.0, rf.id);
              } else if (aura.element === 'nature') {
                m.takeDamage(aura.upgrades.nature_thorns ? 5.8 : 4, push, 1.2, rf.id);
                m.velocity.x *= 0.45;
                m.velocity.z *= 0.45;
                if (aura.upgrades.nature_roots && m.applyRoot) m.applyRoot(1.2, rf.id);
              } else if (aura.element === 'psychic') {
                m.takeDamage(aura.upgrades.psychic_dome ? 5.1 : 3.5, push, 1.6, rf.id);
                if (aura.upgrades.psychic_hysteria && m.applyConfusion) m.applyConfusion(1.5, rf.id);
              } else if (aura.element === 'storm') {
                m.takeDamage(10, push, 4.2, rf.id);
                m._hitstunTimer = Math.max(m._hitstunTimer || 0, 0.25);
              } else if (aura.element === 'light') {
                m.takeDamage(aura.upgrades.light_supernova ? 6.5 : 4.5, push, 1.4, rf.id);
              } else if (aura.element === 'shadow') {
                const tickDmg = aura.upgrades.shadow_voracious_eclipse ? 6.5 : 4.5;
                const hpBefore = m.hp;
                m.takeDamage(tickDmg, push, 1.4, rf.id);
                shadowDamageDealt += Math.max(0, hpBefore - Math.max(0, m.hp)) || tickDmg;
              }
            }
          }
          if (aura.element === 'shadow' && shadowDamageDealt > 0 && rf.isAlive) {
            const leech = aura.upgrades.shadow_voracious_eclipse ? 0.5 : 0.25;
            rf.hp = Math.min(rf.maxHp, rf.hp + shadowDamageDealt * leech);
          }
        }
        if (aura.activeTimer <= 0 && rf.mesh && rf.mesh.setElementalAura) {
          rf.mesh.setElementalAura(aura.element, false);
          if (rf.survivalMods && aura.element === 'samurai') {
            rf.survivalMods.auraBushido = false;
            rf.survivalMods.auraAttackSpeedMult = 1;
            rf.survivalMods.auraDamageTakenMult = 1;
            rf.survivalMods.auraSamuraiHealPerHit = 0;
            rf.survivalMods.auraMeleeMult = 1;
            rf.survivalMods.auraVoidEdge = false;
          }
        }
      } else if (aura.cooldownTimer > 0) {
        aura.cooldownTimer = Math.max(0, aura.cooldownTimer - dt);
      }
    }
  }

  _applyUpgradeToFighterStats(fighter, upgradeId, auraState = null) {
    if (!fighter) return;
    const mods = fighter.survivalMods || (fighter.survivalMods = {
      damageMult: 1, cooldownMult: 1, speedMult: 1, jumpMult: 1, knockbackMult: 1,
      lifesteal: 0, damageTakenMult: 1, statusDurationMult: 1, burnDamageMult: 1,
      dashCooldownMult: 1, extraDashCharges: 0, hpRegen: 0, critChance: 0, areaMult: 1,
      auraSpeedMult: 1, auraDamageMult: 1, auraCooldownMult: 1, auraKnockbackMult: 1,
      auraAirJumps: 0, auraDashCharges: 0, auraShieldHp: 0,
    });
    if (upgradeId === 'aura_unlock' && auraState) {
      auraState.unlocked = true;
      auraState.activeTimer = 0;
      auraState.cooldownTimer = 0;
    } else if (upgradeId === 'damage') {
      mods.damageMult = Number((mods.damageMult * 1.15).toFixed(3));
    } else if (upgradeId === 'cooldown') {
      mods.cooldownMult = Number((mods.cooldownMult * 0.86).toFixed(3));
    } else if (upgradeId === 'maxhp') {
      fighter.maxHp += 25;
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + 25);
    } else if (upgradeId === 'speed') {
      mods.speedMult = Number((mods.speedMult * 1.12).toFixed(3));
      mods.jumpMult = Number((mods.jumpMult * 1.08).toFixed(3));
      if (fighter.config) fighter.config.runSpeed = FIGHTER_CONFIG.runSpeed * mods.speedMult;
    } else if (upgradeId === 'knockback') {
      mods.knockbackMult = Number((mods.knockbackMult * 1.22).toFixed(3));
    } else if (upgradeId === 'lifesteal') {
      mods.lifesteal = Number((mods.lifesteal + 0.12).toFixed(3));
    } else if (upgradeId === 'armor') {
      mods.damageTakenMult = Number((mods.damageTakenMult * 0.88).toFixed(3));
    } else if (upgradeId === 'status_mastery') {
      mods.statusDurationMult = Number((mods.statusDurationMult * 1.35).toFixed(3));
      mods.burnDamageMult = Number((mods.burnDamageMult * 1.25).toFixed(3));
    } else if (upgradeId === 'dash_boost') {
      mods.dashCooldownMult = Number((mods.dashCooldownMult * 0.75).toFixed(3));
      mods.extraDashCharges += 1;
      if (typeof fighter.getMaxDashCharges === 'function') {
        fighter._dashCharges = Math.min(fighter.getMaxDashCharges(), fighter._dashCharges + 1);
      }
    } else if (upgradeId === 'regen') {
      mods.hpRegen = Number((mods.hpRegen + 2.5).toFixed(2));
    } else if (upgradeId === 'crit') {
      mods.critChance = Math.min(1, Number((mods.critChance + 0.2).toFixed(2)));
    } else if (upgradeId === 'area') {
      mods.areaMult = Number((mods.areaMult * 1.18).toFixed(3));
    } else if (auraState && typeof upgradeId === 'string' && upgradeId.includes('_')) {
      auraState.upgrades[upgradeId] = true;
      if (upgradeId === 'storm_mist_step') {
        mods.mistCooldownMult = 0.65;
        mods.mistExitDischarge = true;
      } else if (upgradeId === 'light_explosive_mirage') {
        mods.lightMirageCdMult = 0.65;
        mods.auraLightExplosiveMirage = true;
      } else if (upgradeId === 'samurai_immortal') {
        mods.samuraiShogunBonus = 2.5;
      } else if (upgradeId === 'samurai_chain_reaper') {
        mods.samuraiChainReaper = true;
        mods.samuraiChainCdMult = 0.65;
      } else if (upgradeId === 'samurai_void_edge') {
        mods.auraVoidEdge = true;
      } else if (upgradeId === 'samurai_bloodthirst') {
        mods.auraMeleeMult = 1.25;
      }
    }
  }

  _reviveDeadOnlineCoopAllies(reviver) {
    const basePos = reviver ? reviver.position : new THREE.Vector3(0, 0, 0);
    let offsetIdx = 0;
    for (const f of [this.player, ...this._remoteFighters.values()]) {
      if (!f || f.isAlive) continue;
      offsetIdx += 1;
      const spawn = new THREE.Vector3(basePos.x + offsetIdx * 2.2, basePos.y, basePos.z);
      if (this.arena && this.arena.getGroundHeightAt) {
        const gy = this.arena.getGroundHeightAt(spawn.x, 4, spawn.z);
        spawn.y = Number.isFinite(gy) ? gy : Math.max(0, basePos.y);
      }
      f.resetFighter(spawn, reviver ? reviver.yaw : Math.PI, true);
      f.hp = Math.max(1, Math.round(f.maxHp * 0.5));
      f.isAlive = true;
      f.combatEnabled = false;
      f.allyRegenAmount = 1;
      f.allyRegenInterval = 2.0;
      f._allyRegenTimer = 2.0;
      if (f.mesh && f.mesh.root) {
        f.mesh.root.visible = true;
        if (f !== this.player && f.mesh.setTeamRing) f.mesh.setTeamRing('ally');
        if (f.mesh.flash) f.mesh.flash('#6be6ff');
      }
      if (this.combat && this.combat.vfx) {
        this.combat.vfx.spawnShockwave(spawn, 3.2, 0.4, '#6be6ff');
      }
    }
  }

  _handleHostCoopUpgradePick(peerId, upgradeId) {
    if (this._coopPicks.has(peerId)) return;
    this._coopPicks.set(peerId, upgradeId);

    if (peerId === this.network.localId) {
      this.waveManager.applyUpgrade(upgradeId, null);
      if (upgradeId === 'revive_ally') {
        this._reviveDeadOnlineCoopAllies(this.player);
      }
      this.hud.hideUpgradeModal();
      this.hud.setCountdown('Esperando al grupo...', true);
    } else {
      const rf = this._remoteFighters.get(peerId);
      if (rf) {
        if (upgradeId === 'revive_ally') {
          this._reviveDeadOnlineCoopAllies(rf);
        } else {
          this._applyUpgradeToFighterStats(rf, upgradeId, this._guestAuras.get(peerId));
        }
      }
    }

    const totalExpected = 1 + this._remoteFighters.size;
    if (this._coopPicks.size >= totalExpected) {
      this._hostAdvanceCoopWave();
    }
  }

  _hostAdvanceCoopWave() {
    if (this.network.role !== 'host' || this.state !== 'UPGRADE') return;
    this._coopUpgradeTimer = 0;
    this.hud.hideUpgradeModal();

    if (!this.player.isAlive) {
      // Si el Host murió antes, reactiva cámara sobre sí mismo solo si revivió; si sigue muerto mantiene espectador
      const aliveHuman = Array.from(this._remoteFighters.values()).find((r) => r.isAlive);
      if (aliveHuman) {
        this.camera.setTarget(aliveHuman, true);
        this.hud.setSpectatingAlly(true, aliveHuman);
      }
    } else {
      this.camera.setTarget(this.player, false);
      this.hud.setSpectatingAlly(false);
    }

    const nextWave = this.waveManager.wave + 1;
    this.waveManager.startWave(nextWave);
    for (const m of this.waveManager.activeMonsters) m.combatEnabled = false;

    const auraStates = {};
    for (const [peerId, gAura] of this._guestAuras.entries()) {
      auraStates[peerId] = {
        unlocked: !!gAura.unlocked,
        element: gAura.element,
        baseDuration: gAura.baseDuration,
        baseCooldown: gAura.baseCooldown,
        active: false,
        activeRemaining: 0,
        cooldownRemaining: 0,
        upgrades: { ...gAura.upgrades },
      };
    }

    this.network.broadcastStartNextWave({
      wave: nextWave,
      remaining: this.waveManager.remainingInWave,
      score: this.waveManager.score,
      auraStates,
    });

    this.hud.updateSurvivalStats(nextWave, this.waveManager.remainingInWave, this.waveManager.score);
    this.hud.updateBossBar(this.waveManager.getActiveBoss());
    if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);

    this.state = 'COUNTDOWN';
    this.countdownTimer = 1.4;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.hud.setCountdown(nextWave % 3 === 0 ? `¡OLEADA ${nextWave} · JEFE!` : `¡OLEADA ${nextWave}!`, true);
    this.input.requestLock();
  }

  _syncOnlineHudBars() {
    if (!this.isOnline) return;
    if (this.format === 'teams') {
      const all = [this.player, ...this.enemies.map((e) => e.fighter)].filter(Boolean);
      const blueAlive = all.filter((f) => f.isAlive && f.team === 'team_blue').length;
      const redAlive = all.filter((f) => f.isAlive && f.team === 'team_red').length;
      this.hud.updateTeamStats(blueAlive, redAlive);
    } else if (this.format === 'ffa') {
      const total = 1 + this._remoteFighters.size;
      const aliveTotal = (this.player.isAlive ? 1 : 0) + Array.from(this._remoteFighters.values()).filter((r) => r.isAlive).length;
      this.hud.updateBattleRoyaleStats(aliveTotal, total, this.playerKills);
    }
  }

  _wrapBotAbilitiesForNetwork(botFighter) {
    const ctrl = botFighter?.elementController;
    if (!ctrl || ctrl._netWrapped) return;
    ctrl._netWrapped = true;
    const map = [
      ['tryPrimary', 'primary'],
      ['trySecondary', 'secondary'],
      ['trySkill1', 'skill1'],
      ['trySkill2', 'skill2'],
    ];
    for (const [fnName, slot] of map) {
      const orig = ctrl[fnName];
      if (typeof orig !== 'function') continue;
      ctrl[fnName] = (aimPoint, ...rest) => {
        const fired = orig.call(ctrl, aimPoint, ...rest);
        if (fired && this.isOnline && this.network && this.network.role === 'host') {
          this.network.broadcastAbilityCast({
            senderId: botFighter.id,
            slot,
            origin: {
              x: botFighter.position.x,
              y: botFighter.position.y,
              z: botFighter.position.z,
            },
            aimPoint: aimPoint
              ? { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z }
              : { x: botFighter.position.x, y: botFighter.position.y, z: botFighter.position.z },
            yaw: botFighter.yaw || 0,
          }, null);
        }
        return fired;
      };
    }
  }

  /** El Host ordena volver al Lobby P2P al finalizar una partida online */
  requestReturnToOnlineLobby() {
    if (!this.isOnline || !this.network || this.network.role !== 'host') return;
    this.network.broadcastReturnToLobby();
    this._enterOnlineLobbyFromMatch();
  }

  _enterOnlineLobbyFromMatch() {
    this.state = 'SELECT';
    this.player.combatEnabled = false;
    this.player.isAlive = false;
    this.player.mesh.root.visible = false;

    if (this.waveManager) this.waveManager.clear();
    this._clearRemoteFighters();
    this._clearRemoteMonsters();
    this._hideExtraBotsFrom(0);
    if (this._bot1) {
      this.combat.removeFighter(this._bot1.fighter);
      this._bot1.fighter.isAlive = false;
      this._bot1.fighter.combatEnabled = false;
      this._bot1.fighter.mesh.root.visible = false;
    }
    this.enemies = [];
    this.combat.clearAll();
    this._resetCombatNetworkHooks();

    if (document.pointerLockElement && document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignora
      }
    }

    this.hud.hideGameOver();
    this.hud.hideUpgradeModal();
    this.hud.setCountdown('', false);
    this.hud.setRingOutDanger(false);
    this.hud.setSpectatingAlly(false);
    this.hud.showElementSelector(true);
    this.hud.setOnlineMode(true);
    this.hud.updateOnlineLobby(
      {
        roomCode: this.network.roomCode,
        players: this.network.players,
        settings: this.network.settings,
      },
      this.network.role,
      this.network.localId
    );
  }

  /** Inicia la partida online desde el Host y notifica a todos los invitados */
  startOnlineHostMatch() {
    if (this.network.role !== 'host') return;
    const players = this.network.players;
    if (players.length < 2 || !players.every((p) => p.ready)) return;

    const mode = this.network.settings.mode || 'classic';
    const format = this.network.settings.format || 'ffa';
    this.setActiveWorld(mode);
    const totalNeeded = format === 'teams' ? Math.max(4, players.length) : players.length;
    const pts = this.arena.getSpawnPoints
      ? this.arena.getSpawnPoints(totalNeeded)
      : [
          new THREE.Vector3(-3.6, 0, 14),
          new THREE.Vector3(3.6, 0, -14),
          new THREE.Vector3(3.6, 0, 14),
          new THREE.Vector3(-3.6, 0, -14),
        ];

    const spawns = players.map((p, idx) => {
      const sp = pts[idx % pts.length];
      const yaw = Math.atan2(-sp.x, -sp.z);
      const team =
        format === 'teams'
          ? idx % 2 === 0
            ? 'team_blue'
            : 'team_red'
          : format === 'survival'
            ? 'team_blue'
            : p.id;
      const resolvedElement =
        p.element && p.element !== 'classic_roulette'
          ? p.element
          : this.economy.rollClassicElement();
      return {
        id: p.id,
        name: p.name,
        element: resolvedElement,
        team,
        pos: [Number(sp.x.toFixed(2)), Number(sp.y.toFixed(2)), Number(sp.z.toFixed(2))],
        yaw: Number(yaw.toFixed(4)),
      };
    });

    const bots = [];
    if (format === 'teams' && players.length < 4) {
      let blueCount = spawns.filter((s) => s.team === 'team_blue').length;
      let redCount = spawns.filter((s) => s.team === 'team_red').length;
      const missing = 4 - players.length;
      for (let b = 0; b < missing; b++) {
        let team = 'team_red';
        if (blueCount < 2) {
          team = 'team_blue';
          blueCount += 1;
        } else {
          redCount += 1;
        }
        const ptIdx = (players.length + b) % pts.length;
        const sp = pts[ptIdx];
        const yaw = Math.atan2(-sp.x, -sp.z);
        const elem = ELEMENT_KEYS[(players.length + b + 1) % ELEMENT_KEYS.length];
        const botId = b === 0 ? 'enemy' : `bot_${b + 1}`;
        bots.push({
          id: botId,
          name: `Maestro IA ${b + 1}`,
          element: elem,
          team,
          pos: [Number(sp.x.toFixed(2)), Number(sp.y.toFixed(2)), Number(sp.z.toFixed(2))],
          yaw: Number(yaw.toFixed(4)),
        });
      }
    }

    const payload = { settings: { mode, format }, spawns, bots };
    this.network.broadcastStartMatch(payload);
    this._startOnlineMatch(payload);
    this.input.requestLock();
  }

  /** Configura escena, Player local y RemoteFighters sincronizados para Host y Guests */
  _startOnlineMatch({ settings = {}, spawns = [], bots = [] }) {
    this._matchGoldAwarded = false;
    this._survivalRunGold = 0;
    this.mode = settings.mode || 'classic';
    this.format = settings.format || 'ffa';
    const isSanctuary = this.mode === 'sanctuary' && this.sanctuaryMap;
    this.setActiveWorld(isSanctuary ? 'sanctuary' : 'classic');

    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    this.hud.setSpectatingAlly(false);
    this.hud.hideGameOver();
    this.hud.hideUpgradeModal();
    if (this.arena) this.arena.setEdgeDanger(0);

    this._clearDojoFlags();
    this._clearRemoteMonsters();
    this._hideExtraBotsFrom(0);
    this.combat.removeFighter(this._bot1.fighter);
    this._bot1.fighter.isAlive = false;
    this._bot1.fighter.combatEnabled = false;
    this._bot1.fighter.mesh.root.visible = false;

    const isHost = this.network.role === 'host';
    this.combat.isAuthoritative = isHost;
    if (this.arena) {
      this.arena.barrelsPassive = !isHost;
      this.arena.onBarrelBreak = isHost
        ? (barrelId) => this.network.broadcastBarrelDestroyed(barrelId)
        : null;
    }
    this.combat.onLocalAbilityCast = (slot, origin, aimPoint, yaw) => {
      const msg = {
        slot,
        origin: [Number(origin.x.toFixed(3)), Number(origin.y.toFixed(3)), Number(origin.z.toFixed(3))],
        aimPoint: [Number(aimPoint.x.toFixed(3)), Number(aimPoint.y.toFixed(3)), Number(aimPoint.z.toFixed(3))],
        yaw,
      };
      if (this.network.role === 'host') {
        this.network.broadcastAbilityCast({ ...msg, senderId: this.network.localId }, null);
      } else if (this.network.role === 'guest') {
        this.network.sendAbilityCast(msg);
      }
    };
    this.combat.onAuthoritativeCombatEvent = isHost
      ? (ev) => {
          let tid = ev.targetId;
          if (tid === 'player') {
            tid = this.network.localId;
          } else if (typeof tid === 'string' && tid.startsWith('plant_player_')) {
            tid = `plant_${this.network.localId}_${tid.slice('plant_player_'.length)}`;
          }
          const out = tid !== ev.targetId ? { ...ev, targetId: tid } : ev;
          this.network.broadcastCombatEvent(out);
        }
      : null;
    this.player.onLocalAbyssFall = !isHost
      ? () => { this._pendingAbyssFall = true; }
      : null;

    this.hud.setOnlineMode(true);
    this.playerKills = 0;
    this._onlineActionNonce = 0;
    this._pendingAbyssFall = false;
    this._coopPicks.clear();
    this._guestAuras.clear();
    this._coopUpgradeTimer = 0;

    const mySpawn = spawns.find((s) => s.id === this.network.localId) || spawns[0];
    if (mySpawn) {
      this.playerElement = mySpawn.element || 'earth';
      this.player.team = mySpawn.team || 'player';
      this.combat.setFighterElement(this.player, this.playerElement);
      if (this.player.mesh && this.player.mesh.setTeamRing) this.player.mesh.setTeamRing(null);
      const pVec = new THREE.Vector3(mySpawn.pos[0], mySpawn.pos[1], mySpawn.pos[2]);
      this.player.resetFighter(pVec, mySpawn.yaw, false);
      this.player.mesh.root.visible = true;
      this.player.combatEnabled = false;
      this.camera.setTarget(this.player, false);
      this.camera.yaw = mySpawn.yaw;
      this.camera.pitch = (isSanctuary ? 14 : 18) * (Math.PI / 180);
      this.camera.snap();
    }

    this.enemies = [];
    const rivalElems = [];
    const rivalNames = [];
    let allyElem = null;

    for (const s of spawns) {
      if (mySpawn && s.id === mySpawn.id) continue;
      const rf = new RemoteFighter({
        id: s.id,
        name: s.name,
        element: s.element || 'earth',
        team: s.team || s.id,
        scene: this.combat.scene,
        arena: this.arena,
      });
      rf.resetFighter(new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), s.yaw, false);
      rf.onDefeated = (fighter, reason) => this._onFighterDefeated(fighter, reason);
      if (this.onFighterDamaged) rf.onDamaged = this.onFighterDamaged;
      const isAlly = (this.format === 'teams' || this.format === 'survival') && s.team === this.player.team;
      const ring = (this.format === 'teams' || this.format === 'survival') ? (isAlly ? 'ally' : 'enemy') : null;
      rf.initCombat(this.combat, ring);
      if (isAlly && !allyElem) allyElem = s.element;

      this._remoteFighters.set(s.id, rf);
      this.enemies.push({ fighter: rf, ai: { update() {} } });

      if (this.format === 'survival' && isHost) {
        this._guestAuras.set(s.id, this._createGuestAuraState(s.element || 'earth'));
      }
      if (s.team !== this.player.team || this.format === 'ffa') {
        rivalElems.push(s.element || 'earth');
        rivalNames.push(s.name || 'Jugador');
      }
    }

    if (this.format === 'teams' && Array.isArray(bots) && bots.length > 0) {
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        const isAlly = b.team === this.player.team;
        if (isHost) {
          const entry = i === 0 ? this._bot1 : this._ensureExtraBot(i - 1);
          entry.fighter.team = b.team;
          entry.fighter.displayName = b.name || entry.fighter.displayName;
          this.combat.registerFighter(entry.fighter, entry.fighter.elementController);
          this.combat.setFighterElement(entry.fighter, b.element || 'earth');
          this._wrapBotAbilitiesForNetwork(entry.fighter);
          if (entry.fighter.mesh && entry.fighter.mesh.setTeamRing) {
            entry.fighter.mesh.setTeamRing(isAlly ? 'ally' : 'enemy');
          }
          entry.fighter.resetFighter(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]), b.yaw, false);
          entry.fighter.mesh.root.visible = true;
          entry.fighter.combatEnabled = false;
          entry.ai.reset();
          entry.ai.setDifficulty('master');
          this.enemies.push(entry);
        } else {
          const botRf = new RemoteFighter({
            id: b.id,
            name: b.name || 'Maestro IA',
            element: b.element || 'earth',
            team: b.team,
            scene: this.combat.scene,
            arena: this.arena,
          });
          botRf.resetFighter(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]), b.yaw, false);
          if (this.onFighterDamaged) botRf.onDamaged = this.onFighterDamaged;
          botRf.initCombat(this.combat, isAlly ? 'ally' : 'enemy');
          this._remoteBots.set(b.id, botRf);
          this.enemies.push({ fighter: botRf, ai: { update() {} } });
        }
        if (isAlly && !allyElem) allyElem = b.element;
        if (!isAlly) {
          rivalElems.push(b.element || 'earth');
          rivalNames.push(b.name || 'Maestro IA');
        }
      }
    }

    if (this.format === 'survival') {
      if (isHost) {
        this.waveManager.resetRun({
          difficulty: this.difficulty || 'master',
          arena: this.arena,
          onDamaged: this.onFighterDamaged,
          onDefeated: (monster, reason) => this._onMonsterDefeated(monster, reason),
        });
        this.waveManager.startWave(1);
        for (const m of this.waveManager.activeMonsters) m.combatEnabled = false;
        this.hud.updateSurvivalStats(1, this.waveManager.remainingInWave, 0);
        this.hud.updateBossBar(this.waveManager.getActiveBoss());
        if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());
      } else {
        this._guestAuraState = this._createGuestAuraState(this.playerElement);
        this.hud.updateSurvivalStats(1, 2, 0);
        this.hud.updateBossBar(null);
        if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this._getGuestAuraHudState());
      }
    } else if (this.format === 'teams') {
      this._syncOnlineHudBars();
    } else {
      this.hud.updateBattleRoyaleStats(1 + this._remoteFighters.size, 1 + this._remoteFighters.size, 0);
    }

    this.hud.setMatchupInfo(
      this.playerElement,
      rivalElems[0] || this.playerElement,
      1,
      rivalElems,
      isSanctuary ? 'sanctuary' : 'classic',
      this.format,
      allyElem,
      rivalNames
    );
    if (this.input.isTouchMode) {
      this.input.requestLock();
    }
    this.hud.showElementSelector(false);
    this.hud.setLocked(this.input.isLocked);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);

    this.state = 'COUNTDOWN';
    this.countdownTimer = 1.6;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.hud.setCountdown(this.format === 'survival' ? '¡SUPERVIVENCIA COOP!' : '¡ONLINE P2P!', true);
  }

  _serializeFighterState(f, overrideId = null, name = '', auraHud = null) {
    const horizSpeed = Math.hypot(f.velocity.x, f.velocity.z);
    let animState = 'idle';
    if (f.isDashing) animState = 'dash';
    else if (!f.onGround) animState = f.velocity.y < -0.5 ? 'fall' : 'jump';
    else if (horizSpeed > 0.6) animState = 'run';

    let action = '';
    let actionDur = 0.35;
    if (f === this.player && f.mesh && f.mesh.action) {
      if (f.mesh.action !== this._lastSentActionRef) {
        this._lastSentActionRef = f.mesh.action;
        this._onlineActionNonce += 1;
      }
      action = `${f.mesh.action.name}:${this._onlineActionNonce}`;
      actionDur = f.mesh.action.duration || 0.35;
    } else if (!f.mesh?.action && f === this.player) {
      this._lastSentActionRef = null;
    }

    return {
      id: overrideId || f.id,
      name: name || f.displayName || this.network.localProfile.name,
      element: f.element || 'earth',
      team: f.team || f.id,
      pos: [Number(f.position.x.toFixed(3)), Number(f.position.y.toFixed(3)), Number(f.position.z.toFixed(3))],
      vel: [Number(f.velocity.x.toFixed(2)), Number(f.velocity.y.toFixed(2)), Number(f.velocity.z.toFixed(2))],
      yaw: Number((f.yaw || 0).toFixed(4)),
      animState,
      action,
      actionDur,
      hp: Math.round(f.hp),
      maxHp: f.maxHp,
      isFrozen: !!f.isFrozen,
      isBurning: !!f.isBurning,
      isRooted: !!f.isRooted,
      isPoisoned: !!f.isPoisoned,
      isConfused: !!f.isConfused,
      isStunned: !!f.isStunned,
      earthOrbitCount: f.earthOrbitCount || 0,
      isEarthTrapped: !!f.isEarthTrapped,
      isMistForm: !!f.isMistFormActive,
      isShadowVeil: !!f.isShadowVeil,
      isShogunArmor: !!f.isShogunArmor,
      isAttackSlowed: !!f.isAttackSlowed,
      auraActive: auraHud ? !!auraHud.active : !!(f.mesh && f.mesh._auraActive),
      auraActiveRemaining: auraHud ? (auraHud.activeRemaining || 0) : 0,
      auraCooldownRemaining: auraHud ? (auraHud.cooldownRemaining || 0) : 0,
      isAlive: !!f.isAlive,
    };
  }

  /** Cambia el escenario visible y propaga la referencia a jugador, bots, cámara y combate */
  setActiveWorld(mode = 'classic') {
    const useSanctuary = mode === 'sanctuary' && this.sanctuaryMap;
    const targetWorld = useSanctuary ? this.sanctuaryMap : this.classicArena;
    const otherWorld = useSanctuary ? this.classicArena : this.sanctuaryMap;

    if (otherWorld && otherWorld.setVisible) otherWorld.setVisible(false);
    if (targetWorld && targetWorld.setVisible) targetWorld.setVisible(true);

    this.arena = targetWorld;
    if (this.player.setArena) this.player.setArena(targetWorld);
    if (this.combat.setArena) this.combat.setArena(targetWorld);
    if (this.camera.setArena) this.camera.setArena(targetWorld);

    this._bot1.fighter.setArena(targetWorld);
    this._bot1.ai.setArena(targetWorld);
    for (const extra of this._extraBots) {
      if (!extra) continue;
      extra.fighter.setArena(targetWorld);
      extra.ai.setArena(targetWorld);
    }
  }

  _ensureExtraBot(slotIndex) {
    // slotIndex 0 -> bot_2, ..., slotIndex 4 -> bot_6
    if (this._extraBots[slotIndex]) return this._extraBots[slotIndex];
    const botNum = slotIndex + 2;
    const f = new EnemyFighter({
      id: `bot_${botNum}`,
      theme: 'rival',
      scene: this.combat.scene,
      arena: this.arena,
      combat: this.combat,
      element: 'fire',
      cooldownBonus: 0.95,
    });
    f.onDefeated = (fighter, reason) => this._onFighterDefeated(fighter, reason);
    if (this.onFighterDamaged) f.onDamaged = this.onFighterDamaged;
    const ai = new EnemyAI({
      enemy: f,
      player: this.player,
      arena: this.arena,
      combat: this.combat,
    });
    const entry = { fighter: f, ai };
    this._extraBots[slotIndex] = entry;
    return entry;
  }

  _hideExtraBotsFrom(startSlotIndex = 0) {
    for (let i = startSlotIndex; i < this._extraBots.length; i++) {
      const b = this._extraBots[i];
      if (!b) continue;
      this.combat.removeFighter(b.fighter);
      b.fighter.isAlive = false;
      b.fighter.combatEnabled = false;
      b.fighter.mesh.root.visible = false;
    }
  }

  _pickDistinctElement(excludeA, excludeB) {
    const preferred = ELEMENT_KEYS.filter((e) => e !== excludeA && e !== excludeB);
    if (preferred.length > 0) {
      return preferred[Math.floor(Math.random() * preferred.length)];
    }
    const fallback = ELEMENT_KEYS.filter((e) => e !== excludeA);
    return fallback[Math.floor(Math.random() * fallback.length)] || 'fire';
  }

  /**
   * Aplica los elementos seleccionados al jugador y bots activos,
   * actualizando controladores, paletas y HUD.
   */
  applyElements(playerElement = 'earth', enemyElement = 'earth') {
    this.playerElement = playerElement;
    this.enemyElement = enemyElement;
    this.bot2Element = this._pickDistinctElement(enemyElement, playerElement);

    this.combat.setFighterElement(this.player, playerElement);
    this.combat.setFighterElement(this._bot1.fighter, enemyElement);
    if (this.mode === 'classic' && this.stage === 2 && this._extraBots[0]) {
      this.combat.setFighterElement(this._extraBots[0].fighter, this.bot2Element);
    }

    if (this.mode === 'classic') {
      const eList = this.stage === 2 ? [this.enemyElement, this.bot2Element] : [this.enemyElement];
      this.hud.setMatchupInfo(playerElement, enemyElement, this.stage, eList, 'classic');
    }
  }

  /** Inicia combate tras elegir elemento, escenario, formato, dificultad y cantidad de bots */
  startMatchWithElements(playerElement = 'earth', enemyElement = 'earth') {
    this._matchGoldAwarded = false;
    this._survivalRunGold = 0;
    const resolvedPlayerElem =
      playerElement === 'classic_roulette'
        ? this.economy.rollClassicElement()
        : playerElement;
    this.playerElement = resolvedPlayerElem;
    this.enemyElement = enemyElement;
    this.player.team = this.format === 'teams' ? 'team_blue' : 'player';
    this.combat.setFighterElement(this.player, resolvedPlayerElem);

    if (this.format === 'survival') {
      this.hud.showElementSelector(false);
      this.startSurvivalMatch();
      this.input.requestLock();
      return;
    }

    if (this.format === 'dojo') {
      this.hud.showElementSelector(false);
      this.startDojoMatch();
      this.input.requestLock();
      return;
    }

    if (this.format === 'teams') {
      this.hud.showElementSelector(false);
      this.startTeamsMatch();
      this.input.requestLock();
      return;
    }

    if (this.mode === 'sanctuary' && this.sanctuaryMap) {
      this.hud.showElementSelector(false);
      this.startSanctuaryMatch();
      this.input.requestLock();
      return;
    }

    this.mode = 'classic';
    const initialStage = this.botCount >= 2 ? 2 : 1;
    this.stage = initialStage;
    this.applyElements(playerElement, enemyElement);
    this.hud.showElementSelector(false);
    this.startStage(initialStage);
    this.input.requestLock();
  }

  _applyBotDifficulties() {
    for (let i = 0; i < this.enemies.length; i++) {
      const entry = this.enemies[i];
      if (!entry) continue;
      if (this.format === 'survival') {
        entry.ai.setDifficulty('master');
        entry.ai.setBehaviorMode('active');
      } else if (this.format === 'dojo') {
        entry.ai.setDifficulty('master');
        entry.ai.setBehaviorMode(this.dojoBehavior);
      } else if (this.format === 'teams') {
        // Aliado azul siempre en Maestro; rivales rojos usan la dificultad elegida
        const diff = entry.fighter.team === 'team_blue' ? 'master' : this.difficulty;
        entry.ai.setDifficulty(diff);
        entry.ai.setBehaviorMode('active');
      } else {
        entry.ai.setDifficulty(this.difficulty);
        entry.ai.setBehaviorMode('active');
      }
    }
  }

  _clearDojoFlags() {
    this.player.isDojoImmortal = false;
    this.player.survivalMods = null;
    this.player.maxHp = 100;
    this.player.config.runSpeed = FIGHTER_CONFIG.runSpeed;
    this.combat.instantPlayerCooldowns = false;
    this.hud.setDojoPanelVisible(false);
    this.hud.hideUpgradeModal();
    if (this.waveManager) this.waveManager.clear();
    this._clearRemoteFighters();
    this._clearRemoteMonsters();
    this._resetCombatNetworkHooks();
    this._bot1.fighter.isDojoImmortal = false;
    this._bot1.fighter.maxHp = 100;
    for (const extra of this._extraBots) {
      if (extra) extra.fighter.isDojoImmortal = false;
    }
  }

  _assignTeamRoles(format) {
    if (format === 'teams') {
      this.player.team = 'team_blue';
      if (this.player.mesh && this.player.mesh.setTeamRing) this.player.mesh.setTeamRing(null);
      for (let i = 0; i < this.enemies.length; i++) {
        const f = this.enemies[i].fighter;
        const isAlly = i === 0;
        f.team = isAlly ? 'team_blue' : 'team_red';
        if (f.mesh && f.mesh.setTeamRing) {
          f.mesh.setTeamRing(isAlly ? 'ally' : 'enemy');
        }
      }
    } else {
      this.player.team = 'player';
      if (this.player.mesh && this.player.mesh.setTeamRing) this.player.mesh.setTeamRing(null);
      for (const e of this.enemies) {
        e.fighter.team = e.fighter.id;
        if (e.fighter.mesh && e.fighter.mesh.setTeamRing) {
          e.fighter.mesh.setTeamRing(null);
        }
      }
    }
  }

  _setupPreviewScene() {
    this.camera.setTarget(this.player, false);
    this.player.mesh.root.visible = true;
    this.hud.setSpectatingAlly(false);

    const isSanctuary = this.mode === 'sanctuary' && this.sanctuaryMap;
    this.setActiveWorld(isSanctuary ? 'sanctuary' : 'classic');
    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.setRingOutDanger(false);
    if (this.arena) this.arena.setEdgeDanger(0);

    this._clearDojoFlags();

    if (this.format === 'survival') {
      if (this.hud.setSurvivalRecord) this.hud.setSurvivalRecord(this.waveManager.getRecord());
      let allyElem = null;
      if (this.survivalCompanion === 'ally') {
        const pIdx = Math.max(0, ELEMENT_KEYS.indexOf(this.playerElement));
        allyElem = ELEMENT_KEYS[(pIdx + 2) % ELEMENT_KEYS.length];
        this._bot1.fighter.team = 'team_blue';
        this.combat.registerFighter(this._bot1.fighter, this._bot1.fighter.elementController);
        this.combat.setFighterElement(this._bot1.fighter, allyElem);
        if (this._bot1.fighter.mesh && this._bot1.fighter.mesh.setTeamRing) {
          this._bot1.fighter.mesh.setTeamRing('ally');
        }
        this._hideExtraBotsFrom(0);
        this.enemies = [this._bot1];
      } else {
        this._hideExtraBotsFrom(0);
        this.combat.removeFighter(this._bot1.fighter);
        this._bot1.fighter.isAlive = false;
        this._bot1.fighter.mesh.root.visible = false;
        this.enemies = [];
      }
      const spP = isSanctuary ? new THREE.Vector3(0, 0, 25) : new THREE.Vector3(0, 0, 14);
      this.player.team = 'team_blue';
      this.player.resetFighter(spP, Math.PI, false);
      if (this.survivalCompanion === 'ally') {
        this._bot1.fighter.resetFighter(new THREE.Vector3(3.6, 0, spP.z), Math.PI, false);
        this._bot1.fighter.mesh.root.visible = true;
      }
      this.camera.yaw = Math.PI;
      this.camera.pitch = (isSanctuary ? 14 : 12) * (Math.PI / 180);
      this.camera.snap();
      this.hud.setMatchupInfo(this.playerElement, this.playerElement, 1, null, isSanctuary ? 'sanctuary' : 'classic', 'survival', allyElem);
      this.hud.updateSurvivalStats(1, 2, 0);
    } else if (this.format === 'dojo') {
      this._configureStageRoster(1);
      this._assignTeamRoles('ffa');
      this.combat.setFighterElement(this._bot1.fighter, this.enemyElement);
      const spP = isSanctuary ? new THREE.Vector3(0, 0, 25) : PLAYER_SPAWN_S1;
      const spE = isSanctuary ? new THREE.Vector3(0, 0, 12) : ENEMY_SPAWN_S1;
      this.player.resetFighter(spP, Math.PI, false);
      this._bot1.fighter.resetFighter(spE, 0, false);
      this._bot1.fighter.mesh.root.visible = true;
      this._bot1.ai.reset();
      this.camera.yaw = Math.PI;
      this.camera.pitch = (isSanctuary ? 14 : 12) * (Math.PI / 180);
      this.camera.snap();
      this.hud.setMatchupInfo(this.playerElement, this.enemyElement, 1, [this.enemyElement], isSanctuary ? 'sanctuary' : 'classic', 'dojo');
    } else if (this.format === 'teams') {
      const { allyElem, redElems } = this._configureTeamsRoster();
      this._placeTeamsSpawns(isSanctuary);
      this.hud.setMatchupInfo(this.playerElement, redElems[0], 1, redElems, isSanctuary ? 'sanctuary' : 'classic', 'teams', allyElem);
      this.hud.updateTeamStats(2, 2);
    } else if (isSanctuary) {
      const count = Math.max(1, Math.min(6, this.botCount || 3));
      const elems = this._configureSanctuaryRoster(count);
      const spawns = this.arena.getSpawnPoints(1 + count);
      const pYaw = Math.atan2(-spawns[0].x, -spawns[0].z);
      this.player.resetFighter(spawns[0], pYaw, false);
      for (let i = 0; i < this.enemies.length; i++) {
        const sp = spawns[i + 1] || spawns[0];
        const bYaw = Math.atan2(-sp.x, -sp.z);
        this.enemies[i].fighter.resetFighter(sp, bYaw, false);
        this.enemies[i].fighter.mesh.root.visible = true;
        this.enemies[i].fighter.combatEnabled = false;
        this.enemies[i].ai.reset();
      }
      this.camera.yaw = pYaw;
      this.camera.pitch = 14 * (Math.PI / 180);
      this.camera.snap();
      this.hud.setMatchupInfo(this.playerElement, elems[0], 1, elems, 'sanctuary', 'ffa');
    } else {
      const previewStage = this.botCount >= 2 ? 2 : 1;
      this._configureStageRoster(previewStage);
      this._assignTeamRoles('ffa');
      this.player.resetFighter(PLAYER_SPAWN_S1, Math.PI, false);
      this._bot1.fighter.resetFighter(ENEMY_SPAWN_S1, 0, false);
      this._bot1.fighter.mesh.root.visible = true;
      this._bot1.ai.reset();
      if (previewStage === 2 && this._extraBots[0]) {
        const b2 = this._extraBots[0];
        b2.fighter.resetFighter(BOT2_SPAWN_S2, Math.atan2(-BOT2_SPAWN_S2.x, -BOT2_SPAWN_S2.z), false);
        b2.fighter.mesh.root.visible = true;
        b2.ai.reset();
      }
      this.camera.yaw = Math.PI;
      this.camera.pitch = 12 * (Math.PI / 180);
      this.camera.snap();
      const eList = previewStage === 2 ? [this.enemyElement, this.bot2Element] : [this.enemyElement];
      this.hud.setMatchupInfo(this.playerElement, this.enemyElement, previewStage, eList, 'classic', 'ffa');
    }

    this.player.combatEnabled = false;
    for (const e of this.enemies) e.fighter.combatEnabled = false;
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  /** Abre la pantalla de Selección / Menú en el paso indicado (1 = Config, 2 = Elemento) */
  openElementSelector(step = 1) {
    if (step !== 'online' && this.isOnline) {
      this.network.disconnect();
      this.hud.setOnlineMode(false);
    }
    this._setupPreviewScene();

    this.state = 'SELECT';
    this.player.combatEnabled = false;
    for (const e of this.enemies) e.fighter.combatEnabled = false;

    if (document.pointerLockElement && document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignora si no había lock activo
      }
    }

    this.hud.setCountdown('', false);
    this.hud.clearKillFeed();
    this.hud.hideGameOver();
    this.hud.showElementSelector(true, step === 2 ? 2 : 1);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  _configureStageRoster(stageNum) {
    this.stage = stageNum;
    this.combat.registerFighter(this._bot1.fighter, this._bot1.fighter.elementController);

    if (stageNum === 2) {
      const bot2 = this._ensureExtraBot(0);
      this.bot2Element = this._pickDistinctElement(this.enemyElement, this.playerElement);
      this.combat.registerFighter(bot2.fighter, bot2.fighter.elementController);
      this.combat.setFighterElement(bot2.fighter, this.bot2Element);
      bot2.fighter.mesh.root.visible = true;
      this._hideExtraBotsFrom(1);
      this.enemies = [this._bot1, bot2];
    } else {
      this._hideExtraBotsFrom(0);
      this.enemies = [this._bot1];
    }
  }

  _configureSanctuaryRoster(botCount) {
    const playerIdx = Math.max(0, ELEMENT_KEYS.indexOf(this.playerElement));
    const orderedOtherElems = [
      ELEMENT_KEYS[(playerIdx + 1) % ELEMENT_KEYS.length],
      ELEMENT_KEYS[(playerIdx + 2) % ELEMENT_KEYS.length],
      ELEMENT_KEYS[(playerIdx + 3) % ELEMENT_KEYS.length],
      ELEMENT_KEYS[playerIdx],
    ];

    const roster = [];
    const elems = [];
    const preferred = this.hud && this.hud.selectedRivalChoice !== 'random' ? this.hud.selectedRivalChoice : null;

    for (let i = 0; i < botCount; i++) {
      const elem = i === 0 && preferred ? preferred : orderedOtherElems[i % orderedOtherElems.length];
      const entry = i === 0 ? this._bot1 : this._ensureExtraBot(i - 1);
      entry.fighter.team = entry.fighter.id;
      this.combat.registerFighter(entry.fighter, entry.fighter.elementController);
      this.combat.setFighterElement(entry.fighter, elem);
      if (entry.fighter.mesh && entry.fighter.mesh.setTeamRing) entry.fighter.mesh.setTeamRing(null);
      entry.fighter.mesh.root.visible = true;
      roster.push(entry);
      elems.push(elem);
    }

    this._hideExtraBotsFrom(Math.max(0, botCount - 1));
    this.enemies = roster;
    this.enemyElement = elems[0] || 'fire';
    return elems;
  }

  _configureTeamsRoster() {
    const playerIdx = Math.max(0, ELEMENT_KEYS.indexOf(this.playerElement));
    const allyElem = ELEMENT_KEYS[(playerIdx + 2) % ELEMENT_KEYS.length];
    const preferred = this.hud && this.hud.selectedRivalChoice !== 'random' ? this.hud.selectedRivalChoice : null;
    const redElem1 = preferred || ELEMENT_KEYS[(playerIdx + 1) % ELEMENT_KEYS.length];
    const redElem2 = this._pickDistinctElement(redElem1, allyElem);

    const bot2 = this._ensureExtraBot(0);
    const bot3 = this._ensureExtraBot(1);
    const roster = [this._bot1, bot2, bot3];
    const elems = [allyElem, redElem1, redElem2];

    this.player.team = 'team_blue';
    this.combat.setFighterElement(this.player, this.playerElement);
    if (this.player.mesh && this.player.mesh.setTeamRing) this.player.mesh.setTeamRing(null);

    for (let i = 0; i < roster.length; i++) {
      const entry = roster[i];
      const isAlly = i === 0;
      entry.fighter.team = isAlly ? 'team_blue' : 'team_red';
      this.combat.registerFighter(entry.fighter, entry.fighter.elementController);
      this.combat.setFighterElement(entry.fighter, elems[i]);
      if (entry.fighter.mesh && entry.fighter.mesh.setTeamRing) {
        entry.fighter.mesh.setTeamRing(isAlly ? 'ally' : 'enemy');
      }
      entry.fighter.mesh.root.visible = true;
    }

    this._hideExtraBotsFrom(2);
    this.enemies = roster;
    this.enemyElement = redElem1;
    this.bot2Element = redElem2;
    return { allyElem, redElems: [redElem1, redElem2] };
  }

  _placeTeamsSpawns(isSanctuary) {
    const zPos = isSanctuary ? 25 : 16;
    const pSpawn = new THREE.Vector3(-3.6, 0, zPos);
    const aSpawn = new THREE.Vector3(3.6, 0, zPos);
    const r1Spawn = new THREE.Vector3(-3.6, 0, -zPos);
    const r2Spawn = new THREE.Vector3(3.6, 0, -zPos);

    this.player.resetFighter(pSpawn, Math.PI, false);
    this.player.mesh.root.visible = true;

    const specs = [
      { entry: this.enemies[0], sp: aSpawn, yaw: Math.PI },
      { entry: this.enemies[1], sp: r1Spawn, yaw: 0 },
      { entry: this.enemies[2], sp: r2Spawn, yaw: 0 },
    ];
    for (const s of specs) {
      if (!s.entry) continue;
      s.entry.fighter.resetFighter(s.sp, s.yaw, false);
      s.entry.fighter.mesh.root.visible = true;
      s.entry.fighter.combatEnabled = false;
      s.entry.ai.reset();
    }

    this.camera.yaw = Math.PI;
    this.camera.pitch = (isSanctuary ? 14 : 12) * (Math.PI / 180);
    this.camera.snap();
  }

  /** Inicia una sesión libre de Modo Dojo (Arena Clásica o Santuario Elemental) */
  startDojoMatch() {
    this.format = 'dojo';
    this.stage = 1;
    this.botCount = 1;
    const isSanctuary = this.mode === 'sanctuary' && !!this.sanctuaryMap;
    this.setActiveWorld(isSanctuary ? 'sanctuary' : 'classic');
    this.camera.setTarget(this.player, false);
    this.hud.setSpectatingAlly(false);

    this._configureStageRoster(1);
    this._assignTeamRoles('ffa');
    this.combat.setFighterElement(this.player, this.playerElement);
    this.combat.setFighterElement(this._bot1.fighter, this.enemyElement);

    this.player.isDojoImmortal = true;
    this._bot1.fighter.isDojoImmortal = true;
    this.dojoBehavior = 'passive';
    this.dojoInstantCd = false;
    this.combat.instantPlayerCooldowns = false;
    this.dojoStats = { lastDamage: 0, comboDamage: 0, comboTimer: 0 };

    this._applyBotDifficulties();
    this._resetDojoFightersAndArena(isSanctuary);

    this.hud.setMatchupInfo(
      this.playerElement,
      this.enemyElement,
      1,
      [this.enemyElement],
      isSanctuary ? 'sanctuary' : 'classic',
      'dojo'
    );
    this.hud.setDojoPanelVisible(true, { startCollapsed: !!this.input?.isTouchMode });
    this.hud.updateDojoControls({ behavior: this.dojoBehavior, instantCooldown: this.dojoInstantCd });
    this.hud.updateDojoTelemetry({ lastDamage: 0, comboDamage: 0, status: 'Normal' });

    this.state = 'FIGHTING';
    this.countdownTimer = 0;
    this._fightBannerTimer = 0.65;
    this.winner = null;
    this.reason = null;

    this.player.combatEnabled = true;
    this._bot1.fighter.combatEnabled = true;

    this.hud.showElementSelector(false);
    this.hud.hideGameOver();
    this.hud.setCountdown('¡DOJO DE PRÁCTICA!', true);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  _resetDojoFightersAndArena(isSanctuary) {
    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    if (this.arena) this.arena.setEdgeDanger(0);

    const pSpawn = isSanctuary ? new THREE.Vector3(0, 0, 25) : new THREE.Vector3(0, 0, 12);
    const bSpawn = isSanctuary ? new THREE.Vector3(0, 0, 13) : new THREE.Vector3(0, 0, -4);
    this.player.resetFighter(pSpawn, Math.PI, false);
    this.player.mesh.root.visible = true;
    this._bot1.fighter.resetFighter(bSpawn, 0, false);
    this._bot1.fighter.mesh.root.visible = true;
    this._bot1.ai.reset();
    this._applyBotDifficulties();

    this.camera.yaw = Math.PI;
    this.camera.pitch = (isSanctuary ? 14 : 12) * (Math.PI / 180);
    this.camera.snap();
  }

  /** Alterna el comportamiento del bot en Modo Dojo (F1): Pasivo -> Defensivo -> Combate Activo */
  cycleDojoBehavior() {
    if (this.format !== 'dojo') return;
    const order = ['passive', 'defensive', 'active'];
    const idx = order.indexOf(this.dojoBehavior);
    this.dojoBehavior = order[(idx + 1) % order.length];
    this._bot1.ai.setDifficulty('master');
    this._bot1.ai.setBehaviorMode(this.dojoBehavior);
    this.hud.updateDojoControls({ behavior: this.dojoBehavior, instantCooldown: this.dojoInstantCd });
  }

  /** Activa/desactiva Recarga Instantánea en Modo Dojo (F2) */
  toggleDojoInstantCooldown() {
    if (this.format !== 'dojo') return;
    this.dojoInstantCd = !this.dojoInstantCd;
    this.combat.instantPlayerCooldowns = this.dojoInstantCd;
    if (this.dojoInstantCd) {
      this.combat.clearPlayerCooldowns();
    }
    this.hud.updateDojoControls({ behavior: this.dojoBehavior, instantCooldown: this.dojoInstantCd });
  }

  /** Reinicia posiciones, HP y construcciones en Modo Dojo (F3) */
  resetDojoPositions() {
    if (this.format !== 'dojo') return;
    const isSanctuary = this.mode === 'sanctuary' && !!this.sanctuaryMap;
    this._resetDojoFightersAndArena(isSanctuary);
    this.player.combatEnabled = true;
    this._bot1.fighter.combatEnabled = true;
    this.dojoStats = { lastDamage: 0, comboDamage: 0, comboTimer: 0 };
    this.hud.updateDojoTelemetry({ lastDamage: 0, comboDamage: 0, status: 'Normal' });
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  _formatFighterStatus(fighter) {
    if (!fighter) return 'Normal';
    const tags = [];
    if (fighter.isFrozen) tags.push('Congelado');
    if (fighter.isBurning) tags.push('Quemado');
    if (fighter.isRooted) tags.push('Enredado');
    if (fighter.isPoisoned) tags.push('Envenenado');
    if (fighter.isConfused) tags.push('Confundido');
    if (fighter.isStunned) tags.push('Cegado');
    if (fighter.isMistFormActive) tags.push('Niebla');
    return tags.length > 0 ? tags.join(' + ') : 'Normal';
  }

  /** Registra impacto sobre el rival de práctica para la telemetría del Dojo */
  recordFighterDamage(fighter, amount) {
    if (this.format !== 'dojo' || !fighter || fighter.id === 'player') return;
    const dmg = Math.max(1, Math.round(amount));
    this.dojoStats.lastDamage = dmg;
    this.dojoStats.comboDamage += dmg;
    this.dojoStats.comboTimer = 2.5;
    this.hud.updateDojoTelemetry({
      lastDamage: this.dojoStats.lastDamage,
      comboDamage: this.dojoStats.comboDamage,
      status: this._formatFighterStatus(fighter),
    });
  }

  /** Procesa atajos F1/F2/F3/H del Dojo aunque el cursor esté liberado */
  handleDojoHotkeys() {
    if (this.format !== 'dojo' || this.state === 'SELECT' || this.state === 'GAME_OVER') return;
    if (this.input.justPressed('F1')) this.cycleDojoBehavior();
    if (this.input.justPressed('F2')) this.toggleDojoInstantCooldown();
    if (this.input.justPressed('F3')) this.resetDojoPositions();
    if (this.input.justPressed('KeyH') && this.hud && this.hud.toggleDojoPanelCollapsed) {
      this.hud.toggleDojoPanelCollapsed();
    }
  }

  /** Inicia una partida del Modo Supervivencia por Oleadas (PvE) */
  startSurvivalMatch() {
    this._clearDojoFlags();
    this.format = 'survival';
    this.stage = 1;
    const isSanctuary = this.mode === 'sanctuary' && !!this.sanctuaryMap;
    this.setActiveWorld(isSanctuary ? 'sanctuary' : 'classic');
    this.camera.setTarget(this.player, false);
    this.hud.setSpectatingAlly(false);

    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    if (this.arena) this.arena.setEdgeDanger(0);
    this.playerKills = 0;

    this.waveManager.resetRun({
      difficulty: this.difficulty,
      arena: this.arena,
      onDamaged: this.onFighterDamaged,
      onDefeated: (monster, reason) => this._onMonsterDefeated(monster, reason),
    });

    this.player.team = 'team_blue';
    this.combat.setFighterElement(this.player, this.playerElement);
    if (this.player.mesh && this.player.mesh.setTeamRing) this.player.mesh.setTeamRing(null);

    const pSpawn = isSanctuary ? new THREE.Vector3(0, 0, 25) : new THREE.Vector3(0, 0, 14);
    this.player.resetFighter(pSpawn, Math.PI, false);
    this.player.mesh.root.visible = true;
    this.player.combatEnabled = false;

    let allyElem = null;
    this._bot1.fighter.allyRegenAmount = 0;
    this._bot1.fighter._allyRegenTimer = 0;
    if (this.survivalCompanion === 'ally') {
      const pIdx = Math.max(0, ELEMENT_KEYS.indexOf(this.playerElement));
      allyElem = ELEMENT_KEYS[(pIdx + 2) % ELEMENT_KEYS.length];
      this._bot1.fighter.team = 'team_blue';
      this._bot1.fighter.maxHp = 100;
      this.combat.registerFighter(this._bot1.fighter, this._bot1.fighter.elementController);
      this.combat.setFighterElement(this._bot1.fighter, allyElem);
      if (this._bot1.fighter.mesh && this._bot1.fighter.mesh.setTeamRing) {
        this._bot1.fighter.mesh.setTeamRing('ally');
      }
      this._bot1.fighter.resetFighter(new THREE.Vector3(3.6, 0, pSpawn.z), Math.PI, false);
      this._bot1.fighter.mesh.root.visible = true;
      this._bot1.fighter.combatEnabled = false;
      this._bot1.ai.reset();
      this._hideExtraBotsFrom(0);
      this.enemies = [this._bot1];
      this._applyBotDifficulties();
    } else {
      this._hideExtraBotsFrom(0);
      this.combat.removeFighter(this._bot1.fighter);
      this._bot1.fighter.isAlive = false;
      this._bot1.fighter.combatEnabled = false;
      this._bot1.fighter.mesh.root.visible = false;
      this.enemies = [];
    }

    this.waveManager.startWave(1);
    for (const m of this.waveManager.activeMonsters) m.combatEnabled = false;

    this.hud.setMatchupInfo(
      this.playerElement,
      this.playerElement,
      1,
      null,
      isSanctuary ? 'sanctuary' : 'classic',
      'survival',
      allyElem
    );
    this.hud.updateSurvivalStats(1, this.waveManager.remainingInWave, 0);
    this.hud.updateBossBar(this.waveManager.getActiveBoss());
    if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());

    this.camera.yaw = Math.PI;
    this.camera.pitch = (isSanctuary ? 14 : 12) * (Math.PI / 180);
    this.camera.snap();

    this.state = 'COUNTDOWN';
    this.countdownTimer = 2.0;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.winner = null;
    this.reason = null;

    this.hud.showElementSelector(false);
    this.hud.hideGameOver();
    this.hud.setCountdown('¡SUPERVIVENCIA · OLEADA 1!', true);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  _onMonsterDefeated(monster, reason) {
    if (this.format !== 'survival' || this.state === 'GAME_OVER' || this.state === 'SELECT') return;
    if (this.isOnline && this.network.role === 'guest') return;

    const { waveCleared, pointsEarned } = this.waveManager.handleMonsterDefeated(monster, reason);
    const eCfg = getElementConfig(monster.element || 'earth');
    const ringTag = reason === 'RING_OUT' ? ' (Ring-Out +50)' : '';
    this.hud.addKillFeedEntry(
      `+${pointsEarned} pts`,
      `${monster.displayName} ${eCfg.icon}${ringTag}`,
      '#ffd166',
      eCfg.color
    );

    this.hud.updateSurvivalStats(
      this.waveManager.wave,
      this.waveManager.remainingInWave,
      this.waveManager.score
    );
    this.hud.updateBossBar(this.waveManager.getActiveBoss());

    if (waveCleared) {
      if (this.isOnline && this.network.role === 'host') {
        const waveReward = this.waveManager.rewardWaveClear(null);
        this._notifyWaveGold(waveReward);
        for (const rf of this._remoteFighters.values()) {
          if (rf && rf.isAlive) {
            rf.hp = Math.min(rf.maxHp, rf.hp + 25);
            if (rf.mesh && rf.mesh.flash) rf.mesh.flash('#6be6ff');
          }
        }
        this.hud.updateSurvivalStats(this.waveManager.wave, 0, this.waveManager.score);
        this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);

        this.state = 'UPGRADE';
        this.player.combatEnabled = false;
        for (const rf of this._remoteFighters.values()) rf.combatEnabled = false;

        if (document.pointerLockElement && document.exitPointerLock) {
          try {
            document.exitPointerLock();
          } catch {
            // Ignora si no estaba bloqueado
          }
        }

        const deadTeammate = Array.from(this._remoteFighters.values()).find((r) => !r.isAlive) || null;
        const choices = this.waveManager.rollUpgradeChoices(this.waveManager.wave, deadTeammate);
        this._coopPicks.clear();
        this._coopUpgradeTimer = 20;
        this.hud.showUpgradeModal(choices, this.waveManager.wave);
        this.network.broadcastWaveUpgradeOpen({
          wave: this.waveManager.wave,
          choices,
          timeout: 20,
        });
        return;
      }

      const allyFighter = this.survivalCompanion === 'ally' ? this._bot1.fighter : null;
      const waveReward = this.waveManager.rewardWaveClear(allyFighter);
      this._notifyWaveGold(waveReward);
      this.hud.updateSurvivalStats(this.waveManager.wave, 0, this.waveManager.score);
      this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);

      this.state = 'UPGRADE';
      this.player.combatEnabled = false;
      if (allyFighter) allyFighter.combatEnabled = false;

      if (document.pointerLockElement && document.exitPointerLock) {
        try {
          document.exitPointerLock();
        } catch {
          // Ignora si no estaba bloqueado
        }
      }

      const choices = this.waveManager.rollUpgradeChoices(this.waveManager.wave, allyFighter);
      this.hud.showUpgradeModal(choices, this.waveManager.wave);
    }
  }

  /** Aplica la carta de mejora seleccionada e inicia la siguiente oleada */
  selectSurvivalUpgrade(upgradeId) {
    if (this.format !== 'survival' || this.state !== 'UPGRADE') return;
    if (this.isOnline) {
      if (this.network.role === 'guest') {
        if (this._coopUpgradePicked) return;
        this._coopUpgradePicked = true;
        this._applyUpgradeToFighterStats(this.player, upgradeId, this._guestAuraState);
        this.hud.hideUpgradeModal();
        this.hud.setCountdown('Esperando al grupo...', true);
        if (this.sound && this.sound.playUpgradePick) this.sound.playUpgradePick();
        this.network.sendUpgradeSelected({ upgradeId });
      } else if (this.network.role === 'host') {
        this._handleHostCoopUpgradePick(this.network.localId, upgradeId);
      }
      return;
    }

    const allyFighter = this.survivalCompanion === 'ally' ? this._bot1.fighter : null;
    this.waveManager.applyUpgrade(upgradeId, allyFighter);
    if (upgradeId === 'revive_ally' && this._bot1 && this._bot1.ai) {
      this._bot1.ai.reset();
    }
    this.hud.hideUpgradeModal();

    const nextWave = this.waveManager.wave + 1;
    this.waveManager.startWave(nextWave);
    for (const m of this.waveManager.activeMonsters) m.combatEnabled = false;

    this.hud.updateSurvivalStats(nextWave, this.waveManager.remainingInWave, this.waveManager.score);
    this.hud.updateBossBar(this.waveManager.getActiveBoss());
    if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);

    this.state = 'COUNTDOWN';
    this.countdownTimer = 1.4;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.hud.setCountdown(nextWave % 3 === 0 ? `¡OLEADA ${nextWave} · JEFE!` : `¡OLEADA ${nextWave}!`, true);
    this.input.requestLock();
  }

  /** Inicia una Batalla por Equipos 2v2 (Jugador + Aliado IA vs 2 Rivales IA) */
  startTeamsMatch() {
    this._clearDojoFlags();
    this.format = 'teams';
    this.stage = 1;
    this.botCount = 3;
    const isSanctuary = this.mode === 'sanctuary' && !!this.sanctuaryMap;
    this.setActiveWorld(isSanctuary ? 'sanctuary' : 'classic');
    this.camera.setTarget(this.player, false);
    this.hud.setSpectatingAlly(false);

    const { allyElem, redElems } = this._configureTeamsRoster();
    this._applyBotDifficulties();

    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    if (this.arena) this.arena.setEdgeDanger(0);
    this.playerKills = 0;

    this._placeTeamsSpawns(isSanctuary);

    this.hud.setMatchupInfo(
      this.playerElement,
      redElems[0],
      1,
      redElems,
      isSanctuary ? 'sanctuary' : 'classic',
      'teams',
      allyElem
    );
    this.hud.updateTeamStats(2, 2);

    this.state = 'COUNTDOWN';
    this.countdownTimer = 2.0;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.winner = null;
    this.reason = null;

    this.player.combatEnabled = false;

    this.hud.showElementSelector(false);
    this.hud.hideGameOver();
    this.hud.setCountdown('¡EQUIPOS 2v2!', true);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  /** Inicia una Batalla Campal abierta en el Santuario Elemental con 1 a 6 bots */
  startSanctuaryMatch() {
    this._clearDojoFlags();
    this.format = 'ffa';
    this.mode = 'sanctuary';
    this.stage = 1;
    this.setActiveWorld('sanctuary');
    this.camera.setTarget(this.player, false);
    this.hud.setSpectatingAlly(false);

    const count = Math.max(1, Math.min(6, this.botCount || 3));
    const elems = this._configureSanctuaryRoster(count);
    this._assignTeamRoles('ffa');
    this._applyBotDifficulties();

    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    this.arena.setEdgeDanger(0);
    this.playerKills = 0;

    const spawns = this.arena.getSpawnPoints(1 + count);
    const pSpawn = spawns[0];
    const pYaw = Math.atan2(-pSpawn.x, -pSpawn.z);
    this.player.resetFighter(pSpawn, pYaw, false);
    this.player.mesh.root.visible = true;

    for (let i = 0; i < this.enemies.length; i++) {
      const sp = spawns[i + 1] || spawns[0];
      const bYaw = Math.atan2(-sp.x, -sp.z);
      const entry = this.enemies[i];
      entry.fighter.resetFighter(sp, bYaw, false);
      entry.fighter.mesh.root.visible = true;
      entry.fighter.combatEnabled = false;
      entry.ai.reset();
    }

    this.hud.setMatchupInfo(this.playerElement, elems[0], 1, elems, 'sanctuary', 'ffa');
    this.hud.updateBattleRoyaleStats(1 + this.enemies.length, 1 + this.enemies.length, 0);

    this.camera.yaw = pYaw;
    this.camera.pitch = 14 * (Math.PI / 180);
    this.camera.snap();

    this.state = 'COUNTDOWN';
    this.countdownTimer = 2.0;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.winner = null;
    this.reason = null;

    this.player.combatEnabled = false;

    this.hud.showElementSelector(false);
    this.hud.hideGameOver();
    this.hud.setCountdown('¡SANTUARIO ELEMENTAL!', true);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  /** Inicia o reinicia la etapa indicada (`1` = Duelo, `2` = Batalla Campal) en Arena Clásica */
  startStage(stageNum = 1) {
    this._clearDojoFlags();
    this.format = 'ffa';
    this.mode = 'classic';
    this.setActiveWorld('classic');
    this.camera.setTarget(this.player, false);
    this.hud.setSpectatingAlly(false);
    this._configureStageRoster(stageNum);
    this._assignTeamRoles('ffa');
    this._applyBotDifficulties();
    this.combat.clearAll();
    if (this.arena.resetDestructibles) this.arena.resetDestructibles();
    this.hud.clearDamageNumbers();
    this.hud.clearKillFeed();
    this.hud.setRingOutDanger(false);
    if (this.arena) this.arena.setEdgeDanger(0);

    if (stageNum === 2) {
      // Jugador con 100 HP restaurados y 2 bots en extremos opuestos de la arena ampliada
      this.player.resetFighter(PLAYER_SPAWN_S2, Math.PI, false);
      this.player.mesh.root.visible = true;

      const yaw1 = Math.atan2(-BOT1_SPAWN_S2.x, -BOT1_SPAWN_S2.z);
      const yaw2 = Math.atan2(-BOT2_SPAWN_S2.x, -BOT2_SPAWN_S2.z);
      const bot2 = this._extraBots[0];
      this._bot1.fighter.resetFighter(BOT1_SPAWN_S2, yaw1, false);
      this._bot1.fighter.mesh.root.visible = true;
      this._bot1.fighter.combatEnabled = false;
      this._bot1.ai.reset();

      bot2.fighter.resetFighter(BOT2_SPAWN_S2, yaw2, false);
      bot2.fighter.mesh.root.visible = true;
      bot2.fighter.combatEnabled = false;
      bot2.ai.reset();
    } else {
      this.player.resetFighter(PLAYER_SPAWN_S1, Math.PI, false);
      this.player.mesh.root.visible = true;
      this._bot1.fighter.resetFighter(ENEMY_SPAWN_S1, 0, false);
      this._bot1.fighter.mesh.root.visible = true;
      this._bot1.fighter.combatEnabled = false;
      this._bot1.ai.reset();
    }

    const eList = stageNum === 2 ? [this.enemyElement, this.bot2Element] : [this.enemyElement];
    this.hud.setMatchupInfo(this.playerElement, this.enemyElement, stageNum, eList, 'classic', 'ffa');

    this.camera.yaw = Math.PI;
    this.camera.pitch = 12 * (Math.PI / 180);
    this.camera.snap();

    this.state = 'COUNTDOWN';
    this.countdownTimer = 2.0;
    this._fightBannerTimer = 0;
    this._playedReadyTone = false;
    this._playedGoTone = false;
    this.winner = null;
    this.reason = null;

    this.player.combatEnabled = false;

    this.hud.showElementSelector(false);
    this.hud.hideGameOver();
    this.hud.setCountdown(stageNum === 2 ? '¡BATALLA CAMPAL!' : '¡PREPARADOS...!', true);
    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, true);
  }

  /** Alias de compatibilidad para reiniciar la etapa actual */
  resetMatch() {
    this.startStage(this.stage);
  }

  /** Actualiza IA y físicas de todos los bots y monstruos activos */
  updateCombatants(dt) {
    for (const entry of this.enemies) {
      entry.ai.update(dt);
      entry.fighter.update(dt);
    }
    if (this.format === 'survival') {
      if (this.isOnline && this.network.role === 'guest') {
        for (const m of this._remoteMonsters.values()) {
          m.update(dt);
        }
        return;
      }
      if (this.waveManager) {
        this.waveManager.update(dt);
        this.hud.updateSurvivalStats(
          this.waveManager.wave,
          this.waveManager.remainingInWave,
          this.waveManager.score
        );
        this.hud.updateBossBar(this.waveManager.getActiveBoss());
        if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());
      }
    }
  }

  _onFighterDefeated(defeatedFighter, reason) {
    if (this.state === 'GAME_OVER' || this.state === 'SELECT') return;

    if (this.isOnline) {
      if (this.network.role === 'guest') return;

      defeatedFighter.combatEnabled = false;
      if (defeatedFighter.mesh && defeatedFighter.mesh.root) {
        defeatedFighter.mesh.root.visible = false;
      }

      const attacker = defeatedFighter.lastAttackerId
        ? this.combat.fighters.find((f) => f && f.id === defeatedFighter.lastAttackerId)
        : null;
      if (attacker && attacker.id === 'player' && defeatedFighter !== this.player) {
        this.playerKills += 1;
      }

      const vCfg = getElementConfig(defeatedFighter.element || 'earth');
      const vLabel = defeatedFighter === this.player ? 'TÚ (Host)' : (defeatedFighter.displayName || vCfg.name);
      const kLabel = attacker
        ? (attacker === this.player ? `${getElementConfig(attacker.element).icon} TÚ` : (attacker.displayName || 'Rival'))
        : (this.format === 'survival' ? 'Horda' : 'Arena');
      this.hud.addKillFeedEntry(kLabel, vLabel, '#ffd166', vCfg.color);

      if (this.format === 'survival') {
        const humans = [this.player, ...this._remoteFighters.values()];
        const aliveHumans = humans.filter((f) => f && f.isAlive);
        this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);
        if (aliveHumans.length === 0) {
          const rec = this.waveManager.saveRecordIfBeaten();
          if (this.hud.setSurvivalRecord) this.hud.setSurvivalRecord(rec);
          this._survivalEndInfo = {
            wave: this.waveManager.wave,
            kills: this.waveManager.kills,
            score: this.waveManager.score,
            isNewRecord: rec.isNewRecord,
            highScore: rec.highScore,
          };
          const title = 'FIN DE LA SUPERVIVENCIA COOP';
          const subtitle = `Oleada alcanzada: ${this.waveManager.wave} · Monstruos eliminados: ${this.waveManager.kills} · Puntuación: ${this.waveManager.score} pts`;
          this.network.broadcastMatchOver({
            victory: false,
            winnerId: null,
            title,
            subtitle,
            mode: 'survival_end',
          });
          this._finishMatch('enemy', reason, 'survival_end', 1);
          return;
        }
        if (defeatedFighter === this.player && aliveHumans.length > 0) {
          this.camera.setTarget(aliveHumans[0], true);
          this.hud.setSpectatingAlly(true, aliveHumans[0]);
        }
        return;
      }

      if (this.format === 'teams') {
        const all = [this.player, ...this.enemies.map((e) => e.fighter)].filter(Boolean);
        const blueAlive = all.filter((f) => f.isAlive && f.team === 'team_blue');
        const redAlive = all.filter((f) => f.isAlive && f.team === 'team_red');
        this.hud.updateTeamStats(blueAlive.length, redAlive.length);
        this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);

        if (redAlive.length === 0 || blueAlive.length === 0) {
          const winnerTeam = redAlive.length === 0 ? 'team_blue' : 'team_red';
          const hostWon = this.player.team === winnerTeam;
          const title = winnerTeam === 'team_blue' ? '¡VICTORIA DEL EQUIPO AZUL (2v2)!' : '¡VICTORIA DEL EQUIPO ROJO (2v2)!';
          const subtitle = `Fin del duelo online 2v2 · Resultado oficial del Host`;
          for (const rf of this._remoteFighters.values()) {
            // El Guest evalúa victory según si winnerTeam coincide con su equipo
          }
          this.network.broadcastMatchOver({
            victory: false,
            winnerTeam,
            title,
            subtitle,
            mode: winnerTeam === 'team_blue' ? 'teams_win' : 'teams_loss',
          });
          this._finishMatch(hostWon ? 'player' : 'enemy', reason, winnerTeam === 'team_blue' ? 'teams_win' : 'teams_loss', hostWon ? 1 : 2);
          return;
        }
        if (defeatedFighter === this.player) {
          const sameTeam = all.filter((f) => f.isAlive && f.team === this.player.team);
          if (sameTeam.length > 0) {
            this.camera.setTarget(sameTeam[0], true);
            this.hud.setSpectatingAlly(true, sameTeam[0]);
          }
        }
        if (this.sound) this.sound.playHit(1.0);
        return;
      }

      // Online Todos contra Todos (FFA)
      const allHumans = [this.player, ...this._remoteFighters.values()];
      const alive = allHumans.filter((f) => f && f.isAlive);
      this._syncOnlineHudBars();
      this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);
      if (alive.length <= 1) {
        const winner = alive[0] || attacker || this.player;
        const winnerId = winner === this.player ? this.network.localId : winner.id;
        const winnerName = winner === this.player ? (this.network.localProfile.name || 'Host') : (winner.displayName || 'Jugador');
        const hostWon = winner === this.player;
        const title = `🏆 ¡${winnerName.toUpperCase()} GANA EL COMBATE!`;
        const subtitle = `Todos contra Todos Online · ${reason === 'RING_OUT' ? 'Ring-Out decisivo' : 'Victoria por K.O.'}`;
        this.network.broadcastMatchOver({
          victory: false,
          winnerId,
          title,
          subtitle,
          mode: 'online_ffa',
        });
        this._finishMatch(hostWon ? 'player' : 'enemy', reason, hostWon ? 'champion' : 'defeat', hostWon ? 1 : 2);
      }
      return;
    }

    if (this.format === 'survival') {
      if (defeatedFighter.id === 'player') {
        const rec = this.waveManager.saveRecordIfBeaten();
        if (this.hud.setSurvivalRecord) this.hud.setSurvivalRecord(rec);
        this._survivalEndInfo = {
          wave: this.waveManager.wave,
          kills: this.waveManager.kills,
          score: this.waveManager.score,
          isNewRecord: rec.isNewRecord,
          highScore: rec.highScore,
        };
        this._finishMatch('enemy', reason, 'survival_end', 1);
        return;
      }
      // En Supervivencia con aliado: si cae el aliado, se oculta y marca ELIMINADO
      defeatedFighter.combatEnabled = false;
      if (defeatedFighter.mesh && defeatedFighter.mesh.root) {
        defeatedFighter.mesh.root.visible = false;
      }
      this.hud.addKillFeedEntry('Horda', '🛡️ Aliado IA', '#ff4757', '#6be6ff');
      this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);
      return;
    }

    // Registrar autor de la baja y mostrar kill-feed en Batalla Campal / Santuario / 2v2
    const attacker = defeatedFighter.lastAttackerId
      ? this.combat.fighters.find((f) => f && f.id === defeatedFighter.lastAttackerId)
      : null;

    if (attacker && attacker.id === 'player' && defeatedFighter.id !== 'player') {
      this.playerKills += 1;
    }

    if (this.format === 'teams' || this.mode === 'sanctuary' || this.stage === 2) {
      const vCfg = getElementConfig(defeatedFighter.element || 'earth');
      const vIsAlly = this.format === 'teams' && defeatedFighter.team === 'team_blue' && defeatedFighter.id !== 'player';
      const victimLabel =
        defeatedFighter.id === 'player' ? 'TÚ' : vIsAlly ? `🛡️ Aliado (${vCfg.name})` : `Maestro ${vCfg.name}`;
      let killerLabel = this.mode === 'sanctuary' ? 'Santuario' : 'Arena';
      let killerColor = '#d6c8ad';
      if (attacker) {
        const kCfg = getElementConfig(attacker.element || 'earth');
        const kIsAlly = this.format === 'teams' && attacker.team === 'team_blue' && attacker.id !== 'player';
        killerLabel =
          attacker.id === 'player'
            ? `${kCfg.icon} TÚ`
            : kIsAlly
              ? `🛡️ Aliado (${kCfg.name})`
              : `${kCfg.icon} Maestro ${kCfg.name}`;
        killerColor = kIsAlly ? '#4ce6ff' : kCfg.color;
      }
      this.hud.addKillFeedEntry(killerLabel, victimLabel, killerColor, vIsAlly ? '#6be6ff' : vCfg.color);
    }

    if (this.format === 'teams') {
      defeatedFighter.combatEnabled = false;
      if (defeatedFighter.mesh && defeatedFighter.mesh.root) {
        defeatedFighter.mesh.root.visible = false;
      }

      const blueAlive = [this.player, ...this.enemies.map((e) => e.fighter)].filter(
        (f) => f && f.isAlive && f.team === 'team_blue'
      );
      const redAlive = this.enemies
        .map((e) => e.fighter)
        .filter((f) => f && f.isAlive && f.team === 'team_red');

      this.hud.updateTeamStats(blueAlive.length, redAlive.length);
      this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, 0);

      if (redAlive.length === 0) {
        this._finishMatch('player', reason, 'teams_win', 1);
        return;
      }
      if (blueAlive.length === 0) {
        this._finishMatch('enemy', reason, 'teams_loss', 2);
        return;
      }

      // Si cae el Jugador mientras el Aliado IA sigue peleando -> Cámara espectador sobre el aliado
      if (defeatedFighter.id === 'player' && blueAlive.length > 0) {
        this.camera.setTarget(blueAlive[0], true);
        this.hud.setSpectatingAlly(true, blueAlive[0]);
      }
      if (this.sound) this.sound.playHit(1.0);
      return;
    }

    const aliveBots = this.enemies.filter((e) => e.fighter.isAlive);
    if (this.mode === 'sanctuary') {
      const aliveTotal = (this.player.isAlive ? 1 : 0) + aliveBots.length;
      this.hud.updateBattleRoyaleStats(aliveTotal, 1 + this.enemies.length, this.playerKills);
    }

    if (defeatedFighter.id === 'player') {
      const placement = aliveBots.length + 1;
      this._finishMatch('enemy', reason, this.mode === 'sanctuary' ? 'sanctuary_end' : 'defeat', placement);
      return;
    }

    // Oculta al bot eliminado
    defeatedFighter.combatEnabled = false;
    if (defeatedFighter.mesh && defeatedFighter.mesh.root) {
      defeatedFighter.mesh.root.visible = false;
    }

    if (aliveBots.length > 0) {
      // Aún quedan rivales activos: la batalla continúa
      if (this.sound) this.sound.playHit(1.0);
      return;
    }

    if (this.mode === 'sanctuary') {
      this._finishMatch('player', reason, 'sanctuary_end', 1);
      return;
    }

    const mode = this.stage === 1 ? 'stage1_clear' : 'champion';
    this._finishMatch('player', reason, mode, 1);
  }

  _notifyWaveGold(waveReward) {
    if (!waveReward || !waveReward.goldReward) return;
    this._survivalRunGold += waveReward.goldReward;
    if (this.sound && this.sound.playCoinReward) this.sound.playCoinReward();
    if (this.hud && this.hud.showGoldToast) {
      this.hud.showGoldToast(
        waveReward.goldReward,
        waveReward.isBossWave ? 'Coloso derrotado' : 'Oleada completada'
      );
    }
  }

  _awardMatchEndGold(didWin, mode = '') {
    if (this._matchGoldAwarded) return 0;
    this._matchGoldAwarded = true;
    if (this.format === 'dojo' || this.format === 'survival' || mode === 'survival_end') {
      return 0;
    }
    const reward = didWin ? 50 : 10;
    this.economy.addGold(reward);
    if (this.sound && this.sound.playCoinReward) this.sound.playCoinReward();
    return reward;
  }

  _finishMatch(winner, reason, mode, placement = 1) {
    this.state = 'GAME_OVER';
    this.reason = reason;
    this.winner = winner;

    this.player.combatEnabled = false;
    for (const entry of this.enemies) {
      entry.fighter.combatEnabled = false;
    }
    this.hud.setCountdown('', false);
    this.hud.setRingOutDanger(false);
    this.hud.setSpectatingAlly(false);
    if (this.arena) this.arena.setEdgeDanger(0);

    if (this.sound) {
      this.sound.playMatchEnd(winner === 'player');
    }

    if (document.pointerLockElement && document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignora errores si el documento no tenía lock real
      }
    }

    const enemyCfg = getElementConfig(this.enemyElement);
    let title = 'DERROTA';
    let subtitle = reason === 'RING_OUT'
      ? 'Caíste fuera de la arena sin vida restante'
      : 'Has sido derrotado por K.O.';

    if (mode === 'survival_end') {
      const info = this._survivalEndInfo || { wave: 1, kills: 0, score: 0, isNewRecord: false, highScore: 0 };
      title = info.isNewRecord ? '🏆 ¡NUEVO RÉCORD EN SUPERVIVENCIA!' : 'FIN DE LA SUPERVIVENCIA';
      subtitle = `Oleada alcanzada: ${info.wave} · Monstruos eliminados: ${info.kills} · Puntuación: ${info.score} pts${info.isNewRecord ? '' : ` (Récord: ${info.highScore} pts)`}`;
    } else if (mode === 'teams_win') {
      title = '¡VICTORIA DEL EQUIPO AZUL (2v2)!';
      subtitle = `Tú y tu Aliado IA vencieron al Equipo Rojo · Bajas personales: ${this.playerKills}`;
    } else if (mode === 'teams_loss') {
      title = 'DERROTA DEL EQUIPO AZUL';
      subtitle = `El Equipo Rojo eliminó a ambos maestros azules · Bajas personales: ${this.playerKills}`;
    } else if (mode === 'sanctuary_end') {
      if (winner === 'player') {
        title = '¡1.º LUGAR — CAMPEÓN DEL SANTUARIO!';
        subtitle = `Eliminaciones conseguidas: ${this.playerKills} · Venciste a ${this.botCount} ${this.botCount === 1 ? 'maestro rival' : 'maestros rivales'}`;
      } else {
        title = `PUESTO #${placement}`;
        subtitle = `Eliminaciones conseguidas: ${this.playerKills} · Fuiste derrotado en el Santuario de las Cuatro Naciones`;
      }
    } else if (mode === 'stage1_clear') {
      title = '¡ETAPA 1 FINALIZADA!';
      subtitle = reason === 'RING_OUT'
        ? `Expulsaste al ${enemyCfg.title} rival · ¿Listo para 2 rivales a la vez?`
        : `Venciste al ${enemyCfg.title} rival · Prepárate para la Batalla Campal`;
    } else if (mode === 'champion') {
      title = '¡CAMPEÓN DE LA ARENA!';
      subtitle = '¡BATALLA CAMPAL COMPLETADA! Venciste a ambos maestros elementales';
    }

    const goldReward = this._awardMatchEndGold(winner === 'player', mode);
    this.hud.showGameOver({
      victory: winner === 'player',
      title,
      subtitle,
      mode,
      isOnline: this.isOnline,
      isHost: this.isOnline && this.network && this.network.role === 'host',
      goldReward,
      totalGold: this.economy.getGold(),
    });
  }

  update(dt) {
    if (this.state === 'SELECT') {
      return;
    }

    if (this.state === 'GAME_OVER') {
      if (this.isOnline) return;
      if (this.input.justPressed('KeyR')) {
        if (this.hud.onReplayStage) this.hud.onReplayStage();
        return;
      }
      if (this.input.justPressed('KeyC')) {
        this.openElementSelector(1);
        return;
      }
    }

    if (this.state === 'UPGRADE') {
      if (this.isOnline && this.network.role === 'host') {
        this._coopUpgradeTimer = Math.max(0, (this._coopUpgradeTimer || 0) - dt);
        if (this._coopUpgradeTimer <= 0) {
          this._hostAdvanceCoopWave();
          return;
        }
      }
      const choices = (this.isOnline && this.network.role === 'guest')
        ? (this._coopWaveChoices || [])
        : (this.waveManager ? this.waveManager.currentChoices : []);
      for (let idx = 0; idx < 5; idx++) {
        if ((this.input.justPressed(`Digit${idx + 1}`) || this.input.justPressed(`Numpad${idx + 1}`)) && choices[idx]) {
          this.selectSurvivalUpgrade(choices[idx].id);
          break;
        }
      }
      return;
    }

    if (this.state === 'COUNTDOWN') {
      if (!this._playedReadyTone && this.sound && this.sound.ctx) {
        this._playedReadyTone = true;
        this.sound.playCountdown(false);
      }
      this.countdownTimer -= dt;
      if (this.countdownTimer > 0.7) {
        const bannerText = this.format === 'survival'
          ? `¡OLEADA ${this.waveManager ? this.waveManager.wave : 1}!`
          : this.format === 'teams'
            ? '¡EQUIPOS 2v2!'
            : this.mode === 'sanctuary'
              ? '¡SANTUARIO ELEMENTAL!'
              : this.stage === 2
                ? '¡BATALLA CAMPAL!'
                : '¡PREPARADOS...!';
        this.hud.setCountdown(bannerText, true);
      } else if (this.countdownTimer > 0) {
        if (!this._playedGoTone) {
          this._playedGoTone = true;
          if (this.sound) this.sound.playCountdown(true);
        }
        this.hud.setCountdown('¡A LUCHAR!', true);
      } else {
        this.state = 'FIGHTING';
        this.player.combatEnabled = this.player.isAlive;
        for (const entry of this.enemies) {
          entry.fighter.combatEnabled = entry.fighter.isAlive;
        }
        if (this.format === 'survival' && this.waveManager && (!this.isOnline || this.network.role === 'host')) {
          for (const m of this.waveManager.activeMonsters) {
            m.combatEnabled = true;
          }
        }
        this._fightBannerTimer = 0.45;
        this.hud.setCountdown('¡A LUCHAR!', true);
        if (!this.input.isLocked) {
          this.hud.setLocked(false);
        }
      }
    } else if (this.state === 'FIGHTING') {
      if (this.format === 'survival' && this.input.justPressed('KeyR')) {
        if (this.isOnline && this.network.role === 'guest') {
          const ga = this._guestAuraState;
          if (ga && ga.unlocked && !ga.active && (ga.cooldownRemaining || 0) <= 0 && this.player.isAlive && !this.player.isFrozen) {
            this.network.sendAbilityCast({
              slot: 'aura',
              origin: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
              aimPoint: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
              yaw: this.player.yaw,
            });
          }
        } else if (this.waveManager && this.waveManager.activateAura()) {
          if (this.hud.pulseCrosshair) this.hud.pulseCrosshair('aura_r');
          if (this.hud.setSurvivalAura) this.hud.setSurvivalAura(this.waveManager.getAuraHudState());
          if (this.isOnline && this.network.role === 'host') {
            this.network.broadcastAbilityCast({
              senderId: this.network.localId,
              slot: 'aura',
              origin: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
              aimPoint: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
              yaw: this.player.yaw,
            }, null);
          }
        }
      }
      if (this.isOnline && this.network.role === 'host' && this.format === 'survival') {
        this._updateGuestAurasTick(dt);
        for (const rf of this._remoteFighters.values()) {
          if (!rf || !rf.isAlive) continue;
          const regen = rf.survivalMods ? (rf.survivalMods.hpRegen || 0) : 0;
          if (regen > 0) rf.hp = Math.min(rf.maxHp, rf.hp + regen * dt);
        }
      }
      if (this._fightBannerTimer > 0) {
        this._fightBannerTimer -= dt;
        if (this._fightBannerTimer <= 0) {
          this.hud.setCountdown('', false);
        }
      }
      if (this.format === 'dojo') {
        if (this.dojoStats.comboTimer > 0) {
          this.dojoStats.comboTimer = Math.max(0, this.dojoStats.comboTimer - dt);
          if (this.dojoStats.comboTimer <= 0) {
            this.dojoStats.comboDamage = 0;
          }
        }
        const bot = this._bot1.fighter;
        this.hud.updateDojoTelemetry({
          lastDamage: this.dojoStats.lastDamage,
          comboDamage: this.dojoStats.comboDamage,
          status: this._formatFighterStatus(bot),
        });
      }
      this._updateRingOutDanger();
    }

    this.hud.updateMultiHealthBars(this.player.hp, this.player.maxHp, this.enemies, false, dt);

    if (this.isOnline && (this.state === 'COUNTDOWN' || this.state === 'FIGHTING')) {
      if (this.network.role === 'guest') {
        this.network.tickGuestInput(dt, () => {
          const payload = this._serializeFighterState(this.player, this.network.localId, this.network.localProfile.name);
          if (this._pendingAbyssFall) {
            payload.abyssFall = true;
            this._pendingAbyssFall = false;
          }
          return payload;
        });
      } else if (this.network.role === 'host') {
        this.network.tickHostSnapshot(dt, () => {
          const hostAura = this.format === 'survival' && this.waveManager ? this.waveManager.getAuraHudState() : null;
          const fighters = [this._serializeFighterState(this.player, this.network.localId, this.network.localProfile.name, hostAura)];
          for (const rf of this._remoteFighters.values()) {
            const gAura = this.format === 'survival' ? this._guestAuras.get(rf.id) : null;
            const gHudAura = gAura ? {
              active: gAura.activeTimer > 0,
              activeRemaining: gAura.activeTimer,
              cooldownRemaining: gAura.cooldownTimer,
            } : null;
            fighters.push(this._serializeFighterState(rf, rf.id, rf.displayName, gHudAura));
          }
          if (this.format === 'teams') {
            for (const entry of this.enemies) {
              if (!entry || !entry.fighter || this._remoteFighters.has(entry.fighter.id)) continue;
              const bf = entry.fighter;
              const s = this._serializeFighterState(bf, bf.id, bf.displayName || 'Maestro IA');
              s.isBot = true;
              fighters.push(s);
            }
          }
          const snap = { fighters };
          if (this.format === 'survival' && this.waveManager) {
            snap.monsters = this.waveManager.activeMonsters
              .filter((m) => m && m.isAlive)
              .map((m) => m.serializeNetworkState());
            snap.waveInfo = {
              wave: this.waveManager.wave,
              remaining: this.waveManager.remainingInWave,
              score: this.waveManager.score,
            };
          }
          return snap;
        });
      }
    }
  }

  _updateRingOutDanger() {
    if (!this.arena || this.arena.hasAbyss === false) {
      this.hud.setRingOutDanger(false);
      if (this.arena) this.arena.setEdgeDanger(0);
      return;
    }

    const arenaR = this.arena.getBoundsRadius ? this.arena.getBoundsRadius() : 30;
    const warnR = arenaR - 4.5; // 25.5 u para radio 30
    const pRadius = Math.hypot(this.player.position.x, this.player.position.z);

    const playerInDanger =
      this.player.isAlive && pRadius > warnR && this.player.hp < this.player.maxHp * 0.55;

    let maxDanger = playerInDanger ? THREE.MathUtils.clamp((pRadius - warnR) / 4.0, 0.5, 1) : 0;
    for (const entry of this.enemies) {
      const f = entry.fighter;
      if (!f.isAlive) continue;
      const eR = Math.hypot(f.position.x, f.position.z);
      if (eR > warnR && f.hp < f.maxHp * 0.55) {
        maxDanger = Math.max(maxDanger, THREE.MathUtils.clamp((eR - warnR) / 4.0, 0.5, 1));
      }
    }

    this.hud.setRingOutDanger(playerInDanger);
    if (this.arena) {
      this.arena.setEdgeDanger(maxDanger);
    }
  }
}
