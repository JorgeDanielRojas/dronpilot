// physics_drone.js — Modelo de vuelo ARCADE de un dron de juguete, fácil de manejar.
// Diseñado contra el spec de Jorge (Dron Pilot):
//  - Botón DESPEGAR: sube a "altura media" y al llegar se asienta con un sube-y-baja (overshoot amortiguado).
//  - Sólo tras asentarse se puede dirigir.
//  - Inercia: tiltear-adelante-y-MANTENER acelera con inercia hasta max speed; soltar → bamboleo y frena lento.
//  - Altitud AUTOMÁTICA (se mantiene en la altura media con un bob suave) → fácil, el usuario sólo dirige.
//  - La pila se agota; a 0 → se cae (crashed) y se desarma en pedazos (lo maneja main con debris).
//  - Cámara chase (main).
// Sin dependencias: matemática plana {x,y,z} → testeable en node. main.js mapea a THREE.
//
// Estados: 'idle' → 'takeoff' → 'flying' → ('crashed' | 'won')

const DRONE_TUNE = {
  midHeight: 2.6,        // altura media de vuelo (m sobre el punto de despegue)
  // --- despegue / altitud ---
  riseSpring: 9.0,       // rigidez del resorte de altitud (sube y se asienta)
  riseDamp: 3.2,         // amortiguación (bajo = más overshoot/rebote; da el "sube y baja un poco")
  settleEps: 0.05,       // |y-mid| y |vy| por debajo → asentado (habilita dirección)
  bobAmp: 0.045,         // bob suave en vuelo (respiración del hover)
  bobHz: 0.9,
  // --- avance (inercia) ---
  fwdAccel: 11.0,        // aceleración al mantener el stick adelante (terminal≈fwdAccel/drag > maxSpeed → toca el cap)
  maxSpeed: 7.5,         // max speed tipo dron (m/s)
  revFrac: 0.5,          // reversa (botón ▼) = fracción del max speed → más lenta y fácil que ir adelante
  drag: 1.35,            // fricción del aire → sin input frena lento (mayor = frena antes)
  // --- giro ---
  yawAccel: 5.0,         // respuesta de giro (suave)
  yawMax: 2.1,           // rad/s tope de giro
  yawDrag: 4.0,
  // --- tilt visual (se inclina hacia donde acelera) ---
  // Jorge 2026-07-09: "más exagerada hacia todos los lados, sobre todo adelante". REVERTIBLE:
  // los valores ORIGINALES van en el comentario; para volver atrás, restaurarlos.
  tiltMax: 0.62,         // (ORIGINAL 0.42) rad, inclinación máx pitch al ir a full — bajar a 0.42 revierte
  tiltLerp: 4.5,         // qué tan rápido el cuerpo alcanza la inclinación deseada
  rollFactor: 0.30,      // (ORIGINAL 0.18) roll lateral por giro — bajar a 0.18 revierte
  // --- bamboleo al soltar (wobble) ---
  wobbleAmp: 0.16,       // amplitud del bamboleo lateral al soltar el avance
  wobbleHz: 2.3,
  wobbleDecay: 2.2,
  // --- batería ---
  batterySec: 22,        // segundos de pila a consumo base (MITAD de antes, pedido Jorge 2026-07-09)
  batteryThrScale: 0.6,  // consumo extra proporcional al avance (acelerar gasta más)
  // --- rotores (visual) ---
  rotorIdleRPM: 22,      // rad/s de giro de hélice en idle
  rotorFullRPM: 60,      // a full throttle/despegue
};

class DronePhysics {
  constructor(tune) {
    this.t = Object.assign({}, DRONE_TUNE, tune || {});
    this.reset();
  }

  reset(startPos) {
    const p = startPos || { x: 0, y: 0, z: 0 };
    this.groundY = p.y;                 // y del punto de despegue (suelo local)
    this.pos = { x: p.x, y: p.y, z: p.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;                       // heading (rad); 0 = mira a -Z (adelante)
    this.yawVel = 0;
    this.speed = 0;                     // rapidez de avance escalar (m/s)
    this.tilt = 0;                      // inclinación pitch visual actual
    this.roll = 0;                      // inclinación roll visual actual (giro + wobble)
    this.state = 'idle';
    this.battery = 1;                   // 1..0
    this.rotorSpin = 0;                 // ángulo acumulado de las hélices (visual)
    this.rotorRPM = 0;
    this._settleT = 0;
    this._wobbleT = 999;               // tiempo desde que soltó el avance (grande = sin wobble)
    this._prevThr = 0;
    this.crashed = false;
    this.won = false;
    this.t0 = 0;                        // reloj interno
  }

  takeoff() {
    // Despegue INSTANTÁNEO y dirigible desde ya (Jorge: "no me gusta el periodo de espera").
    // Va directo a 'flying' → canSteer true de inmediato; el resorte de altitud lo sube a la altura
    // media mientras el jugador ya lo controla (sin el gate de asentado que antes hacía esperar).
    if (this.state === 'idle') { this.state = 'flying'; this._settleT = 0; }
  }

  crash() {
    if (this.state !== 'crashed' && this.state !== 'won') {
      this.state = 'crashed'; this.crashed = true;
    }
  }

  win() {
    if (this.state === 'flying') { this.state = 'won'; this.won = true; }
  }

  get airborne() { return this.state === 'takeoff' || this.state === 'flying'; }
  get canSteer() { return this.state === 'flying'; }

  // input: { thr:0..1 (mantener adelante), yaw:-1..1 (izq/der), takeoff:bool }
  update(dt, input) {
    dt = Math.min(dt, 0.05);           // clamp anti-explosión (paso lento no rompe)
    this.t0 += dt;
    const T = this.t;
    const inp = input || {};
    if (inp.takeoff) this.takeoff();
    // suelo de referencia bajo el dron (para escaleras/rampas): la altitud automática se mide sobre ESTO.
    // Sin escalera (niveles planos) inp.groundY viene nulo → usa el suelo del despegue.
    const gRef = (inp.groundY != null ? inp.groundY : this.groundY);

    if (this.state === 'crashed') {
      // caída con gravedad + tumbo, hasta tocar suelo
      this.vel.y -= 9.8 * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.pos.z += this.vel.z * dt;
      this.roll += 3.5 * dt; this.tilt += 2.0 * dt;
      this.rotorRPM *= (1 - 2 * dt);   // motores mueren
      this.rotorSpin += this.rotorRPM * dt;
      if (this.pos.y <= this.groundY) { this.pos.y = this.groundY; this.vel = { x: 0, y: 0, z: 0 }; }
      return;
    }
    if (this.state === 'won' || this.state === 'idle') {
      // idle: hélices quietas; won: se queda flotando
      const targetRPM = this.state === 'won' ? T.rotorIdleRPM : 0;
      this.rotorRPM += (targetRPM - this.rotorRPM) * Math.min(1, 6 * dt);
      this.rotorSpin += this.rotorRPM * dt;
      if (this.state === 'idle') return;
    }

    // ---- BATERÍA (sólo en vuelo/despegue) ----
    if (this.airborne) {
      const thr = this.state === 'flying' ? Math.abs(inp.thr || 0) : 1; // despegue consume a full (reversa gasta igual → abs)
      const drain = (1 + thr * T.batteryThrScale) / T.batterySec;
      this.battery = Math.max(0, this.battery - drain * dt);
      if (this.battery <= 0) { this.crash(); return; }
    }

    // ---- ALTITUD: resorte amortiguado hacia midHeight sobre el suelo de referencia (rampa/escalera) ----
    if (this.airborne) {
      const targetY = gRef + T.midHeight;
      const bob = this.state === 'flying'
        ? Math.sin(this.t0 * 2 * Math.PI * T.bobHz) * T.bobAmp : 0;
      const err = (targetY + bob) - this.pos.y;
      const ay = err * T.riseSpring - this.vel.y * T.riseDamp;
      this.vel.y += ay * dt;
      this.pos.y += this.vel.y * dt;

      // transición despegue → flying cuando se asienta cerca de la altura media
      if (this.state === 'takeoff') {
        const near = Math.abs(this.pos.y - targetY) < T.settleEps && Math.abs(this.vel.y) < T.settleEps * 6;
        if (near) { this._settleT += dt; if (this._settleT > 0.15) this.state = 'flying'; }
        else this._settleT = 0;
      }
    }

    // ---- ROTORES (visual): rpm sigue al esfuerzo ----
    const effort = this.state === 'takeoff' ? 1 : (0.35 + 0.65 * (this.state === 'flying' ? (inp.thr || 0) : 0));
    const targetRPM = T.rotorIdleRPM + (T.rotorFullRPM - T.rotorIdleRPM) * effort;
    this.rotorRPM += (targetRPM - this.rotorRPM) * Math.min(1, 8 * dt);
    this.rotorSpin += this.rotorRPM * dt;

    if (!this.canSteer) {
      // durante takeoff no se dirige; frena cualquier resto lateral
      this.vel.x *= (1 - Math.min(1, T.drag * dt));
      this.vel.z *= (1 - Math.min(1, T.drag * dt));
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      this._prevThr = 0;
      return;
    }

    // ================= VUELO DIRIGIBLE =================
    // thr en [-1,1]: +1 = adelante (botón ▲), -1 = reversa (botón ▼). La reversa es más lenta (revFrac).
    const thr = Math.max(-1, Math.min(1, inp.thr || 0));
    const yawIn = Math.max(-1, Math.min(1, inp.yaw || 0));

    // GIRO con inercia suave
    this.yawVel += (yawIn * T.yawMax - this.yawVel) * Math.min(1, T.yawAccel * dt);
    this.yawVel *= (1 - Math.min(1, T.yawDrag * dt) * (1 - Math.abs(yawIn))); // frena si no hay input
    this.yaw += this.yawVel * dt;

    // AVANCE con inercia: acelera al mantener; drag lo lleva a maxSpeed y frena al soltar.
    // speed puede ser NEGATIVO (reversa, tope = maxSpeed*revFrac).
    this.speed += (thr * T.fwdAccel) * dt;
    this.speed *= (1 - Math.min(1, T.drag * dt));           // fricción → terminal ~ fwdAccel*thr/drag
    const maxRev = -T.maxSpeed * (T.revFrac != null ? T.revFrac : 0.5);
    if (this.speed > T.maxSpeed) this.speed = T.maxSpeed;
    if (this.speed < maxRev) this.speed = maxRev;
    if (Math.abs(this.speed) < 0.001 && Math.abs(thr) < 0.001) this.speed = 0;

    // detectar SOLTAR el avance/reversa → arranca el bamboleo (wobble)
    if (Math.abs(this._prevThr) > 0.2 && Math.abs(thr) <= 0.05) this._wobbleT = 0;
    this._prevThr = thr;
    this._wobbleT += dt;

    // vector de avance según heading (0 = -Z)
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.vel.x = fx * this.speed;
    this.vel.z = fz * this.speed;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ---- TILT visual (pitch proporcional al avance con SIGNO: +adelante, −reversa; roll por giro + wobble) ----
    const wantTilt = (this.speed / T.maxSpeed) * T.tiltMax;
    this.tilt += (wantTilt - this.tilt) * Math.min(1, T.tiltLerp * dt);
    const wobble = Math.sin(this._wobbleT * 2 * Math.PI * T.wobbleHz) *
                   T.wobbleAmp * Math.exp(-this._wobbleT * T.wobbleDecay);
    const wantRoll = -this.yawVel * (T.rollFactor != null ? T.rollFactor : 0.18) + wobble;
    this.roll += (wantRoll - this.roll) * Math.min(1, 6 * dt);
  }
}

// export dual: node (test) + navegador (window)
if (typeof module !== 'undefined' && module.exports) module.exports = { DronePhysics, DRONE_TUNE };
if (typeof window !== 'undefined') { window.DronePhysics = DronePhysics; window.DRONE_TUNE = DRONE_TUNE; }
