// sound.js — Sonido de motor RC sintético (Web Audio) enrutado por un elemento <audio>.
// Al salir por un <audio> (vía MediaStream), el audio va por el CANAL DE MEDIOS de iOS:
//  · lo controla el VOLUMEN DE MEDIOS · el interruptor de silencio del iPhone NO lo calla
//  · el botón 🔇 de la app lo apaga (master gain a 0).
// Tono y volumen siguen al gas. Avión = whine de brushless · heli = thrum grave del rotor.
export class EngineSound {
  constructor() { this.ctx = null; this.on = true; this.type = 'plane'; }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.0;

    // motor: dos osciladores + filtro paso-bajo
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 2200;
    this.g1 = ctx.createGain(); this.g1.gain.value = 0.0;
    this.osc1.connect(this.g1); this.osc2.connect(this.g1); this.g1.connect(this.lp); this.lp.connect(this.master);

    // 3er oscilador (solo avión): saw ligeramente detunado del fundamental → "beat"/aspereza
    // de un brushless eléctrico (el motor nunca suena a tono puro). g3=0 en el heli.
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sawtooth';
    this.g3 = ctx.createGain(); this.g3.gain.value = 0.0;
    this.osc3.connect(this.g3); this.g3.connect(this.lp);
    // armónico agudo del whine (solo avión): square una octava arriba con su propio brillo
    this.oscW = ctx.createOscillator(); this.oscW.type = 'square';
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 1800;
    this.gW = ctx.createGain(); this.gW.gain.value = 0.0;
    this.oscW.connect(this.gW); this.gW.connect(this.hp); this.hp.connect(this.master);

    // ruido de la hélice / estela (paso-banda) = prop wash / flujo de aire
    const n = ctx.sampleRate * 1.0, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.nf = ctx.createBiquadFilter(); this.nf.type = 'bandpass'; this.nf.frequency.value = 1000; this.nf.Q.value = 0.6;
    this.ng = ctx.createGain(); this.ng.gain.value = 0.0;
    this.noise.connect(this.nf); this.nf.connect(this.ng); this.ng.connect(this.master);

    // SALIDA por el canal de medios: master → MediaStream → elemento <audio>.
    // Esto hace que el switch de silencio NO lo calle (modo "playback" de medios).
    if (ctx.createMediaStreamDestination) {
      const dest = ctx.createMediaStreamDestination();
      this.master.connect(dest);
      this.mediaEl = document.createElement('audio');
      this.mediaEl.playsInline = true; this.mediaEl.setAttribute('playsinline', '');
      this.mediaEl.autoplay = true;
      try { this.mediaEl.srcObject = dest.stream; } catch (e) { this.master.connect(ctx.destination); }
    } else {
      this.master.connect(ctx.destination);   // navegadores sin MediaStream → salida directa
    }

    this.osc1.start(); this.osc2.start(); this.osc3.start(); this.oscW.start(); this.noise.start();
    this._loadCrash();
  }

  // sonido de choque (woodhitsfx, Pixabay): se decodifica una vez al buffer
  _loadCrash() {
    if (this.crashBuf || this._crashLoading || !this.ctx) return;
    this._crashLoading = true;
    fetch('./audio/crash.mp3').then(r => r.arrayBuffer())
      .then(ab => this.ctx.decodeAudioData(ab))
      .then(buf => { this.crashBuf = buf; })
      .catch(() => { this._crashLoading = false; });
  }

  // dispara el choque (one-shot). Respeta el 🔇 de la app (this.on).
  playCrash() {
    if (!this.on || !this.ctx || !this.crashBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.crashBuf;
    const g = this.ctx.createGain(); g.gain.value = 1.0;
    src.connect(g); g.connect(this.master);
    if (this.ctx.state === 'suspended') this.ctx.resume();
    src.start();
  }

  // disparo del gunship: golpe seco sintetizado (ruido filtrado con envolvente rápida + thump)
  playShot() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (ctx.state === 'suspended') ctx.resume();
    // burst de ruido
    const n = (ctx.sampleRate * 0.18) | 0, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start();
    // thump grave
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const go = ctx.createGain(); go.gain.setValueAtTime(0.5, t); go.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(go); go.connect(this.master); o.start(t); o.stop(t + 0.15);
  }

  unlock() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.mediaEl) this.mediaEl.play().catch(() => {});
  }
  // pausa el audio al salir/cerrar la app (visibilitychange / pagehide)
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    if (this.mediaEl) this.mediaEl.pause();
  }
  setType(t) { this.type = t; if (this.nf) this.nf.type = (t === 'jet') ? 'highpass' : 'bandpass'; }   // jet = siseo de soplete
  toggle() { this.on = !this.on; return this.on; }    // 🔇 de la app

  update(thr) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, heli = this.type === 'heli', jet = this.type === 'jet';
    const k = this.on ? 1 : 0;
    // motor ELÉCTRICO: en gas 0 NO suena nada (sin ralentí). Gate suave 0→1 en el primer 3% de gas.
    // Se aplica SOLO a las capas del motor (no al master) → disparo y choque siguen oyéndose en gas 0.
    const gate = Math.min(1, thr / 0.03);
    const km = k * gate;
    if (heli) {
      // --- HELI (no tocar: ya está perfecto) ---
      const f = 40 + thr * 32;
      this.osc1.frequency.setTargetAtTime(f, t, 0.04);
      this.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.04);
      this.lp.frequency.setTargetAtTime(700 + thr * 2200, t, 0.06);
      this.g1.gain.setTargetAtTime((0.04 + thr * 0.14) * km, t, 0.05);
      this.ng.gain.setTargetAtTime((0.02 + thr * 0.11) * km, t, 0.05);
      this.g3.gain.setTargetAtTime(0, t, 0.05);                          // capas de avión apagadas
      this.gW.gain.setTargetAtTime(0, t, 0.05);
      this.master.gain.setTargetAtTime(0.9 * k, t, 0.05);
      return;
    }
    if (jet) {
      // --- TURBINA / SOPLETE: siseo de alta presión (ruido paso-alto) + rumble grave. Sin tonos de hélice. ---
      const f = 55 + thr * 70;
      this.osc1.frequency.setTargetAtTime(f, t, 0.05);                 // rumble grave de la turbina
      this.osc2.frequency.setTargetAtTime(f * 2, t, 0.05);
      this.lp.frequency.setTargetAtTime(360 + thr * 700, t, 0.06);     // el grave queda oscuro
      this.g1.gain.setTargetAtTime((0.03 + thr * 0.09) * km, t, 0.05); // rumble suave
      this.g3.gain.setTargetAtTime(0, t, 0.05);
      this.gW.gain.setTargetAtTime(0, t, 0.05);
      // siseo de soplete (mechero alta presión): ruido de banda ALTA, domina y sube fuerte con el gas
      this.nf.frequency.setTargetAtTime(1400 + thr * 4200, t, 0.05);
      this.nf.Q.setTargetAtTime(0.5, t, 0.05);
      this.ng.gain.setTargetAtTime((0.05 + thr * 0.45) * km, t, 0.05);
      this.master.gain.setTargetAtTime(0.95 * k, t, 0.05);
      return;
    }
    // --- AVIÓN: brushless eléctrico de 3D rico (whine + zumbido de hélice + aspereza/beat) ---
    // fundamental = "zumbido" de la hélice/prop wash (más grave); el whine del motor va arriba.
    const tau = 0.035;
    const f = 88 + thr * 360;                       // zumbido base sube con el gas (más natural, menos chillón)
    this.osc1.frequency.setTargetAtTime(f, t, tau);          // saw = cuerpo del zumbido
    this.osc2.frequency.setTargetAtTime(f * 2.0, t, tau);    // square = armónico
    this.osc3.frequency.setTargetAtTime(f * 1.012, t, tau);  // detune fino → beat/aspereza
    this.oscW.frequency.setTargetAtTime((900 + thr * 2600), t, tau); // whine agudo del motor (sube fuerte)
    // brillo: el paso-bajo abre con el gas (de oscuro en idle a brillante a fondo)
    this.lp.frequency.setTargetAtTime(900 + thr * 3200, t, 0.05);
    this.hp.frequency.setTargetAtTime(1600 + thr * 1200, t, 0.06);
    // prop wash: el ruido filtrado sobe de tono y volumen con el gas (flujo de aire)
    this.nf.frequency.setTargetAtTime(700 + thr * 2600, t, 0.05);
    this.nf.Q.setTargetAtTime(0.9, t, 0.05);
    // mezcla: idle vivo (zumbido suave audible) + sube con el gas
    this.g1.gain.setTargetAtTime((0.05 + thr * 0.13) * km, t, 0.05);     // cuerpo del zumbido
    this.g3.gain.setTargetAtTime((0.018 + thr * 0.05) * km, t, 0.05);    // aspereza/beat
    this.gW.gain.setTargetAtTime((0.006 + thr * 0.05) * km, t, 0.05);    // whine agudo
    this.ng.gain.setTargetAtTime((0.025 + thr * 0.12) * km, t, 0.05);    // flujo de aire
    this.master.gain.setTargetAtTime(0.9 * k, t, 0.05);
  }
}
