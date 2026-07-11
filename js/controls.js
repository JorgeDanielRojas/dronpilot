// controls.js — 3 modos de control que producen el mismo input {thr, yaw, takeoff}.
//  - 'touch': 3 botones en pantalla (◀ ▶ girar + ACELERAR mantener). Recomendación del research: sin joystick.
//  - 'keys' : teclado tipo Minecraft (W/↑ acelerar, A/D o ←/→ girar, S/↓ freno suave, Espacio despegar).
//  - 'tilt' : inclinación del teléfono (adelante = acelerar, izq/der = girar). Modo secundario (patrón Pingüino).
// La ALTITUD es automática → no hay control de subir/bajar. `thr` es "avanzar" (mantener).

(function () {
  class Controls {
    constructor(opts) {
      this.mode = (opts && opts.mode) || 'keys';
      this.thr = 0; this.yaw = 0; this._takeoff = false;
      this.keys = {};
      this.tilt = { thr: 0, yaw: 0 };
      this.tiltRef = { fwd: 0, side: 0 };    // neutro (centro); se CALIBRA al despegar a la orientación actual
      this._tiltRaw = { fwd: 0, side: 0 };
      this._needCalib = false;
      this.tiltReady = false;
      this._touch = { left: false, right: false, accel: false, back: false };
      this._bindKeys();
    }

    setMode(m) { this.mode = m; this.thr = 0; this.yaw = 0; this.keys = {}; this._touch = { left: false, right: false, accel: false, back: false }; }

    // -------- teclado --------
    _bindKeys() {
      const down = e => {
        this.keys[e.code] = true;
        if (e.code === 'Space') { this._takeoff = true; e.preventDefault(); }
      };
      const up = e => { this.keys[e.code] = false; };
      const clear = () => { this.keys = {}; this.thr = 0; this.yaw = 0; };  // perder foco no deja teclas pegadas
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      window.addEventListener('blur', clear);
      document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    }

    // -------- botones en pantalla (los cablea main con los elementos DOM) --------
    bindTouch(elLeft, elRight, elAccel, elBack) {
      const hold = (el, key) => {
        if (!el) return;
        const on = e => { this._touch[key] = true; e.preventDefault(); };
        const off = e => { this._touch[key] = false; e.preventDefault(); };
        el.addEventListener('pointerdown', on);
        el.addEventListener('pointerup', off);
        el.addEventListener('pointerleave', off);
        el.addEventListener('pointercancel', off);
      };
      hold(elLeft, 'left'); hold(elRight, 'right'); hold(elAccel, 'accel'); hold(elBack, 'back');
    }

    // -------- inclinación (iOS: pedir permiso dentro del gesto en main) --------
    enableTilt() {
      if (this.tiltReady) return;
      this.tiltReady = true;
      window.addEventListener('deviceorientation', e => {
        if (e.beta == null) return;
        const a = (window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
        // apaisado (90 y 270/-90): gamma = "adelante", beta = "lado"; el signo se invierte en la otra.
        const land = (a === 90 || a === -90 || a === 270);
        let fwd, side;
        if (land) { fwd = (a === 90 ? e.gamma : -e.gamma); side = (a === 90 ? e.beta : -e.beta); }
        else { fwd = e.beta; side = e.gamma; }
        this._tiltRaw = { fwd, side };
        if (this._needCalib) { this.tiltRef = { fwd, side }; this._needCalib = false; }   // fija el centro
        const dfwd = fwd - this.tiltRef.fwd, dside = side - this.tiltRef.side;
        // adelante = inclinar el tope del teléfono lejos del centro → thr>0; atrás = inclinar hacia ti → thr<0 (reversa). Zona muerta a ambos lados.
        const dz = 5;
        const fwdMag = dfwd > dz ? (dfwd - dz) : (dfwd < -dz ? (dfwd + dz) : 0);
        this.tilt.thr = Math.max(-1, Math.min(1, fwdMag / 28));
        this.tilt.yaw = Math.max(-1, Math.min(1, (Math.abs(dside) > dz ? (dside - Math.sign(dside) * dz) : 0) / 26));
      });
    }
    // CALIBRAR: el próximo evento de orientación fija el neutro a como está el teléfono AHORA (al despegar).
    calibrateTilt() { this._needCalib = true; this.tiltRef = { fwd: this._tiltRaw.fwd, side: this._tiltRaw.side }; }

    // -------- lectura por frame --------
    update() {
      let thr = 0, yaw = 0;
      if (this.mode === 'keys') {
        const k = this.keys;
        if (k['KeyW'] || k['ArrowUp']) thr = 1;
        else if (k['KeyS'] || k['ArrowDown']) thr = -1;  // reversa (tipo Minecraft: S retrocede)
        if (k['KeyA'] || k['ArrowLeft']) yaw -= 1;
        if (k['KeyD'] || k['ArrowRight']) yaw += 1;
      } else if (this.mode === 'touch') {
        if (this._touch.accel) thr = 1;
        else if (this._touch.back) thr = -1;             // botón ▼ = reversa
        if (this._touch.left) yaw -= 1;
        if (this._touch.right) yaw += 1;
      } else if (this.mode === 'tilt') {
        thr = this.tilt.thr; yaw = this.tilt.yaw;
      }
      // suavizado leve del yaw para que no sea brusco (curvas fáciles)
      this.thr = thr;
      this.yaw = yaw;
      return { thr: this.thr, yaw: this.yaw };
    }

    consumeTakeoff() { const t = this._takeoff; this._takeoff = false; return t; }
    triggerTakeoff() { this._takeoff = true; }
  }

  window.Controls = Controls;
})();
