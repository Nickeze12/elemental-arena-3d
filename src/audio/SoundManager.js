/**
 * SoundManager
 * ------------------------------------------------------------
 * Sintetizador de efectos de sonido 100% procedural basado en Web Audio API
 * (`AudioContext`), sin archivos de audio externos.
 *  - Se desbloquea automáticamente con la primera interacción del usuario.
 *  - Soporta silenciamiento (`toggleMute`, tecla `M` y botón en el HUD).
 *  - Sintetiza sonidos de movimiento, combate de Tierra (graves, ruido marrón/rosa
 *    filtrado y envolventes ADSR), impactos escalados por daño y fanfarrias de duelo.
 */

export class SoundManager {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.masterGain = null;

    this.muted = false;
    this.masterVolume = 0.65;

    /** Callback opcional al cambiar el estado de mute: `(muted: boolean) => void` */
    this.onMuteChange = null;

    this._whiteBuffer = null;
    this._pinkBuffer = null;
    this._brownBuffer = null;

    this._unlock = this._unlock.bind(this);
    window.addEventListener('pointerdown', this._unlock, { passive: true });
    window.addEventListener('keydown', this._unlock, { passive: true });
  }

  /** Inicializa o reanuda el AudioContext tras un gesto del usuario */
  _unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
      this._buildNoiseBuffers();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /** Asegura que el contexto exista y devuelve el tiempo actual o null si está silenciado */
  _ready() {
    this._unlock();
    if (!this.ctx || this.muted) return null;
    return this.ctx.currentTime;
  }

  /** Alterna el estado de silencio (Mute) */
  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.masterVolume,
        this.ctx.currentTime,
        0.015
      );
    }
    if (this.onMuteChange) this.onMuteChange(this.muted);
    return this.muted;
  }

  _buildNoiseBuffers() {
    const sr = this.ctx.sampleRate;
    const len = sr * 2; // 2 segundos de ruido reutilizable

    // Ruido blanco
    this._whiteBuffer = this.ctx.createBuffer(1, len, sr);
    const w = this._whiteBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
    }

    // Ruido rosa (aproximación de Paul Kellet)
    this._pinkBuffer = this.ctx.createBuffer(1, len, sr);
    const p = this._pinkBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    // Ruido marrón (integración con fugas para graves terrosos)
    this._brownBuffer = this.ctx.createBuffer(1, len, sr);
    const br = this._brownBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      br[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = br[i];
      br[i] *= 3.5;
    }
  }

  /** Crea una fuente de ruido ('white' | 'pink' | 'brown') con offset aleatorio */
  _noiseSource(type = 'brown') {
    const src = this.ctx.createBufferSource();
    src.buffer =
      type === 'white'
        ? this._whiteBuffer
        : type === 'pink'
        ? this._pinkBuffer
        : this._brownBuffer;
    src.loop = true;
    return src;
  }

  // ============================================================
  //  1. Movimiento
  // ============================================================

  /** Impulso de salto: barrido corto ascendente + soplo de baja frecuencia */
  playJump() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, t0);
    osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.14);

    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);

    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.17);

    // Ruido filtrado breve
    const noise = this._noiseSource('pink');
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(280, t0);
    filter.frequency.exponentialRampToValueAtTime(620, t0 + 0.12);
    filter.Q.value = 1.8;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.14, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);

    noise.connect(filter).connect(nGain).connect(this.masterGain);
    noise.start(t0, Math.random());
    noise.stop(t0 + 0.14);
  }

  /** Aterrizaje en piedra: golpe grave + textura corta de polvo */
  playLand(intensity = 0.7) {
    const t0 = this._ready();
    if (t0 === null) return;
    const k = Math.max(0.25, Math.min(1.2, intensity));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110 * k, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);

    gain.gain.setValueAtTime(0.32 * k, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.15);

    const noise = this._noiseSource('brown');
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(360, t0);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.25 * k, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);

    noise.connect(filter).connect(nGain).connect(this.masterGain);
    noise.start(t0, Math.random());
    noise.stop(t0 + 0.13);
  }

  /** Dash evasivo: barrido rápido de ruido blanco con filtro paso-banda (whoosh) */
  playDash() {
    const t0 = this._ready();
    if (t0 === null) return;

    const noise = this._noiseSource('white');
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.4;
    filter.frequency.setValueAtTime(320, t0);
    filter.frequency.exponentialRampToValueAtTime(1650, t0 + 0.08);
    filter.frequency.exponentialRampToValueAtTime(420, t0 + 0.24);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.32, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);

    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start(t0, Math.random());
    noise.stop(t0 + 0.26);
  }

  // ============================================================
  //  2. Combate de Tierra
  // ============================================================

  /** Invocación de roca desde el suelo: golpe seco grave + crujido de grava */
  playRockSummon() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.11);

    gain.gain.setValueAtTime(0.35, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.13);

    const gravel = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(680, t0);
    bp.Q.value = 1.4;
    const gGain = this.ctx.createGain();
    gGain.gain.setValueAtTime(0.22, t0);
    gGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);

    gravel.connect(bp).connect(gGain).connect(this.masterGain);
    gravel.start(t0, Math.random());
    gravel.stop(t0 + 0.11);
  }

  /** Disparo de roca: puñetazo seco + silbido grave de lanzamiento */
  playRockThrow() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(175, t0);
    osc.frequency.exponentialRampToValueAtTime(58, t0 + 0.12);

    gain.gain.setValueAtTime(0.38, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.14);

    const whoosh = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.0;
    bp.frequency.setValueAtTime(950, t0);
    bp.frequency.exponentialRampToValueAtTime(340, t0 + 0.15);

    const wGain = this.ctx.createGain();
    wGain.gain.setValueAtTime(0.24, t0);
    wGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    whoosh.connect(bp).connect(wGain).connect(this.masterGain);
    whoosh.start(t0, Math.random());
    whoosh.stop(t0 + 0.17);
  }

  /** Muro de Tierra: retumbo profundo ascendente (60Hz -> 140Hz) con roce de piedra */
  playWallRaise() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.26);
    osc.frequency.exponentialRampToValueAtTime(75, t0 + 0.42);

    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t0);
    sub.frequency.linearRampToValueAtTime(70, t0 + 0.3);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, t0);

    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.42, t0 + 0.04);
    gain.gain.setValueAtTime(0.36, t0 + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);

    osc.connect(lp);
    sub.connect(lp);
    lp.connect(gain).connect(this.masterGain);
    osc.start(t0);
    sub.start(t0);
    osc.stop(t0 + 0.46);
    sub.stop(t0 + 0.46);

    // Textura de piedra rozando
    const grind = this._noiseSource('brown');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(220, t0);
    bp.frequency.linearRampToValueAtTime(520, t0 + 0.3);
    bp.Q.value = 1.2;

    const gGain = this.ctx.createGain();
    gGain.gain.setValueAtTime(0.001, t0);
    gGain.gain.linearRampToValueAtTime(0.35, t0 + 0.05);
    gGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);

    grind.connect(bp).connect(gGain).connect(this.masterGain);
    grind.start(t0, Math.random());
    grind.stop(t0 + 0.44);
  }

  /** Paso de Onda Sísmica: impacto percusivo cuyo tono sube con cada pincho (0..5) */
  playSeismicStep(index = 0) {
    const t0 = this._ready();
    if (t0 === null) return;

    const pitchScale = 1 + index * 0.11;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115 * pitchScale, t0);
    osc.frequency.exponentialRampToValueAtTime(42 * pitchScale, t0 + 0.16);

    gain.gain.setValueAtTime(0.36, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.19);

    const burst = this._noiseSource('brown');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(340 * pitchScale, t0);
    bp.Q.value = 1.5;
    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(0.28, t0);
    bGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

    burst.connect(bp).connect(bGain).connect(this.masterGain);
    burst.start(t0, Math.random());
    burst.stop(t0 + 0.16);
  }

  /** Carga de Peñasco Colosal: vibración grave creciente durante la anticipación */
  playBoulderCharge() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(52, t0);
    osc.frequency.exponentialRampToValueAtTime(135, t0 + 0.28);

    lfo.frequency.value = 28;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(280, t0);
    lp.frequency.linearRampToValueAtTime(620, t0 + 0.28);

    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.38, t0 + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);

    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + 0.35);
    lfo.stop(t0 + 0.35);
  }

  /** Explosión del Peñasco Colosal: impacto sub-grave con caída larga de escombros */
  playBoulderExplosion() {
    const t0 = this._ready();
    if (t0 === null) return;

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, t0);
    sub.frequency.exponentialRampToValueAtTime(28, t0 + 0.55);

    subGain.gain.setValueAtTime(0.58, t0);
    subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    sub.connect(subGain).connect(this.masterGain);
    sub.start(t0);
    sub.stop(t0 + 0.62);

    const rumble = this._noiseSource('brown');
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(540, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.65);

    const rGain = this.ctx.createGain();
    rGain.gain.setValueAtTime(0.48, t0);
    rGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.68);
    rumble.connect(lp).connect(rGain).connect(this.masterGain);
    rumble.start(t0, Math.random());
    rumble.stop(t0 + 0.7);
  }

  // ============================================================
  //  2B. Combate de Fuego (ruido filtrado cálido y estallidos)
  // ============================================================

  /** Combo Ígneo de 3 golpes (step 0, 1, 2): tono ascendente + filo cortante en el remate */
  playFireCombo(step = 0) {
    const t0 = this._ready();
    if (t0 === null) return;

    const pitchScale = 1 + step * 0.22;
    const isFinisher = step >= 2;
    const dur = isFinisher ? 0.28 : 0.19;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220 * pitchScale, t0);
    osc.frequency.exponentialRampToValueAtTime((isFinisher ? 95 : 75) * pitchScale, t0 + dur);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(750 * pitchScale, t0);

    gain.gain.setValueAtTime(isFinisher ? 0.36 : 0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.02);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);

    const flame = this._noiseSource(isFinisher ? 'white' : 'pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = isFinisher ? 2.1 : 1.6;
    bp.frequency.setValueAtTime(420 * pitchScale, t0);
    bp.frequency.exponentialRampToValueAtTime(1450 * pitchScale, t0 + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(380 * pitchScale, t0 + dur);

    const fGain = this.ctx.createGain();
    fGain.gain.setValueAtTime(isFinisher ? 0.42 : 0.32, t0);
    fGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.02);
    flame.connect(bp).connect(fGain).connect(this.masterGain);
    flame.start(t0, Math.random());
    flame.stop(t0 + dur + 0.03);
  }

  /** Bola de Fuego: alias compatible */
  playFireball() {
    this.playFireCombo(0);
  }

  /** Muro Bajo de Fuego: llamarada continua grave al encender la barrera */
  playFireWall() {
    const t0 = this._ready();
    if (t0 === null) return;

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(72, t0);
    sub.frequency.linearRampToValueAtTime(108, t0 + 0.25);
    sub.frequency.exponentialRampToValueAtTime(62, t0 + 0.72);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, t0);

    sGain.gain.setValueAtTime(0.001, t0);
    sGain.gain.linearRampToValueAtTime(0.32, t0 + 0.06);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.75);
    sub.connect(lp).connect(sGain).connect(this.masterGain);
    sub.start(t0);
    sub.stop(t0 + 0.78);

    const roar = this._noiseSource('brown');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(320, t0);
    bp.frequency.exponentialRampToValueAtTime(840, t0 + 0.25);
    bp.frequency.exponentialRampToValueAtTime(280, t0 + 0.75);

    const rGain = this.ctx.createGain();
    rGain.gain.setValueAtTime(0.001, t0);
    rGain.gain.linearRampToValueAtTime(0.38, t0 + 0.07);
    rGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.78);
    roar.connect(bp).connect(rGain).connect(this.masterGain);
    roar.start(t0, Math.random());
    roar.stop(t0 + 0.8);
  }

  /** Chisporroteo breve al activar el estado alterado Quemadura */
  playBurnSizzle() {
    const t0 = this._ready();
    if (t0 === null) return;

    const crackle = this._noiseSource('white');
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 3.0;
    hp.frequency.setValueAtTime(2200, t0);
    hp.frequency.exponentialRampToValueAtTime(980, t0 + 0.18);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    crackle.connect(hp).connect(gain).connect(this.masterGain);
    crackle.start(t0, Math.random());
    crackle.stop(t0 + 0.22);
  }

  /** Escudo de Llamas: remolino ígneo envolvente */
  playFireShield() {
    const t0 = this._ready();
    if (t0 === null) return;

    const roar = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(280, t0);
    bp.frequency.exponentialRampToValueAtTime(920, t0 + 0.2);
    bp.frequency.exponentialRampToValueAtTime(360, t0 + 0.48);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.36, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);

    roar.connect(bp).connect(gain).connect(this.masterGain);
    roar.start(t0, Math.random());
    roar.stop(t0 + 0.52);
  }

  /** Abanico de Llamas: llamarada ancha en cono */
  playFlameFan() {
    const t0 = this._ready();
    if (t0 === null) return;

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(150, t0);
    sub.frequency.exponentialRampToValueAtTime(52, t0 + 0.28);
    sGain.gain.setValueAtTime(0.36, t0);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    sub.connect(sGain).connect(this.masterGain);
    sub.start(t0);
    sub.stop(t0 + 0.32);

    const blast = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(350, t0);
    bp.frequency.exponentialRampToValueAtTime(1600, t0 + 0.12);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + 0.36);

    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(0.001, t0);
    bGain.gain.linearRampToValueAtTime(0.38, t0 + 0.03);
    bGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);

    blast.connect(bp).connect(bGain).connect(this.masterGain);
    blast.start(t0, Math.random());
    blast.stop(t0 + 0.4);
  }

  /** Propulsión Meteoro: ignición de cohete ígneo */
  playMeteorDash() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(85, t0);
    osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.18);
    osc.frequency.exponentialRampToValueAtTime(95, t0 + 0.38);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(580, t0);

    gain.gain.setValueAtTime(0.35, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.42);

    const jet = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.0;
    bp.frequency.setValueAtTime(480, t0);
    bp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.22);

    const jGain = this.ctx.createGain();
    jGain.gain.setValueAtTime(0.34, t0);
    jGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
    jet.connect(bp).connect(jGain).connect(this.masterGain);
    jet.start(t0, Math.random());
    jet.stop(t0 + 0.4);
  }

  /** Explosión Ígnea: detonación grave + crepitar de fuego */
  playFireExplosion() {
    const t0 = this._ready();
    if (t0 === null) return;

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, t0);
    sub.frequency.exponentialRampToValueAtTime(30, t0 + 0.48);
    sGain.gain.setValueAtTime(0.55, t0);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.52);
    sub.connect(sGain).connect(this.masterGain);
    sub.start(t0);
    sub.stop(t0 + 0.54);

    const burst = this._noiseSource('pink');
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, t0);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.52);

    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(0.45, t0);
    bGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    burst.connect(lp).connect(bGain).connect(this.masterGain);
    burst.start(t0, Math.random());
    burst.stop(t0 + 0.56);
  }

  // ============================================================
  //  2C. Combate de Agua y Hielo (fluido burbujeante y cristal)
  // ============================================================

  /** Esfera / Látigo de Agua: latigazo fluido resonante */
  playWaterWhip() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t0);
    osc.frequency.exponentialRampToValueAtTime(580, t0 + 0.09);
    osc.frequency.exponentialRampToValueAtTime(190, t0 + 0.2);

    gain.gain.setValueAtTime(0.26, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.21);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.22);

    const splash = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4.2;
    bp.frequency.setValueAtTime(380, t0);
    bp.frequency.exponentialRampToValueAtTime(1450, t0 + 0.1);
    bp.frequency.exponentialRampToValueAtTime(520, t0 + 0.22);

    const sGain = this.ctx.createGain();
    sGain.gain.setValueAtTime(0.32, t0);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.23);
    splash.connect(bp).connect(sGain).connect(this.masterGain);
    splash.start(t0, Math.random());
    splash.stop(t0 + 0.24);
  }

  /** Muro de Hielo: cristalización resonante y crujido helado */
  playIceWall() {
    const t0 = this._ready();
    if (t0 === null) return;

    const freqs = [659.25, 880.0, 1174.66, 1567.98];
    freqs.forEach((f, i) => {
      this._playNote(f, t0 + i * 0.035, 0.26, 0.16, 'triangle');
    });

    const crack = this._noiseSource('white');
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 2.5;
    hp.frequency.setValueAtTime(1850, t0);
    hp.frequency.exponentialRampToValueAtTime(920, t0 + 0.28);

    const cGain = this.ctx.createGain();
    cGain.gain.setValueAtTime(0.28, t0);
    cGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    crack.connect(hp).connect(cGain).connect(this.masterGain);
    crack.start(t0, Math.random());
    crack.stop(t0 + 0.32);
  }

  /** Lanzas de Hielo: triple destello cristalino agudo */
  playIceSpears() {
    const t0 = this._ready();
    if (t0 === null) return;

    const notes = [987.77, 1318.51, 1567.98];
    notes.forEach((f, idx) => {
      const st = t0 + idx * 0.03;
      this._playNote(f, st, 0.18, 0.18, 'sine');
    });

    const shard = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.0;
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(1100, t0 + 0.18);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.24, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.19);
    shard.connect(bp).connect(g).connect(this.masterGain);
    shard.start(t0, Math.random());
    shard.stop(t0 + 0.2);
  }

  /** Ola Maremoto: oleaje profundo en crescendo */
  playTidalWave() {
    const t0 = this._ready();
    if (t0 === null) return;

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(75, t0);
    sub.frequency.linearRampToValueAtTime(110, t0 + 0.22);
    sub.frequency.exponentialRampToValueAtTime(45, t0 + 0.62);
    sGain.gain.setValueAtTime(0.36, t0);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
    sub.connect(sGain).connect(this.masterGain);
    sub.start(t0);
    sub.stop(t0 + 0.66);

    const wave = this._noiseSource('pink');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(220, t0);
    bp.frequency.exponentialRampToValueAtTime(860, t0 + 0.25);
    bp.frequency.exponentialRampToValueAtTime(280, t0 + 0.62);

    const wGain = this.ctx.createGain();
    wGain.gain.setValueAtTime(0.001, t0);
    wGain.gain.linearRampToValueAtTime(0.42, t0 + 0.08);
    wGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
    wave.connect(bp).connect(wGain).connect(this.masterGain);
    wave.start(t0, Math.random());
    wave.stop(t0 + 0.66);
  }

  // ============================================================
  //  2D. Combate de Aire (ráfagas de viento paso-banda agudas)
  // ============================================================

  /** Esfera de Viento: corte aerodinámico veloz */
  playAirShot() {
    const t0 = this._ready();
    if (t0 === null) return;

    const whistle = this.ctx.createOscillator();
    const wGain = this.ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(480, t0);
    whistle.frequency.exponentialRampToValueAtTime(960, t0 + 0.14);
    wGain.gain.setValueAtTime(0.16, t0);
    wGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    whistle.connect(wGain).connect(this.masterGain);
    whistle.start(t0);
    whistle.stop(t0 + 0.16);

    const wind = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.2;
    bp.frequency.setValueAtTime(680, t0);
    bp.frequency.exponentialRampToValueAtTime(2100, t0 + 0.12);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    wind.connect(bp).connect(gain).connect(this.masterGain);
    wind.start(t0, Math.random());
    wind.stop(t0 + 0.17);
  }

  /** Vórtice Deflector: remolino de aire alrededor del luchador */
  playAirVortex() {
    const t0 = this._ready();
    if (t0 === null) return;

    const wind = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.6;
    bp.frequency.setValueAtTime(520, t0);

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 11;
    lfoGain.gain.value = 420;
    lfo.connect(lfoGain).connect(bp.frequency);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.32, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.46);

    wind.connect(bp).connect(gain).connect(this.masterGain);
    wind.start(t0, Math.random());
    lfo.start(t0);
    wind.stop(t0 + 0.48);
    lfo.stop(t0 + 0.48);
  }

  /** Ráfaga Concussiva: golpe de presión sónica y onda de aire */
  playAirBlast() {
    const t0 = this._ready();
    if (t0 === null) return;

    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.22);
    oGain.gain.setValueAtTime(0.42, t0);
    oGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
    osc.connect(oGain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.25);

    const gust = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(1950, t0);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + 0.28);

    const gGain = this.ctx.createGain();
    gGain.gain.setValueAtTime(0.38, t0);
    gGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    gust.connect(bp).connect(gGain).connect(this.masterGain);
    gust.start(t0, Math.random());
    gust.stop(t0 + 0.31);
  }

  /** Torbellino Ascendente: espiral de viento ascendente */
  playTornado() {
    const t0 = this._ready();
    if (t0 === null) return;

    const wind = this._noiseSource('white');
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.8;
    bp.frequency.setValueAtTime(420, t0);
    bp.frequency.exponentialRampToValueAtTime(1850, t0 + 0.38);
    bp.frequency.exponentialRampToValueAtTime(640, t0 + 0.58);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.36, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);

    wind.connect(bp).connect(gain).connect(this.masterGain);
    wind.start(t0, Math.random());
    wind.stop(t0 + 0.62);
  }

  // ============================================================
  //  3. Impactos y Duelo
  // ============================================================

  /**
   * Impacto sobre un luchador o muro.
   * @param {number} [intensity=0.5] valor en [0..1] según el daño recibido
   */
  playHit(intensity = 0.5) {
    const t0 = this._ready();
    if (t0 === null) return;
    const k = Math.max(0.15, Math.min(1, intensity));

    // Golpe de pecho / roca (más grave y fuerte cuanto mayor es intensity)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const startFreq = 190 - k * 55;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(36, t0 + 0.14 + k * 0.1);

    gain.gain.setValueAtTime(0.28 + k * 0.32, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18 + k * 0.1);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.3);

    // Chasquido agudo de fractura
    const snap = this._noiseSource('white');
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(1100 + k * 600, t0);
    hp.Q.value = 1.6;
    const sGain = this.ctx.createGain();
    sGain.gain.setValueAtTime(0.18 + k * 0.22, t0);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);

    snap.connect(hp).connect(sGain).connect(this.masterGain);
    snap.start(t0, Math.random());
    snap.stop(t0 + 0.1);
  }

  /**
   * Cuenta regresiva: tono marcial limpio para "¡PREPARADOS...!" o gong grave para "¡A LUCHAR!"
   * @param {boolean} isGo true = "¡A LUCHAR!", false = "¡PREPARADOS...!"
   */
  playCountdown(isGo = false) {
    const t0 = this._ready();
    if (t0 === null) return;

    if (!isGo) {
      this._playNote(293.66, t0, 0.28, 0.22, 'triangle'); // D4
      this._playNote(440.0, t0 + 0.02, 0.26, 0.14, 'sine'); // A4
    } else {
      // Gong / acorde marcial potente (D3 + A3 + D4 + F#4)
      this._playNote(146.83, t0, 0.75, 0.32, 'sawtooth', 650);
      this._playNote(220.0, t0, 0.7, 0.22, 'triangle');
      this._playNote(293.66, t0, 0.65, 0.22, 'triangle');
      this._playNote(369.99, t0, 0.6, 0.18, 'sine');
    }
  }

  /**
   * Fanfarria corta de fin de partida.
   * @param {boolean} isVictory
   */
  playMatchEnd(isVictory = true) {
    const t0 = this._ready();
    if (t0 === null) return;

    if (isVictory) {
      // Arpegio heroico ascendente (D4 -> F#4 -> A4 -> D5)
      const notes = [293.66, 369.99, 440.0, 587.33];
      notes.forEach((freq, idx) => {
        const start = t0 + idx * 0.11;
        const dur = idx === notes.length - 1 ? 0.65 : 0.24;
        this._playNote(freq, start, dur, 0.24, 'triangle');
        this._playNote(freq * 0.5, start, dur, 0.14, 'sine');
      });
    } else {
      // Acorde menor descendente (D4 -> C4 -> Bb3 -> A3)
      const notes = [293.66, 261.63, 233.08, 196.0];
      notes.forEach((freq, idx) => {
        const start = t0 + idx * 0.14;
        const dur = idx === notes.length - 1 ? 0.7 : 0.26;
        this._playNote(freq, start, dur, 0.22, 'sawtooth', 480);
      });
    }
  }

  /** Sonido crujiente de barril de madera rompiéndose en tablones */
  playWoodBreak() {
    const t0 = this._ready();
    if (t0 === null) return;

    // Golpe hueco de barril
    const thud = this.ctx.createOscillator();
    const tGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(175, t0);
    thud.frequency.exponentialRampToValueAtTime(58, t0 + 0.11);
    tGain.gain.setValueAtTime(0.32, t0);
    tGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    thud.connect(tGain).connect(this.masterGain);
    thud.start(t0);
    thud.stop(t0 + 0.13);

    // Dos chasquidos secos de astillas de madera
    for (let i = 0; i < 2; i++) {
      const start = t0 + i * 0.045;
      const crack = this._noiseSource('white');
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1350 - i * 320, start);
      bp.Q.value = 2.2;
      const cGain = this.ctx.createGain();
      cGain.gain.setValueAtTime(0.28, start);
      cGain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
      crack.connect(bp).connect(cGain).connect(this.masterGain);
      crack.start(start, Math.random());
      crack.stop(start + 0.1);
    }
  }

  /** Alerta y penalización (-20 HP) por caída al abismo y reaparición */
  playAbyssPenalty() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(246.94, t0, 0.16, 0.22, 'sawtooth', 900);
    this._playNote(164.81, t0 + 0.08, 0.26, 0.25, 'triangle', 750);
  }

  /** Sonido armónico de invocación de monstruos elementales en Supervivencia */
  playMonsterSpawn(isBoss = false) {
    const t0 = this._ready();
    if (t0 === null) return;
    if (isBoss) {
      this._playNote(98.0, t0, 0.55, 0.34, 'sawtooth', 420);
      this._playNote(146.83, t0 + 0.08, 0.5, 0.26, 'triangle');
      this._playNote(220.0, t0 + 0.16, 0.45, 0.22, 'sine');
    } else {
      this._playNote(261.63, t0, 0.24, 0.18, 'triangle');
      this._playNote(392.0, t0 + 0.06, 0.28, 0.16, 'sine');
    }
  }

  /** Fanfarria corta al completar una oleada de Supervivencia */
  playWaveClear() {
    const t0 = this._ready();
    if (t0 === null) return;
    const notes = [392.0, 493.88, 587.33, 783.99];
    for (let i = 0; i < notes.length; i++) {
      this._playNote(notes[i], t0 + i * 0.065, 0.28, 0.2, 'triangle');
    }
  }

  /** Destello sonoro al elegir una carta de mejora entre oleadas */
  playUpgradePick() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(523.25, t0, 0.18, 0.2, 'sine');
    this._playNote(783.99, t0 + 0.07, 0.26, 0.22, 'triangle');
  }

  /** Impacto radial grave de Gólem o Coloso */
  playColossusSlam() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(73.42, t0, 0.42, 0.36, 'sawtooth', 360);
    this._playNote(55.0, t0 + 0.02, 0.48, 0.32, 'triangle');
  }

  /** Acorde / ráfaga elemental al activar el Aura Elemental (Tecla R) */
  playAuraActivate(element = 'earth') {
    const t0 = this._ready();
    if (t0 === null) return;
    if (element === 'fire') {
      this._playNote(220.0, t0, 0.35, 0.28, 'sawtooth', 1400);
      this._playNote(329.63, t0 + 0.05, 0.4, 0.24, 'triangle');
      this._playNote(440.0, t0 + 0.1, 0.45, 0.22, 'sawtooth', 1800);
    } else if (element === 'water') {
      this._playNote(392.0, t0, 0.32, 0.22, 'sine');
      this._playNote(493.88, t0 + 0.06, 0.36, 0.22, 'sine');
      this._playNote(587.33, t0 + 0.12, 0.42, 0.2, 'triangle');
    } else if (element === 'air') {
      this._playNote(523.25, t0, 0.3, 0.2, 'triangle');
      this._playNote(659.25, t0 + 0.05, 0.34, 0.2, 'sine');
      this._playNote(783.99, t0 + 0.1, 0.4, 0.18, 'sine');
    } else if (element === 'nature') {
      this._playNote(293.66, t0, 0.35, 0.22, 'sine');
      this._playNote(369.99, t0 + 0.05, 0.38, 0.2, 'triangle');
      this._playNote(440.0, t0 + 0.1, 0.44, 0.18, 'sine');
      this._playNoiseBurst(0.24, 1400, 0.1, t0);
    } else if (element === 'psychic') {
      this._playNote(329.63, t0, 0.36, 0.2, 'sine');
      this._playNote(493.88, t0 + 0.05, 0.42, 0.18, 'sine');
      this._playNote(659.25, t0 + 0.1, 0.46, 0.16, 'triangle');
      this._playFmSweep(740, 1120, 0.38, 0.11, t0, 28);
    } else if (element === 'storm') {
      this._playNoiseBurst(0.32, 1900, 0.16, t0, 'pink');
      this._playNote(196.0, t0, 0.36, 0.2, 'sawtooth', 900);
      this._playNote(440.0, t0 + 0.04, 0.22, 0.14, 'square', 2200);
      this._playNote(659.25, t0 + 0.09, 0.3, 0.16, 'triangle');
    } else if (element === 'light') {
      this._playNote(587.33, t0, 0.34, 0.22, 'sine');
      this._playNote(880.0, t0 + 0.04, 0.38, 0.2, 'triangle');
      this._playNote(1174.66, t0 + 0.09, 0.44, 0.18, 'sine');
      this._playFmSweep(980, 1760, 0.32, 0.12, t0, 32, 60);
    } else if (element === 'shadow') {
      this._playNoiseBurst(0.36, 750, 0.18, t0, 'pink');
      this._playNote(65.41, t0, 0.46, 0.28, 'sine');
      this._playNote(98.0, t0 + 0.04, 0.44, 0.22, 'triangle', 420);
      this._playFmSweep(240, 82, 0.42, 0.14, t0, 14, 38);
    } else {
      this._playNote(110.0, t0, 0.42, 0.32, 'sawtooth', 520);
      this._playNote(164.81, t0 + 0.05, 0.4, 0.26, 'triangle');
      this._playNote(220.0, t0 + 0.1, 0.42, 0.22, 'triangle');
    }
  }

  /** Silbido rápido de espinas/hojas afiladas cortando el aire (Ráfaga de Espinas) */
  playNatureThorn() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.11, 2600, 0.14, t0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(760, t0);
    osc.frequency.exponentialRampToValueAtTime(340, t0 + 0.11);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.13);
  }

  /** Sonido de brote orgánico creciendo al invocar el Brote Escupesemillas */
  playNaturePlantSpawn() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(220, t0, 0.18, 0.2, 'sine');
    this._playNote(329.63, t0 + 0.05, 0.22, 0.2, 'triangle');
    this._playNote(440, t0 + 0.1, 0.26, 0.16, 'sine');
    this._playNoiseBurst(0.18, 950, 0.15, t0);
  }

  /** Chasquido y disparo agudo al escupir una semilla la planta torreta */
  playNatureSeedSpit() {
    const t0 = this._ready();
    if (t0 === null) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(860, t0 + 0.05);
    osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.13);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.15);
    this._playNoiseBurst(0.08, 1700, 0.08, t0);
  }

  /** Crujido orgánico y brote en el suelo para Raíces Enredaderas */
  playNatureRoot() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.22, 720, 0.2, t0);
    this._playNote(146.83, t0, 0.24, 0.22, 'sawtooth', 520);
    this._playNote(196.0, t0 + 0.06, 0.26, 0.18, 'triangle', 680);
  }

  /** Nube vibrante de esporas y hojas cortantes para Tormenta de Esporas */
  playNatureSpore() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.32, 1600, 0.16, t0);
    this._playNote(349.23, t0, 0.28, 0.18, 'sine');
    this._playNote(523.25, t0 + 0.06, 0.34, 0.18, 'triangle');
    this._playNote(659.25, t0 + 0.12, 0.36, 0.14, 'sine');
  }

  /** Pulso etéreo FM para Orbe Telequinético */
  playPsychicOrb() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playFmSweep(620, 960, 0.16, 0.14, t0, 34);
    this._playNote(587.33, t0, 0.14, 0.12, 'sine');
  }

  /** Vibrato hipnótico dual para Pulso de Confusión */
  playPsychicConfuse() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playFmSweep(780, 420, 0.36, 0.16, t0, 14, 48);
    this._playNote(440, t0 + 0.04, 0.3, 0.12, 'triangle');
  }

  /** Barrido mental expansivo para Onda Telequinética */
  playPsychicWave() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playFmSweep(880, 220, 0.34, 0.2, t0, 22, 65);
    this._playNoiseBurst(0.22, 2200, 0.12, t0, 'white');
  }

  /** Singularidad gravitatoria profunda e implosión resonante (Implosión Astral) */
  playPsychicSingularity(isDetonation = false) {
    const t0 = this._ready();
    if (t0 === null) return;
    if (isDetonation) {
      this._playFmSweep(460, 110, 0.45, 0.24, t0, 18, 55);
      this._playNoiseBurst(0.28, 1200, 0.16, t0);
    } else {
      this._playFmSweep(140, 320, 0.55, 0.18, t0, 9, 24);
      this._playNote(196.0, t0, 0.48, 0.16, 'sine');
    }
  }

  /** Chispa eléctrica veloz para Descarga Voltaica */
  playStormBolt() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.08, 3200, 0.14, t0, 'white');
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1180, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.09);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.11);
  }

  /** Desvanecimiento en niebla vaporosa con murmullo filtrado */
  playStormMistStart() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.32, 1350, 0.16, t0, 'pink');
    this._playFmSweep(280, 560, 0.24, 0.1, t0, 16, 22);
  }

  /** Disipación de la Forma de Niebla */
  playStormMistEnd() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.18, 950, 0.12, t0, 'pink');
    this._playNote(392.0, t0, 0.14, 0.09, 'triangle');
  }

  /** Arcos eléctricos encadenados (Relámpago Encadenado Q) */
  playStormChain() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.18, 2900, 0.16, t0, 'white');
    this._playNote(980, t0, 0.07, 0.15, 'square', 3200);
    this._playNote(1320, t0 + 0.045, 0.08, 0.14, 'sawtooth', 3600);
    this._playNote(740, t0 + 0.09, 0.09, 0.12, 'square', 2600);
  }

  /** Estruendo grave + chasquido eléctrico de Nube de Trueno (E) */
  playStormThunder() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.45, 360, 0.28, t0, 'pink');
    this._playNoiseBurst(0.14, 2800, 0.16, t0, 'white');
    this._playNote(78.0, t0 + 0.02, 0.36, 0.26, 'sawtooth', 340);
    this._playNote(620.0, t0, 0.08, 0.15, 'square', 2200);
  }

  /** Barrido agudo cristalino del Haz Fotónico (Click Izq Luz) */
  playLightBeam() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playFmSweep(1480, 620, 0.16, 0.17, t0, 42, 95);
    this._playNote(1174.66, t0, 0.14, 0.14, 'sine');
    this._playNote(1760.0, t0 + 0.02, 0.12, 0.09, 'triangle');
  }

  /** Acorde ilusorio cristalino al invocar o detonar Espejismo (Click Der Luz) */
  playLightMirage() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(523.25, t0, 0.22, 0.16, 'sine');
    this._playNote(783.99, t0 + 0.04, 0.26, 0.16, 'triangle');
    this._playNote(1046.5, t0 + 0.08, 0.3, 0.14, 'sine');
    this._playFmSweep(660, 1320, 0.25, 0.1, t0, 18, 45);
  }

  /** Estallido solar brillante de Destello Solar (Q Luz) */
  playLightFlash() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.24, 3200, 0.18, t0, 'white');
    this._playFmSweep(1760, 440, 0.28, 0.2, t0, 26, 120);
    this._playNote(880.0, t0, 0.34, 0.2, 'sine');
    this._playNote(1318.5, t0 + 0.03, 0.36, 0.16, 'triangle');
  }

  /** Armónico vítreo al invocar el Prisma Refractario (E Luz) */
  playLightPrismSpawn() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(659.25, t0, 0.28, 0.18, 'sine');
    this._playNote(987.77, t0 + 0.045, 0.32, 0.16, 'sine');
    this._playNote(1479.98, t0 + 0.09, 0.36, 0.15, 'triangle');
  }

  /** Refracción prismática multifrecuencia al rebotar haces en láseres */
  playLightRefract() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(1174.66, t0, 0.18, 0.16, 'sine');
    this._playNote(1479.98, t0 + 0.025, 0.2, 0.15, 'sine');
    this._playNote(1975.53, t0 + 0.05, 0.24, 0.14, 'triangle');
    this._playFmSweep(1600, 2400, 0.16, 0.09, t0, 36, 70);
  }

  /** Silbido líquido oscuro de Lanza Umbría (Click Izq Sombra) */
  playShadowLance(empowered = false) {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.14, empowered ? 1600 : 1050, 0.14, t0, 'pink');
    this._playFmSweep(empowered ? 540 : 410, 92, 0.2, empowered ? 0.2 : 0.16, t0, 18, 52);
    this._playNote(empowered ? 130.81 : 98.0, t0, 0.18, 0.18, 'sine');
  }

  /** Desvanecimiento sub-armónico y susurro de portal para Paso Sombrío (Click Der Sombra) */
  playShadowStep() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.28, 820, 0.18, t0, 'pink');
    this._playNote(61.74, t0, 0.34, 0.26, 'sine');
    this._playFmSweep(320, 74, 0.28, 0.14, t0, 14, 34);
    this._playNote(185.0, t0 + 0.08, 0.22, 0.12, 'triangle', 680);
  }

  /** Pulso orgánico oscuro y absorción vital de Zarcillos Drenavida (Q Sombra) */
  playShadowTendrils() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.32, 640, 0.16, t0, 'pink');
    this._playNote(73.42, t0, 0.38, 0.24, 'sawtooth', 380);
    this._playFmSweep(140, 310, 0.34, 0.13, t0 + 0.04, 16, 44);
    this._playNote(220.0, t0 + 0.12, 0.28, 0.12, 'sine');
  }

  /** Resonancia grave eclipsada al desplegar Velo de Eclipse (E Sombra) */
  playShadowEclipse() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNoiseBurst(0.45, 520, 0.18, t0, 'pink');
    this._playNote(55.0, t0, 0.56, 0.28, 'sine');
    this._playNote(110.0, t0 + 0.04, 0.52, 0.18, 'triangle', 420);
    this._playFmSweep(196, 68, 0.48, 0.12, t0, 11, 28);
  }

  // ============================================================
  //  Economía y Ruletas (monedas, ticks y fanfarrias)
  // ============================================================

  /** Tintineo metálico doble agudo al recibir oro */
  playCoinReward() {
    const t0 = this._ready();
    if (t0 === null) return;
    this._playNote(1318.5, t0, 0.11, 0.16, 'sine');
    this._playNote(2637.0, t0, 0.1, 0.06, 'triangle');
    this._playNote(1760.0, t0 + 0.075, 0.22, 0.18, 'sine');
    this._playNote(3520.0, t0 + 0.075, 0.16, 0.05, 'triangle');
  }

  /** Clic breve de ruleta cuya altura sube progresivamente con pitchFactor [0..1] */
  playRouletteTick(pitchFactor = 0) {
    const t0 = this._ready();
    if (t0 === null) return;
    const p = Math.max(0, Math.min(1, Number(pitchFactor) || 0));
    const freq = 520 + p * 420;
    this._playNote(freq, t0, 0.04, 0.11, 'triangle', 2600);
  }

  /** Acorde brillante al frenar ruleta clásica o fanfarria cristalina legendaria */
  playRouletteWin(isLegendary = false) {
    const t0 = this._ready();
    if (t0 === null) return;
    if (isLegendary) {
      const notes = [587.33, 739.99, 880.0, 1174.66, 1479.98];
      notes.forEach((f, i) => {
        this._playNote(f, t0 + i * 0.075, 0.45, 0.17, 'triangle');
        this._playNote(f * 2, t0 + i * 0.075, 0.32, 0.06, 'sine');
      });
    } else {
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((f, i) => {
        this._playNote(f, t0 + i * 0.055, 0.34, 0.16, 'triangle');
      });
    }
  }

  _playFmSweep(freqStart, freqEnd, duration, volume = 0.16, startTime = this.ctx.currentTime, modFreq = 24, modDepth = 40) {
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freqStart, startTime);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);

    mod.type = 'sine';
    mod.frequency.setValueAtTime(modFreq, startTime);
    modGain.gain.setValueAtTime(modDepth, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(gain).connect(this.masterGain);
    mod.start(startTime);
    carrier.start(startTime);
    mod.stop(startTime + duration + 0.02);
    carrier.stop(startTime + duration + 0.02);
  }

  _playNote(freq, startTime, duration, volume = 0.2, type = 'triangle', lowpassFreq = 0) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    if (lowpassFreq > 0) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lowpassFreq, startTime);
      osc.connect(lp).connect(gain).connect(this.masterGain);
    } else {
      osc.connect(gain).connect(this.masterGain);
    }

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  _playNoiseBurst(duration, filterFreq, volume = 0.14, startTime = this.ctx.currentTime, type = 'pink') {
    const src = this._noiseSource(type);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(1.4, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(filter).connect(gain).connect(this.masterGain);
    src.start(startTime, Math.random());
    src.stop(startTime + duration + 0.02);
  }
}
