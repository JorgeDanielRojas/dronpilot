// debris.js — Despedazado al chocar: las partes reales del avión se sueltan, vuelan y caen.
// Usa scene.attach() para reparentar cada pieza al mundo conservando su posición/rotación exacta,
// luego les da velocidad + giro y las integra con gravedad + rebote en el suelo.
import { Vector3 } from '../vendor/three.module.js?v=1.39.0';

const G = 9.81;

export class Debris {
  constructor(scene) { this.scene = scene; this.parts = []; }

  // mesh = grupo de la aeronave (ya posicionado en el mundo). impactVel = velocidad al chocar.
  spawn(mesh, impactVel) {
    const kids = [...mesh.children];     // copia: scene.attach modifica children
    const imp = impactVel || new Vector3();
    for (const k of kids) {
      this.scene.attach(k);              // conserva la transform mundial de la pieza
      const v = new Vector3(
        (Math.random() - 0.5) * 7,
        Math.random() * 5 + 2.5,
        (Math.random() - 0.5) * 7,
      ).addScaledVector(imp, 0.25);
      const av = new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      this.parts.push({ o: k, v, av, rest: false });
    }
  }

  update(dt) {
    if (!this.parts.length) return;
    for (const p of this.parts) {
      if (p.rest) continue;
      p.v.y -= G * dt;
      p.o.position.addScaledVector(p.v, dt);
      p.o.rotation.x += p.av.x * dt; p.o.rotation.y += p.av.y * dt; p.o.rotation.z += p.av.z * dt;
      if (p.o.position.y < 0.05) {
        p.o.position.y = 0.05;
        p.v.y *= -0.32; p.v.x *= 0.6; p.v.z *= 0.6; p.av.multiplyScalar(0.5);
        if (p.v.length() < 0.6) { p.rest = true; }
      }
    }
  }

  clear() {
    for (const p of this.parts) this.scene.remove(p.o);
    this.parts = [];
  }
  get active() { return this.parts.length > 0; }
}
