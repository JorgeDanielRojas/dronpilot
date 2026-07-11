// sticks3d.js — Sticks de mando en 3D REAL. El stick-end es una pieza TORNEADA:
// se modela por REVOLUCIÓN (LatheGeometry) calcando la silueta de la foto de referencia
// (shaft fino → cuello cónico → cuerpo con anillos moleteados → corona dentada arriba),
// en ALUMINIO PBR con un entorno de estudio NEUTRO (reflejo de metal real, NO del juego).
import {
  Scene, OrthographicCamera, Group, Mesh, MeshStandardMaterial,
  CylinderGeometry, TorusGeometry, BoxGeometry, LatheGeometry, Vector2, Vector3,
  DirectionalLight, AmbientLight, CanvasTexture, EquirectangularReflectionMapping, PMREMGenerator,
} from '../vendor/three.module.js?v=1.39.0';

export class Sticks3D {
  constructor(renderer) {
    this.scene = new Scene();

    // entorno NEUTRO (gris suave, sin colores ni escenario) → el aluminio refleja "estudio", no el juego
    const env = this._envTex();
    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromEquirectangular(env).texture;
    env.dispose(); pmrem.dispose();

    this.scene.add(new AmbientLight(0xffffff, 0.30));
    const key = new DirectionalLight(0xffffff, 1.4); key.position.set(2.5, 5, 4); this.scene.add(key);
    const fill = new DirectionalLight(0xdfe8f5, 0.5); fill.position.set(-3, 1.5, 3); this.scene.add(fill);

    this.left = this._buildStick();
    this.right = this._buildStick();
    this.scene.add(this.left.root, this.right.root);

    // CÁMARA CENITAL (vista de piloto mirando su emisora desde arriba):
    // casi vertical con leve inclinación → en reposo se ve SOLO la cabeza del stick.
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.cam.position.set(0, 10, 2.0);
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, 0, 0);
  }

  _envTex() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#f0f3f7'); g.addColorStop(0.5, '#aeb6c0'); g.addColorStop(1, '#3a4049');
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    const t = new CanvasTexture(c); t.mapping = EquirectangularReflectionMapping; return t;
  }

  // silueta del stick-end (radio, altura) — calcada de la foto
  _profile() {
    const p = []; const V = (r, y) => p.push(new Vector2(r, y));
    V(0.024, -0.80); V(0.032, -0.66); V(0.038, -0.52); V(0.042, -0.47);   // shaft fino
    V(0.072, -0.41); V(0.098, -0.355); V(0.114, -0.31);                    // cuello cónico
    // cuerpo con anillos moleteados (radio oscila → surcos de agarre)
    let y = -0.30;
    for (let i = 0; i < 9; i++) { V(0.132, y); V(0.132, y + 0.006); V(0.114, y + 0.014); V(0.114, y + 0.030); y += 0.046; }
    V(0.150, y + 0.01); V(0.172, y + 0.05); V(0.180, y + 0.10);            // hombro → flare de la corona
    V(0.176, y + 0.145); V(0.150, y + 0.175); V(0.085, y + 0.205); V(0.0, y + 0.215);  // labio + tope
    this._crownY = y + 0.10; this._crownR = 0.178;
    return p;
  }

  _buildStick() {
    const root = new Group();
    const dark = new MeshStandardMaterial({ color: 0x23282f, metalness: 0.9, roughness: 0.5, envMapIntensity: 0.9 });
    const steel = new MeshStandardMaterial({ color: 0xb8c0cb, metalness: 1.0, roughness: 0.32, envMapIntensity: 1.25 });
    // aluminio mecanizado: metalness alta, rugosidad media (reflejo suave, no espejo)
    const alu = new MeshStandardMaterial({ color: 0xc9d0d9, metalness: 1.0, roughness: 0.38, envMapIntensity: 1.2 });

    // gimbal/base (dish negro) — compacto: en cenital queda OCULTO tras la cabeza
    const base = new Mesh(new CylinderGeometry(0.15, 0.19, 0.12, 40), dark); base.position.y = -0.74; root.add(base);
    const ring = new Mesh(new TorusGeometry(0.135, 0.04, 14, 40), steel); ring.rotation.x = Math.PI / 2; ring.position.y = -0.66; root.add(ring);

    // pivote = TODO el stick (gira con el input)
    const piv = new Group(); piv.position.y = -0.7; root.add(piv);
    const lathe = new Mesh(new LatheGeometry(this._profile(), 64), alu);
    lathe.position.y = 0.7; lathe.castShadow = true; piv.add(lathe);   // sube para que el shaft entre al gimbal

    // corona dentada: anillo de dientes en el labio superior
    const tg = new BoxGeometry(0.05, 0.085, 0.05);
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const t = new Mesh(tg, alu);
      t.position.set(Math.cos(a) * this._crownR, 0.7 + this._crownY, Math.sin(a) * this._crownR);
      t.rotation.y = -a; t.rotation.x = 0.32;   // se abren hacia afuera
      piv.add(t);
    }

    // la inclinación visual la da la cámara cenital → el stick queda vertical
    return { root, piv };
  }

  resize(w, h) {
    const asp = w / h;
    this.cam.left = -asp; this.cam.right = asp; this.cam.top = 1; this.cam.bottom = -1;
    this.cam.updateProjectionMatrix();
    const margin = Math.min(0.85, asp * 0.42);
    const s = 0.86;
    const zv = 0.45;   // empuja los sticks hacia abajo en pantalla (eje Z bajo cámara cenital)
    this.left.root.position.set(-asp + margin, 0, zv);
    this.right.root.position.set(asp - margin, 0, zv);
    this.left.root.scale.setScalar(s); this.right.root.scale.setScalar(s);
  }

  render(renderer, lx, ly, rx, ry) {
    // Bajo la cámara cenital, +Z mundo = ABAJO en pantalla → el eje vertical (ly/ry)
    // va NEGADO para que empujar arriba mueva la cabeza arriba (sigue al dedo).
    const T = 0.6;
    this.left.piv.rotation.set(-ly * T, 0, -lx * T);
    this.right.piv.rotation.set(-ry * T, 0, -rx * T);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.autoClear = true;
  }

  // TEST DE SENTIDO: proyecta la CABEZA del stick a NDC (-1..1) usando la cámara real.
  // side: 'left' | 'right'. Devuelve {x,y}: x>0 = derecha en pantalla, y>0 = arriba.
  // El test de regresión asegura: empujar el dedo → la cabeza va al mismo lado.
  headNDC(side) {
    const stick = side === 'right' ? this.right : this.left;
    stick.piv.updateWorldMatrix(true, false);
    const v = new Vector3(0, 0.7 + this._crownY, 0).applyMatrix4(stick.piv.matrixWorld);
    v.project(this.cam);
    return { x: v.x, y: v.y };
  }
}
