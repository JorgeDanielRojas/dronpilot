// camera.js — 3 modos. GROUND = piloto parado en el campo (la vista real de RC):
// posición fija, sigue al avión girando, y el FOV se ajusta para que no se pierda de lejos.
import { PerspectiveCamera, Vector3, MathUtils } from '../vendor/three.module.js?v=1.39.0';

export class CameraRig {
  constructor(aspect) {
    this.cam = new PerspectiveCamera(45, aspect, 0.1, 4000);
    this.mode = 'chase';
    this.pilot = new Vector3(0, 1.6, 13);     // piloto cerca del centro de pista (visible en iPhone)
    this.frameR = 0.95;                        // radio de envolvente del avión (m)
    this.fill = 0.55;                          // fracción de ALTURA que ocupa el avión centrado (cerca)
    this.keep = 0.80;                          // el borde del avión nunca pasa de keep·(media pantalla) → margen
    this._tmp = new Vector3();
    this._look = new Vector3();
    this._dirP = new Vector3();
    this._dirL = new Vector3();
    this._chasePos = new Vector3();
    this._upT = new Vector3();
    this.cockpit = null;                       // config FPV por aeronave (main.js la setea)
  }

  setMode(m) { this.mode = m; }
  cycle() {
    const order = ['ground', 'chase', 'cockpit'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.mode;
  }

  update(plane, dt) {
    const p = plane.pos, q = plane.quat;
    if (this.mode === 'ground') {
      this.cam.position.copy(this.pilot);
      this.cam.up.set(0, 1, 0);
      // seguimiento PEGADO al avión (si saltó lejos por un reset, recolocar sin barrer)
      if (this._look.distanceTo(p) > 60) this._look.copy(p);
      this._look.lerp(p, 1 - Math.exp(-dt * 30));
      this.cam.lookAt(this._look);

      // GARANTÍA: el avión NUNCA sale de pantalla.
      // alpha = radio angular del avión. off = cuánto está descentrado (por el suavizado).
      const toP = this._tmp.copy(p).sub(this.pilot);
      const dist = Math.max(toP.length(), 1.5);
      const alpha = Math.atan(this.frameR / dist);
      this._dirP.copy(toP).normalize();
      this._dirL.copy(this._look).sub(this.pilot).normalize();
      const off = this._dirL.angleTo(this._dirP);
      // media-FOV vertical: (1) de cerca el avión ocupa ~fill de la altura; (2) su BORDE
      // (off+alpha) se queda dentro de keep·media → con margen, pase lo que pase.
      const halfV = Math.max(alpha / this.fill, (off + alpha) / this.keep);
      let target = MathUtils.clamp(MathUtils.radToDeg(2 * halfV), 20, 86);   // piso 20° → alto/lejos se ve más chico + más contexto (nubes/suelo = referencia de altura)
      // ABRIR: rápido pero SUAVE (sin el tirón de antes — saltaba hasta ~4°/frame y se sentía
      // como vibración al volar errático). Solo snap instantáneo si el avión está por salirse
      // (gap grande) → la garantía de "nunca sale de pantalla" se mantiene. CERRAR: lento.
      if (target > this.cam.fov) {
        const gap = target - this.cam.fov;
        this.cam.fov += gap > 12 ? gap : gap * (1 - Math.exp(-dt * 18));
      } else {
        this.cam.fov += (target - this.cam.fov) * (1 - Math.exp(-dt * 6));
      }
      this.cam.updateProjectionMatrix();
    } else if (this.mode === 'chase') {
      // detrás y arriba del avión, en su marco
      const back = this._tmp.set(-3.2, 0.9, 0).applyQuaternion(q).add(p);
      this._chasePos.lerp(back, 1 - Math.pow(0.0001, dt));
      this.cam.position.copy(this._chasePos);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(p);
      if (this.cam.fov !== 50) { this.cam.fov = 50; this.cam.updateProjectionMatrix(); }
    } else { // cockpit (FPV / vista interna). Ojo y punto de mira en el marco del avión (def.cockpit).
      const ck = this.cockpit || { ex: 0.02, ey: 0.19, lx: 3, ly: -0.4, fov: 74 };
      const eye = this._tmp.set(ck.ex, ck.ey, ck.ez || 0).applyQuaternion(q).add(p);
      this.cam.position.copy(eye);
      this.cam.up.copy(this._upT.set(0, 1, 0).applyQuaternion(q));   // "arriba" gira con el avión
      const fwd = this._look.set(ck.lx ?? 3, ck.ly ?? -0.4, 0).applyQuaternion(q).add(p);
      this.cam.lookAt(fwd);
      const fov = ck.fov || 74;
      if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    }
  }

  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }
}
