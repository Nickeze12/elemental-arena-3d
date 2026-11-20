import Peer from 'peerjs';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const PEER_PREFIX = 'elem-';
const MAX_ROOM_PLAYERS = 4;
const SEND_INTERVAL = 1 / 25; // 25 Hz

/**
 * NetworkManager
 * ------------------------------------------------------------
 * Capa de red P2P con PeerJS bajo arquitectura Host-Authoritativo.
 *  - Roles: 'offline' | 'host' | 'guest'
 *  - Sala identificada por código corto de 4 dígitos (`elem-XXXX`)
 *  - Soporta hasta 4 jugadores sincronizados a 25 Hz (inputs -> Host -> snapshot).
 */
export class NetworkManager {
  constructor() {
    this.role = 'offline'; // 'offline' | 'host' | 'guest'
    this.status = 'idle'; // 'idle' | 'connecting' | 'open' | 'connected' | 'error'
    this.roomCode = '';
    this.localId = '';
    this.localProfile = {
      name: 'Maestro',
      element: 'earth',
      ready: false,
    };

    this.settings = {
      mode: 'classic',
      format: 'ffa',
    };

    /** Lista ordenada de jugadores en sala: { id, name, element, isHost, ready } */
    this.players = [];

    this._peer = null;
    /** Host: mapa peerId -> DataConnection */
    this._guestConns = new Map();
    /** Guest: conexión única hacia el Host */
    this._hostConn = null;

    this._inputAccum = 0;
    this._snapshotAccum = 0;
    this._seq = 0;
    this._lastImmediateSig = '';

    // Callbacks externos
    this.onStatusChange = null;
    this.onLobbySync = null;
    this.onStartMatch = null;
    this.onRemoteInputState = null;
    this.onWorldSnapshot = null;
    this.onPeerDisconnected = null;
    this.onAbilityCast = null;
    this.onCombatEvent = null;
    this.onBarrelDestroyed = null;
    this.onWaveUpgradeOpen = null;
    this.onUpgradeSelected = null;
    this.onStartNextWave = null;
    this.onMatchOver = null;
    this.onReturnToLobby = null;
  }

  get isOnline() {
    return this.role !== 'offline';
  }

  _setStatus(status, message = '') {
    this.status = status;
    if (this.onStatusChange) {
      this.onStatusChange(status, message);
    }
  }

  _generateRoomCode() {
    return String(1000 + Math.floor(Math.random() * 9000));
  }

  /** Desconecta por completo y vuelve a modo `'offline'` */
  disconnect(reasonMsg = '') {
    for (const conn of this._guestConns.values()) {
      try {
        conn.close();
      } catch {
        // Ignorar errores al cerrar
      }
    }
    this._guestConns.clear();

    if (this._hostConn) {
      try {
        this._hostConn.close();
      } catch {
        // Ignorar
      }
      this._hostConn = null;
    }

    if (this._peer) {
      try {
        this._peer.destroy();
      } catch {
        // Ignorar
      }
      this._peer = null;
    }

    this.role = 'offline';
    this.roomCode = '';
    this.localId = '';
    this.players = [];
    this._inputAccum = 0;
    this._snapshotAccum = 0;
    this._seq = 0;
    this._setStatus('idle', reasonMsg);
  }

  /**
   * Crea una sala Host-Authoritativa con código corto `elem-XXXX`.
   * Reintenta otro código si el ID ya estuviera ocupado en PeerJS.
   */
  createRoom({ name = 'Maestro', element = 'earth', mode = 'classic', format = 'ffa' } = {}, retriesLeft = 4) {
    this.disconnect();
    this.role = 'host';
    this.localProfile = {
      name: String(name || 'Maestro').trim().slice(0, 16) || 'Maestro',
      element: element || 'earth',
      ready: true,
    };
    this.settings = {
      mode: mode || 'classic',
      format: format || 'ffa',
    };

    const code = this._generateRoomCode();
    this.roomCode = code;
    this._setStatus('connecting', `Creando sala ${code}...`);

    const peer = new Peer(`${PEER_PREFIX}${code}`, {
      config: { iceServers: ICE_SERVERS },
    });
    this._peer = peer;

    peer.on('open', (id) => {
      if (this._peer !== peer) return;
      this.localId = id;
      this.players = [
        {
          id,
          name: this.localProfile.name,
          element: this.localProfile.element,
          isHost: true,
          ready: true,
        },
      ];
      this._setStatus('open', `Sala ${code} abierta`);
      this._emitLobbySync();
    });

    peer.on('connection', (conn) => {
      if (this._peer !== peer || this.role !== 'host') return;
      this._handleIncomingGuest(conn);
    });

    peer.on('error', (err) => {
      if (this._peer !== peer) return;
      if (err && err.type === 'unavailable-id' && retriesLeft > 0) {
        this.createRoom({ name: this.localProfile.name, element: this.localProfile.element, ...this.settings }, retriesLeft - 1);
        return;
      }
      this._setStatus('error', `Error de red: ${err?.message || err?.type || 'conexión fallida'}`);
    });
  }

  _handleIncomingGuest(conn) {
    conn.on('open', () => {
      if (this.players.length >= MAX_ROOM_PLAYERS) {
        try {
          conn.send({ type: 'ROOM_ERROR', message: 'La sala está llena (máx. 4 jugadores).' });
        } catch {
          // Ignorar
        }
        setTimeout(() => conn.close(), 120);
        return;
      }

      this._guestConns.set(conn.peer, conn);
      const existing = this.players.find((p) => p.id === conn.peer);
      if (!existing) {
        this.players.push({
          id: conn.peer,
          name: `Invitado ${this.players.length}`,
          element: 'fire',
          isHost: false,
          ready: false,
        });
      }
      this._broadcastLobbySync();
    });

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'JOIN_PROFILE' || msg.type === 'LOBBY_PROFILE_UPDATE') {
        const p = this.players.find((item) => item.id === conn.peer);
        if (p && msg.profile) {
          if (msg.profile.name) p.name = String(msg.profile.name).trim().slice(0, 16) || p.name;
          if (msg.profile.element) p.element = msg.profile.element;
          if (typeof msg.profile.ready === 'boolean') p.ready = msg.profile.ready;
          this._broadcastLobbySync();
        }
      } else if (msg.type === 'PLAYER_INPUT_STATE') {
        if (this.onRemoteInputState) {
          this.onRemoteInputState({ ...msg, id: conn.peer });
        }
      } else if (msg.type === 'ABILITY_CAST') {
        if (this.onAbilityCast) {
          this.onAbilityCast({ ...msg, senderId: conn.peer });
        }
      } else if (msg.type === 'UPGRADE_SELECTED') {
        if (this.onUpgradeSelected) {
          this.onUpgradeSelected({ ...msg, playerId: conn.peer });
        }
      }
    });

    const onLeave = () => {
      if (!this._guestConns.has(conn.peer)) return;
      this._guestConns.delete(conn.peer);
      this.players = this.players.filter((p) => p.id !== conn.peer);
      this._broadcastLobbySync();
      if (this.onPeerDisconnected) {
        this.onPeerDisconnected(conn.peer);
      }
    };

    conn.on('close', onLeave);
    conn.on('error', onLeave);
  }

  /** Une a un Guest a la sala `elem-${code}` del Host */
  joinRoom(code, { name = 'Maestro', element = 'fire' } = {}) {
    const cleanCode = String(code || '').replace(/\D/g, '').slice(0, 4);
    if (cleanCode.length !== 4) {
      this._setStatus('error', 'Ingresa un código numérico de 4 dígitos.');
      return;
    }

    this.disconnect();
    this.role = 'guest';
    this.roomCode = cleanCode;
    this.localProfile = {
      name: String(name || 'Maestro').trim().slice(0, 16) || 'Maestro',
      element: element || 'fire',
      ready: false,
    };
    this._setStatus('connecting', `Conectando a sala ${cleanCode}...`);

    const peer = new Peer(undefined, {
      config: { iceServers: ICE_SERVERS },
    });
    this._peer = peer;

    peer.on('open', (id) => {
      if (this._peer !== peer) return;
      this.localId = id;
      const conn = peer.connect(`${PEER_PREFIX}${cleanCode}`, {
        serialization: 'json',
      });
      this._hostConn = conn;

      conn.on('open', () => {
        if (this._hostConn !== conn) return;
        this._setStatus('connected', `Conectado a la sala ${cleanCode}`);
        this._sendToHost({
          type: 'JOIN_PROFILE',
          profile: {
            id: this.localId,
            name: this.localProfile.name,
            element: this.localProfile.element,
            ready: this.localProfile.ready,
          },
        });
      });

      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ROOM_ERROR') {
          this.disconnect(msg.message || 'No se pudo entrar a la sala.');
          this._setStatus('error', msg.message || 'No se pudo entrar a la sala.');
          return;
        }
        if (msg.type === 'LOBBY_SYNC') {
          this.roomCode = msg.roomCode || this.roomCode;
          this.players = Array.isArray(msg.players) ? msg.players : [];
          if (msg.settings) this.settings = { ...msg.settings };
          this._emitLobbySync();
        } else if (msg.type === 'START_MATCH') {
          if (this.onStartMatch) this.onStartMatch(msg);
        } else if (msg.type === 'WORLD_SNAPSHOT') {
          if (this.onWorldSnapshot) this.onWorldSnapshot(msg);
        } else if (msg.type === 'ABILITY_CAST') {
          if (this.onAbilityCast) this.onAbilityCast(msg);
        } else if (msg.type === 'COMBAT_EVENT') {
          if (this.onCombatEvent) this.onCombatEvent(msg);
        } else if (msg.type === 'BARREL_DESTROYED') {
          if (this.onBarrelDestroyed) this.onBarrelDestroyed(msg);
        } else if (msg.type === 'WAVE_UPGRADE_OPEN') {
          if (this.onWaveUpgradeOpen) this.onWaveUpgradeOpen(msg);
        } else if (msg.type === 'START_NEXT_WAVE') {
          if (this.onStartNextWave) this.onStartNextWave(msg);
        } else if (msg.type === 'MATCH_OVER') {
          if (this.onMatchOver) this.onMatchOver(msg);
        } else if (msg.type === 'RETURN_TO_LOBBY') {
          if (this.onReturnToLobby) this.onReturnToLobby(msg);
        }
      });

      const onHostLost = () => {
        if (this._hostConn !== conn) return;
        const wasOnline = this.role === 'guest';
        this.disconnect('El Host cerró la sala o se desconectó.');
        this._setStatus('error', 'Conexión perdida con el Host.');
        if (wasOnline && this.onPeerDisconnected) {
          this.onPeerDisconnected('host');
        }
      };

      conn.on('close', onHostLost);
      conn.on('error', onHostLost);
    });

    peer.on('error', (err) => {
      if (this._peer !== peer) return;
      const friendly =
        err?.type === 'peer-unavailable'
          ? `No se encontró la sala ${cleanCode}. Verifica el código.`
          : `Error al conectar: ${err?.message || err?.type || 'desconocido'}`;
      this.disconnect(friendly);
      this._setStatus('error', friendly);
    });
  }

  /** Actualiza nombre, elemento o estado Listo del jugador local dentro del Lobby */
  updateLocalProfile({ name, element, ready } = {}) {
    if (name !== undefined) this.localProfile.name = String(name).trim().slice(0, 16) || this.localProfile.name;
    if (element !== undefined) this.localProfile.element = element;
    if (typeof ready === 'boolean') this.localProfile.ready = ready;

    if (this.role === 'host') {
      const me = this.players.find((p) => p.id === this.localId);
      if (me) {
        me.name = this.localProfile.name;
        me.element = this.localProfile.element;
        me.ready = this.localProfile.ready;
      }
      this._broadcastLobbySync();
    } else if (this.role === 'guest') {
      this._sendToHost({
        type: 'LOBBY_PROFILE_UPDATE',
        profile: {
          name: this.localProfile.name,
          element: this.localProfile.element,
          ready: this.localProfile.ready,
        },
      });
    }
  }

  /** Actualiza escenario/formato en el Lobby (solo Host) */
  updateLobbySettings({ mode, format } = {}) {
    if (this.role !== 'host') return;
    if (mode) this.settings.mode = mode;
    if (format) this.settings.format = format;
    this._broadcastLobbySync();
  }

  _emitLobbySync() {
    if (this.onLobbySync) {
      this.onLobbySync({
        roomCode: this.roomCode,
        players: this.players.map((p) => ({ ...p })),
        settings: { ...this.settings },
      });
    }
  }

  _broadcastLobbySync() {
    const payload = {
      type: 'LOBBY_SYNC',
      roomCode: this.roomCode,
      players: this.players,
      settings: this.settings,
    };
    this._broadcastToGuests(payload);
    this._emitLobbySync();
  }

  /** Envía orden oficial de inicio de partida a todos los invitados (solo Host) */
  broadcastStartMatch(payload) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({
      type: 'START_MATCH',
      ...payload,
    });
  }

  /**
   * Acumulador 25 Hz por frame; enviar inmediatamente si hay acción o solicitud nueva.
   * @param {number} dt
   * @param {() => object} buildStateFn
   */
  tickGuestInput(dt, buildStateFn) {
    if (this.role !== 'guest' || !this._hostConn || !this._hostConn.open) return;
    this._inputAccum += dt;
    const state = buildStateFn();
    const sig = `${state.action || ''}|${state.abilityRequest || ''}|${state.animState}`;
    const forceNow = sig !== this._lastImmediateSig && (state.action || state.abilityRequest || state.animState === 'dash' || state.animState === 'jump');

    if (forceNow || this._inputAccum >= SEND_INTERVAL) {
      this._inputAccum = forceNow ? 0 : this._inputAccum % SEND_INTERVAL;
      this._lastImmediateSig = sig;
      this._seq += 1;
      this._sendToHost({
        type: 'PLAYER_INPUT_STATE',
        id: this.localId,
        seq: this._seq,
        ...state,
      });
    }
  }

  /**
   * Host emite WORLD_SNAPSHOT a 25 Hz a todos los invitados conectados.
   * @param {number} dt
   * @param {() => object} buildSnapshotFn
   */
  tickHostSnapshot(dt, buildSnapshotFn) {
    if (this.role !== 'host' || this._guestConns.size === 0) return;
    this._snapshotAccum += dt;
    if (this._snapshotAccum < SEND_INTERVAL) return;
    this._snapshotAccum %= SEND_INTERVAL;

    const snap = buildSnapshotFn();
    this._broadcastToGuests({
      type: 'WORLD_SNAPSHOT',
      ts: performance.now(),
      ...snap,
    });
  }

  sendAbilityCast({ slot, origin, aimPoint, yaw }) {
    if (this.role !== 'guest') return;
    this._sendToHost({
      type: 'ABILITY_CAST',
      senderId: this.localId,
      slot,
      origin,
      aimPoint,
      yaw,
    });
  }

  broadcastAbilityCast(payload, excludePeerId = null) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'ABILITY_CAST', ...payload }, excludePeerId);
  }

  broadcastCombatEvent(event) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'COMBAT_EVENT', ...event });
  }

  broadcastBarrelDestroyed(barrelId) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'BARREL_DESTROYED', barrelId });
  }

  broadcastWaveUpgradeOpen(payload) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'WAVE_UPGRADE_OPEN', ...payload });
  }

  sendUpgradeSelected({ upgradeId, isAura = false }) {
    if (this.role !== 'guest') return;
    this._sendToHost({
      type: 'UPGRADE_SELECTED',
      playerId: this.localId,
      upgradeId,
      isAura,
    });
  }

  broadcastStartNextWave(payload) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'START_NEXT_WAVE', ...payload });
  }

  broadcastMatchOver(payload) {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'MATCH_OVER', ...payload });
  }

  broadcastReturnToLobby() {
    if (this.role !== 'host') return;
    this._broadcastToGuests({ type: 'RETURN_TO_LOBBY' });
  }

  _sendToHost(data) {
    if (this._hostConn && this._hostConn.open) {
      try {
        this._hostConn.send(data);
      } catch {
        // Ignorar si la conexión se está cerrando
      }
    }
  }

  _broadcastToGuests(data, excludePeerId = null) {
    for (const [peerId, conn] of this._guestConns.entries()) {
      if (excludePeerId && peerId === excludePeerId) continue;
      if (conn && conn.open) {
        try {
          conn.send(data);
        } catch {
          // Ignorar fallo puntual
        }
      }
    }
  }
}
