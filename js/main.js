// main.js — Orquestador de Dron Pilot. Junta Three + dron GLB + física + controles + casa + audio.
// Estados de juego: 'pre' (pantalla previa) → 'ready' (en piso, esperar DESPEGAR) → 'fly' → ('win'|'lose').
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const VERSION = '0.8.6';   // v= para deploy/guard
const $ = s => document.querySelector(s);
const DRONE_R = 0.30;      // radio de colisión del dron (esfera)
const PICKUP_R = 0.75;     // radio para recolectar un punto
// persistencia (namespace dron_* — 2 productos por origen no colisionan)
const LS = {
  get(k, d) { try { const v = localStorage.getItem('dron_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dron_' + k, JSON.stringify(v)); } catch (e) {} },
};

// ---------- Three base ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // sombras = la señal nº1 de PROXIMIDAD (pedido Jorge)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8dcc8);      // aire cálido del CUARTO GIGANTE (ya no azul indefinido)
scene.fog = new THREE.Fog(0xe8dcc8, 26, 88);       // niebla lejos: el exterior (piso/bloques/paredes gigantes) se LEE
const cam = new THREE.PerspectiveCamera(62, 1, 0.05, 200);
cam.position.set(0, 3, 8);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9a8a73, 1.5); scene.add(hemi);
const amb = new THREE.AmbientLight(0xfff6ea, 0.4); scene.add(amb);   // piso de luz: NINGUNA zona negra (Jorge)

const sun = new THREE.DirectionalLight(0xfff2df, 1.25);
sun.position.set(6, 12, 5); scene.add(sun); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.002;
sun.shadow.intensity = 0.2;   // sombras MUY suaves (20% — pedido Jorge), todo bien iluminado
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 34 }); sun.shadow.camera.updateProjectionMatrix();
const fill = new THREE.DirectionalLight(0xdde8ff, 0.6);   // relleno frío: ilumina el lado oscuro (heli negro)
fill.position.set(-6, 7, -4); scene.add(fill);

function resize() {
  // PWA standalone iOS: innerHeight miente al lanzar/rotar (franja abajo) → visualViewport manda
  const vv = window.visualViewport;
  const w = Math.round((vv && vv.width) || innerWidth), h = Math.round((vv && vv.height) || innerHeight);
  renderer.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix();
  const wantRot = h > w && w < 820;
  $('#rotate').classList.toggle('want', wantRot);
}
addEventListener('resize', resize);
if (window.visualViewport) visualViewport.addEventListener('resize', resize);
addEventListener('orientationchange', () => { resize(); setTimeout(resize, 350); setTimeout(resize, 900); });   // iOS reporta tarde
setTimeout(resize, 400); resize();

// ---------- estado ----------
const phys = new window.DronePhysics();
const controls = new window.Controls({ mode: LS.get('ctl', 'touch') });
// Tune por nave: el coaxial es el MÁS FÁCIL de RC → más lento, flotante, giro suave, pila más larga.
const CRAFT_TUNE = {
  drone: {},
  coax: { maxSpeed: 6.0, fwdAccel: 8.6, drag: 1.5, yawMax: 1.7, yawAccel: 4.0, tiltMax: 0.46, rollFactor: 0.30, wobbleAmp: 0.2, riseDamp: 3.6, batterySec: 28, rotorIdleRPM: 18, rotorFullRPM: 46 },
};
// giro (rad) que pone la NARIZ del modelo mirando a −Z (dirección de vuelo). Se calibra con render.
const _AXY = new THREE.Vector3(0, 1, 0);
const CRAFT_YAW = { drone: 0, coax: Math.PI };   // coax venía mirando ATRÁS (volaba de espaldas) → 180°
let house = null, drone = null, rotors = [], craft = LS.get('craft', 'drone'), levelIdx = 0, loadGen = 0;
let state = 'pre', flightHeight = 2.5, tPrev = performance.now(), debris = [], fx = [];
let _postWinCrashed = false;   // choque cosmético permitido UNA vez tras ganar (el dron no es invencible)
let sound = LS.get('snd', true);
let ghost = LS.get('ghost', false);   // modo PRUEBA: no deja marca en el leaderboard global
// cronómetro (objetivo secundario) + leaderboard por nivel
let levelStartT = 0, levelTime = 0, playerName = LS.get('name', '');

// ---------- wallpaper de los muros ----------
// Un archivo por nivel (Jorge elige el estilo). Se aplica con repeat según el tamaño del muro
// (tile ~1.3 m) para que el patrón repita a un ritmo constante y parejo.
// PLACEHOLDER (Jorge: "están rancios, luego los mejoramos") — provisional por nivel, se reemplaza después.
// wallpapers NUEVOS minimalistas (2 colores, suaves, tileables) — reemplazan los "rancios"
const WALLPAPER = ['img/wpA.png', 'img/wpB.png', 'img/wpC.png', 'img/wpD.png', 'img/wpE.png'];
const TILE_M = 1.3;
const texLoader = new THREE.TextureLoader();
function applyWallpaper(url) {
  if (!url || !house) return;
  const h = house;                                  // capturar: una carga tardía no debe pintar otro nivel
  texLoader.load(url, base => {
    if (h !== house) { base.dispose(); return; }     // el nivel cambió mientras cargaba → descartar
    base.colorSpace = THREE.SRGBColorSpace;
    h.walls.forEach(w => {
      const p = w.geometry.parameters;              // {width,height,depth}
      const horiz = Math.max(p.width, p.depth);
      const t = base.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, Math.round(horiz / TILE_M)), Math.max(1, Math.round(p.height / TILE_M)));
      w.material.map = t; w.material.color.set(0xffffff); w.material.needsUpdate = true;
    });
  }, undefined, () => {});
}

// ---------- carga de la nave (GLB) ----------
const loader = new GLTFLoader();
function loadCraft(kind) {
  const url = kind === 'coax' ? 'models/simulus_heli.glb' : 'models/drone.glb';
  const targetLen = kind === 'coax' ? 0.9 : 0.55;   // tamaño real dentro de la casa (m)
  const gen = ++loadGen;                            // generación: descarta cargas obsoletas (reconstrucción rápida)
  const holder = new THREE.Group();                 // se puebla async; física no depende de la malla
  const tiltPivot = new THREE.Group();              // hijo que recibe pitch/roll visual
  holder.add(tiltPivot);
  loader.load(url, (gltf) => {
    if (gen !== loadGen) { disposeGroup(gltf.scene); return; }   // el nivel/nave cambió mientras cargaba
    const m = gltf.scene;
    // escala por la dimensión horizontal más larga
    const box = new THREE.Box3().setFromObject(m); const size = new THREE.Vector3(); box.getSize(size);
    const horiz = Math.max(size.x, size.z) || 1;
    const s = targetLen / horiz; m.scale.setScalar(s);
    // centrar en el origen del holder
    const box2 = new THREE.Box3().setFromObject(m); const c = new THREE.Vector3(); box2.getCenter(c);
    m.position.sub(c);
    // ORIENTAR: girar el modelo para que su NARIZ mire hacia adelante (−Z = dirección de vuelo)
    m.rotation.y = CRAFT_YAW[kind] || 0;
    // rotores: SOLO los pivotes de hélice (no las mallas hijas '_Material_0' → si giro ambos se cancelan)
    const RX = /prop|rotor|blade|helice|hélice/i;
    rotors = [];
    m.traverse(o => {
      if (!RX.test(o.name) || /material/i.test(o.name)) return;
      if (o.parent && RX.test(o.parent.name) && !/material/i.test(o.parent.name)) return; // ya tomamos el pivote padre
      rotors.push(o);
    });
    // sentido: quad = diagonal (hélices pares/impares opuestas); coaxial = los 2 rotores apilados CONTRARROTAN
    rotors.forEach((r, i) => {
      const num = (r.name.match(/(\d+)/) || [])[1];
      r.userData.spinDir = kind === 'coax' ? (i % 2 === 0 ? 1 : -1) : (num && (+num % 2 === 0) ? -1 : 1);
    });
    // REPINTAR el coaxial de amarillo tipo Blade (cuerpo amarillo, rotores/palas oscuros)
    if (kind === 'coax') {
      m.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const isRotor = /prop|rotor|blade|helice|hélice/i.test(o.name);
        mats.forEach(mt => {
          if (!mt.color) return;
          if (mt.transparent && mt.opacity < 0.9) { mt.color.setHex(0xcfe8f5); mt.opacity = Math.max(mt.opacity, 0.45); mt.needsUpdate = true; return; }   // cabina CLARA (estaba muy negra)
          if (isRotor) { mt.color.setHex(0x2b2b2b); mt.metalness = 0.2; }
          else { mt.color.setHex(0xffcf1e); mt.metalness = 0.05; mt.roughness = 0.55; } // amarillo juguete
          mt.needsUpdate = true;
        });
      });
    }
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });   // la nave PROYECTA sombra (cue de altura)
    tiltPivot.add(m);
    // EJE DE GIRO por rotor: el eje LOCAL que corresponde a la VERTICAL del mundo (un pivote del GLB
    // puede venir con ejes girados → rotateY a secas lo hace girar VERTICAL; caso propela, Jorge).
    holder.updateMatrixWorld(true);
    const _wq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
    rotors.forEach(r => { r.getWorldQuaternion(_wq); r.userData.spinAxis = _up.clone().applyQuaternion(_wq.clone().invert()).normalize(); });
    holder.userData.model = m;
  }, undefined, (err) => {
    // fallback: caja simple si el GLB no carga (nunca deja el juego sin nave)
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    tiltPivot.add(b);
    console.warn('GLB no cargó, uso caja', err);
  });
  holder.userData.tilt = tiltPivot;
  return holder;
}

// Altura de vuelo EFECTIVA: sobre un piso ALTO hay menos aire hasta el techo → volar a ~45% del
// espacio libre local (mín 0.7 m) en vez de la altura plana. Sin esto, arriba el dron quedaba
// "pegado al techo" (bug Jorge 2026-07-10: "no cae en el nivel de vuelo correcto, queda más alto").
function effFH(x, z) {
  if (!house) return flightHeight;
  const t = house.terrainY ? house.terrainY(x, z) : 0;
  return Math.min(flightHeight, Math.max(0.7, (house.ceilingY - t) * 0.45));
}

// ---------- construir / reiniciar nivel ----------
function buildLevel(idx) {
  stopLoop();                                                    // corta el zumbido de vuelo al reconstruir
  if (house) { scene.remove(house.group); disposeGroup(house.group); }
  clearDebris();
  house = window.buildHouse(THREE, scene, idx);
  // altura de crucero = media sala real (o override del nivel, p.ej. la escalera)
  flightHeight = house.flightHeight != null ? house.flightHeight : Math.min(house.ceilingY - 1.0, Math.max(1.3, house.ceilingY * 0.45));
  phys.t = Object.assign({}, window.DRONE_TUNE, CRAFT_TUNE[craft] || {});   // tune de la nave activa
  phys.t.midHeight = flightHeight - house.floorY;
  // meta + puntos a la altura de vuelo SOBRE EL TERRENO local (la escalera sube la meta/puntos de arriba)
  const terr = (x, z) => house.terrainY ? house.terrainY(x, z) : 0;
  const goalY = terr(house.goal.pos.x, house.goal.pos.z) + effFH(house.goal.pos.x, house.goal.pos.z);
  house.goal.pos.y = goalY; house.goal.mesh.position.y = goalY;
  house.collectibles.forEach(c => { const y = terr(c.pos.x, c.pos.z) + effFH(c.pos.x, c.pos.z); c.pos.y = y; c.mesh.position.y = y; });
  setGoalUnlocked(house.collectibles.length === 0);   // sin puntos → meta ya abierta
  updatePts();
  applyWallpaper(WALLPAPER[idx % WALLPAPER.length]);                            // wallpaper en los muros (cicla en 10 niveles)
  if (drone) { scene.remove(drone); disposeGroup(drone); }      // libera GPU del dron viejo (fuga cazada por review)
  drone = loadCraft(craft);
  scene.add(drone);
  phys.reset({ x: house.start.x, y: house.floorY, z: house.start.z });
  drone.position.set(house.start.x, house.floorY, house.start.z);
  camYaw = 0;
  state = 'ready';
  _lowWarned = false; _postWinCrashed = false;
  if (typeof _zonePtrs !== 'undefined') { _zonePtrs.clear(); controls._touch.left = controls._touch.right = controls._touch.accel = controls._touch.back = false; }
  $('#levelName').textContent = 'Nivel ' + (idx + 1) + ' · ' + house.name;
  $('#touch').classList.add('hidden');
  $('#timer').classList.add('hidden');
  showBanner('', 'Toca para despegar');       // sin botón: toca la pantalla para volar
  setTapLayer();
  updateBattery();
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];
function disposeMat(mm) { TEX_SLOTS.forEach(s => { if (mm[s] && mm[s].dispose) mm[s].dispose(); }); mm.dispose(); }
function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat); }); }
function disposeMesh(m) { if (m.geometry) m.geometry.dispose(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(disposeMat); }
function clearDebris() { debris.forEach(d => { scene.remove(d.mesh); disposeMesh(d.mesh); }); debris = []; fx.forEach(f => { scene.remove(f.mesh); disposeMesh(f.mesh); }); fx = []; }

// ---------- efecto de despegue (soplo de polvo + anillo que se expande) ----------
function spawnTakeoffPuff(x, y, z) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.32, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.03, z); scene.add(ring);
  fx.push({ mesh: ring, life: 0, dur: 0.75, grow: 3.2 });
  for (let i = 0; i < 8; i++) {   // motitas de polvo
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xf3e9d4, transparent: true, opacity: 0.7, depthWrite: false }));
    p.position.set(x, y + 0.05, z); scene.add(p);
    const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.1;
    fx.push({ mesh: p, life: 0, dur: 0.6, v: { x: Math.cos(a) * sp, y: 0.4 + Math.random() * 0.5, z: Math.sin(a) * sp } });
  }
}
function stepFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life += dt; const k = f.life / f.dur;
    if (f.grow) { const s = 1 + k * f.grow; f.mesh.scale.set(s, s, s); f.mesh.material.opacity = 0.55 * (1 - k); }
    if (f.v) {
      f.mesh.position.x += f.v.x * dt; f.mesh.position.y += f.v.y * dt; f.mesh.position.z += f.v.z * dt;
      f.v.y -= (f.confetti ? 0.5 : 1.5) * dt;
      f.mesh.material.opacity = f.confetti ? 0.95 * Math.min(1, (1 - k) * 2.5) : 0.7 * (1 - k);
    }
    if (f.w) { f.mesh.rotation.x += f.w.x * dt; f.mesh.rotation.y += f.w.y * dt; f.mesh.rotation.z += f.w.z * dt; }
    if (k >= 1) { scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); fx.splice(i, 1); }
  }
}

// ---------- estallidos / confeti / sonidos sintéticos ----------
function popBurst(x, y, z, color) {
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    p.position.set(x, y, z); scene.add(p);
    const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.2;
    fx.push({ mesh: p, life: 0, dur: 0.5, v: { x: Math.cos(a) * sp, y: 0.5 + Math.random() * 1.8, z: Math.sin(a) * sp } });
  }
}
function robotShake(m) {
  if (!m) return; const x0 = m.position.x, z0 = m.position.z; let n = 0;
  const iv = setInterval(() => { m.position.x = x0 + (Math.random() * 2 - 1) * 0.07; m.position.z = z0 + (Math.random() * 2 - 1) * 0.07; if (++n > 12) { clearInterval(iv); m.position.x = x0; m.position.z = z0; } }, 40);
}
function spawnConfetti() {
  const cols = [0xff5a5a, 0x5ac8ff, 0xffd23f, 0x6cd86c, 0xff7ac0, 0xffffff];
  const top = house ? house.ceilingY - 0.1 : 3;
  for (let i = 0; i < 64; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true, opacity: 0.96, depthWrite: false }));
    p.position.set(phys.pos.x + (Math.random() * 2 - 1) * 2.2, top, phys.pos.z + (Math.random() * 2 - 1) * 2.2);
    p.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); scene.add(p);
    fx.push({ mesh: p, life: 0, dur: 2.4, confetti: true, v: { x: (Math.random() * 2 - 1) * 0.5, y: -0.5 - Math.random() * 0.5, z: (Math.random() * 2 - 1) * 0.5 }, w: { x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 } });
  }
}
function synthPop(g = 1) {
  if (!AC || !sound) return; const o = AC.createOscillator(), ga = AC.createGain(); o.type = 'triangle';
  o.frequency.setValueAtTime(900, AC.currentTime); o.frequency.exponentialRampToValueAtTime(160, AC.currentTime + 0.12);
  ga.gain.setValueAtTime(0.25 * g, AC.currentTime); ga.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.17);
  o.connect(ga).connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.19);
}
function synthWin() {
  if (!AC || !sound) return; [523, 659, 784, 1047].forEach((f, i) => {
    const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.value = f;
    const t = AC.currentTime + i * 0.11; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 0.26);
  });
}
function synthBeep() {
  if (!AC || !sound) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = 'square'; o.frequency.value = 660;
  g.gain.setValueAtTime(0.14, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.12);
  o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.13);
}

// ---------- explosión en pedazos ----------
function explode(pos) {
  const cols = [0xff5a5a, 0x5ac8ff, 0xffd23f, 0x6cd86c, 0xffffff, 0x333333];
  for (let i = 0; i < 14; i++) {
    const sz = 0.05 + Math.random() * 0.09;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: .7 }));
    m.position.set(pos.x, pos.y, pos.z); scene.add(m);
    const a = Math.random() * Math.PI * 2, up = 2 + Math.random() * 3.5, sp = 1.5 + Math.random() * 3;
    debris.push({ mesh: m, v: { x: Math.cos(a) * sp, y: up, z: Math.sin(a) * sp }, w: { x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 }, life: 0 });
  }
}
// DESPIECE REAL: parte el dron en SUS mallas reales (rotores, brazos, cuerpo del GLB), no cubos genéricos.
const _pv = new THREE.Vector3(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3();
function explodeReal(pos) {
  const model = drone && drone.userData.model;
  if (!model) { explode(pos); return; }               // fallback genérico si el GLB aún no cargó
  const meshes = [];
  model.updateWorldMatrix(true, true);
  model.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
  if (!meshes.length) { explode(pos); return; }
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, true);
    mesh.matrixWorld.decompose(_pv, _pq, _ps);
    scene.attach(mesh);                                // saca la malla a la escena conservando su transform world
    let dx = _pv.x - pos.x, dz = _pv.z - pos.z;
    if (dx * dx + dz * dz < 0.0004) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const sp = 1.4 + Math.random() * 2.6, up = 2.2 + Math.random() * 3.2;
    debris.push({ mesh, v: { x: dx * sp, y: up, z: dz * sp }, w: { x: (Math.random() * 2 - 1) * 9, y: (Math.random() * 2 - 1) * 9, z: (Math.random() * 2 - 1) * 9 }, life: 0 });
  }
  rotors = [];                                          // las mallas ya no están en el dron
  // un poco de chispas para acentuar el golpe
  popBurst(pos.x, pos.y, pos.z, 0xffe08a);
}

// ¿una PIEZA (esfera chica R) toca pared/objeto? — mismos colliders del mundo, radio de pieza
function debrisHit(x, y, z, R) {
  if (!house) return null;
  let h = window.hitColliders(house.colliders, x, y, z, R);
  if (h) return h;
  if (house.movers) for (const m of house.movers) { h = window.hitColliders(m.colliders, x, y, z, R); if (h) return h; }
  return null;
}
function stepDebris(dt) {
  const R = 0.07, REST = 0.45;   // radio de pieza · restitución del rebote
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.life += dt; d.v.y -= 9.8 * dt;
    const p = d.mesh.position;
    // REBOTE contra paredes/objetos (Jorge 2026-07-11): probar el paso POR EJE y reflejar el eje que choca
    const nx = p.x + d.v.x * dt, ny = p.y + d.v.y * dt, nz = p.z + d.v.z * dt;
    if (debrisHit(nx, p.y, p.z, R)) { d.v.x *= -REST; d.w.y *= -0.7; } else p.x = nx;
    if (debrisHit(p.x, ny, p.z, R)) { d.v.y *= -REST; d.v.x *= 0.75; d.v.z *= 0.75; } else p.y = ny;
    if (debrisHit(p.x, p.y, nz, R)) { d.v.z *= -REST; d.w.x *= -0.7; } else p.z = nz;
    if (p.y < 0.03) { p.y = 0.03; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; }   // piso
    d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.y += d.w.y * dt;
    // ⭐ GOL DE MUERTO (Jorge 2026-07-11): si una PIEZA del despiece toca la meta (ya desbloqueada)
    // después de chocar → el nivel VALE, con logro especial (único mensaje que existe en el juego).
    if (state === 'lose' && house && !house._deadWin && pointsLeft() === 0) {
      const g = house.goal.pos, gx = p.x - g.x, gy = p.y - g.y, gz = p.z - g.z;
      if (gx * gx + gy * gy + gz * gz < 0.75 * 0.75) {
        house._deadWin = true; state = 'win';
        house.goal.mesh.visible = false; popBurst(g.x, g.y, g.z, 0xffd23f);
        synthWin();
        const bn = $('#banner'); $('#bTitle').textContent = '☠️🏁 ¡GOL DE MUERTO!'; $('#bHint').textContent = 'La pieza llegó por ti · Toca para seguir'; $('#bBoard').innerHTML = ''; bn.classList.remove('hidden');
        LS.set('ach_deadgoal', true);
        setTapLayer();
      }
    }
    if (d.life > 2.4) { scene.remove(d.mesh); disposeMesh(d.mesh); debris.splice(i, 1); }
  }
}

// ---------- colisión dron (esfera) vs FORMAS reales (box/sphere/cyl) — delega en el módulo puro ----------
// Precisa: sólo choca si toca la forma real del objeto, no su caja envolvente (p.ej. pasa al lado del
// poste fino de la lámpara). Muros/techo = AABB exacto; obstáculos = compuestos por sub-formas.
function hitWorld(p) {
  let h = window.hitColliders(house.colliders, p.x, p.y, p.z, DRONE_R);
  if (h) return h;
  if (house.movers) for (const m of house.movers) { h = window.hitColliders(m.colliders, p.x, p.y, p.z, DRONE_R); if (h) return h; }   // obstáculos con movimiento (posición viva)
  return null;
}

// puntos que faltan por recolectar
function pointsLeft() { return house ? house.collectibles.filter(c => !c.taken).length : 0; }
function updatePts() {
  const el = $('#pts'); if (!el) return;
  const total = house ? house.collectibles.length : 0;
  if (!total) { el.classList.add('hidden'); return; }
  const got = total - pointsLeft();
  el.classList.remove('hidden');
  $('#ptsN').textContent = got + '/' + total;
  el.classList.toggle('done', got === total);
}
// meta bloqueada (gris) hasta juntar todos los puntos; al desbloquear se pone verde brillante
function setGoalUnlocked(un) {
  if (!house || !house.goal.ring) return;
  house.goal.ring.material.color.setHex(un ? 0x33ff99 : 0x8a8f98);
  house.goal.ring.material.emissive.setHex(un ? 0x22cc77 : 0x44484f);
  house.goal.core.material.color.setHex(un ? 0xccffe6 : 0xd7dbe0);
  house.goal.core.material.emissive.setHex(un ? 0x66ffaa : 0x777c84);
}
function collectPoint(c) {
  c.taken = true; c.mesh.visible = false;
  popBurst(c.pos.x, c.pos.y, c.pos.z, 0xffd23f);
  synthPickup();
  updatePts();
  if (pointsLeft() === 0) setGoalUnlocked(true);
}
function synthPickup() {
  if (!AC || !sound) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle';
  o.frequency.setValueAtTime(720, AC.currentTime); o.frequency.exponentialRampToValueAtTime(1400, AC.currentTime + 0.09);
  g.gain.setValueAtTime(0.22, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.16);
  o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.17);
}

// ---------- audio (Web Audio) ----------
let AC = null, buffers = {}, loopSrc = null, loopGain = null;
async function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const load = async (name, url) => { try { const r = await fetch(url); const a = await r.arrayBuffer(); buffers[name] = await AC.decodeAudioData(a); } catch (e) {} };
  await Promise.all([load('loop', 'audio/drone_loop.mp3'), load('start', 'audio/drone_start.mp3'), load('crash', 'audio/crash2.mp3')]);
}
// pitchVar = fracción de variación de tono EN VIVO (sonido que REPITE nunca suena idéntico; regla dura Jorge)
const _lastRate = {};
function playOne(name, gain = 1, pitchVar = 0) {
  if (!AC || !buffers[name] || !sound) return; const s = AC.createBufferSource(); s.buffer = buffers[name];
  if (pitchVar) {   // variación SENTIBLE: rango amplio + nunca dos seguidos parecidos (anti-repetición)
    let r; do { r = 1 + (Math.random() * 2 - 1) * pitchVar; } while (_lastRate[name] != null && Math.abs(r - _lastRate[name]) < pitchVar * 0.5);
    _lastRate[name] = r; s.playbackRate.value = r;
    (window.__rates = window.__rates || []).push(+r.toFixed(3));
  }
  const g = AC.createGain(); g.gain.value = gain; s.connect(g).connect(AC.destination); s.start(); return s;
}
function startLoop() {
  if (!AC || !buffers.loop || loopSrc || !sound) return;
  loopSrc = AC.createBufferSource(); loopSrc.buffer = buffers.loop; loopSrc.loop = true;
  loopGain = AC.createGain(); loopGain.gain.value = 0.5; loopSrc.connect(loopGain).connect(AC.destination); loopSrc.start();
}
function stopLoop() { if (loopSrc) { try { loopSrc.stop(); } catch (e) {} loopSrc = null; } }

// ---------- flujo de vuelo ----------
// ---- banner no-bloqueante + capa de toque (sin botones despegar/reintentar) ----
function showBanner(title, hint) { /* SIN mensajes en pantalla (Jorge 2026-07-11): el toque sigue reintentando/siguiendo igual */ }

// ---- leaderboard por nivel (patrón Pingüino: score.php + JSON, tiempo ASCENDENTE) ----
// Web/tests (http/https) → relativo (mismo origen). App nativa (capacitor://) → URL absoluta al server.
// leaderboard vive en el hosting LEGACY (2026-07-11: el dominio principal migró al sitio nuevo y dejó
// legacy.tuescuelavirtual.com → hosting viejo). Relativo solo en localhost (tests) o en el propio legacy.
const SCORE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === 'legacy.tuescuelavirtual.com')
  ? 'score.php' : 'https://legacy.tuescuelavirtual.com/dronpilot/score.php';
async function submitScore(level, time) {
  const name = (playerName || 'Piloto');
  let list = [];
  try {
    if (ghost) {                                  // SOLO PROBAR: lee la tabla, NO escribe (pedido Jorge)
      const r = await fetch(SCORE_URL + (SCORE_URL.includes('?') ? '&' : '?') + 'level=' + level);
      list = await r.json();
    } else {
      const r = await fetch(SCORE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, level, time }) });
      list = await r.json();
    }
  } catch (e) { list = []; }   // sin red / local → el juego sigue igual
  renderBoard(list, level, time, name);
}
function renderBoard(list, level, myTime, myName) {
  const el = $('#bBoard'); if (!el) return;
  if (!Array.isArray(list) || !list.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  let myShown = false, rows = '<div class="hd">Mejores tiempos · Nivel ' + (level + 1) + '</div>';
  list.slice(0, 5).forEach((r, i) => {
    const me = !myShown && r.name === myName && Math.abs(r.time - myTime) < 0.01;
    if (me) myShown = true;
    rows += '<div class="' + (me ? 'me' : '') + '">' + (i + 1) + '. ' + esc(r.name) + ' — ' + (+r.time).toFixed(1) + 's</div>';
  });
  el.innerHTML = rows; el.style.display = 'inline-block';
}
function hideBanner() { $('#banner').classList.add('hidden'); }
function setTapLayer() { $('#tapLayer').style.pointerEvents = (state === 'ready' || state === 'win' || state === 'lose') ? 'auto' : 'none'; }
let _tapArm = 0;   // pequeña guarda: no reintentar por el mismo toque del choque
function onTap() {
  if (typeof unmuteIOS === 'function') unmuteIOS();   // re-asegura el desmute (por si iOS pausó el <audio>)
  if (AC && AC.state === 'suspended') AC.resume();
  if (performance.now() < _tapArm) return;
  if (state === 'ready') doTakeoff();
  else if (state === 'lose') { if (drone) drone.visible = true; buildLevel(levelIdx); }
  else if (state === 'win') { if (drone) drone.visible = true; levelIdx = levelIdx >= 39 ? levelIdx : levelIdx + 1; LS.set('unlocked', Math.max(LS.get('unlocked', 0), levelIdx)); buildLevel(levelIdx); }
}

function doTakeoff() {
  if (state !== 'ready') return;
  phys.takeoff(); state = 'fly';
  hideBanner(); setTapLayer();
  if (controls.mode === 'tilt') controls.calibrateTilt();   // el centro de inclinación = cómo sostienes el teléfono al despegar
  if (controls.mode === 'touch') $('#touch').classList.remove('hidden');
  levelStartT = performance.now(); levelTime = 0; $('#timer').classList.remove('hidden'); $('#timerV').textContent = '0.0';  // arranca el cronómetro
  spawnTakeoffPuff(phys.pos.x, house.floorY, phys.pos.z);
  startLoop();   // SOLO el loop agudo — sin el sonido grave de arranque (pedido Jorge)
}
function endLevel(win) {
  if (state === 'win' || state === 'lose') return;
  state = win ? 'win' : 'lose'; stopLoop();
  $('#touch').classList.add('hidden');                                        // fuera los controles de vuelo
  if (win) {
    // la META también desaparece al tocarla (como los puntos) — con su estallido (Jorge 2026-07-11)
    if (house && house.goal.mesh) { house.goal.mesh.visible = false; popBurst(house.goal.pos.x, house.goal.pos.y, house.goal.pos.z, 0x2ee66e); }
    levelTime = (performance.now() - levelStartT) / 1000;
    synthWin();   // sin confeti (Jorge 2026-07-11)
    // récord PERSONAL por nivel (pedido Jorge): superar tu mejor tiempo local se celebra en el banner
    const best = LS.get('best' + levelIdx, null);
    const isBest = best == null || levelTime < best;
    if (isBest) LS.set('best' + levelIdx, +levelTime.toFixed(2));
    showBanner((isBest && best != null ? '🏆 ¡NUEVO MEJOR TIEMPO! · ' : '🎉 ¡Llegaste! · ') + levelTime.toFixed(1) + 's', levelIdx >= 39 ? 'Toca para repetir' : 'Toca para seguir');
    submitScore(levelIdx, levelTime);                                          // envía el tiempo + muestra el leaderboard del nivel
  } else {
    // NO tapamos la pantalla: se VE el choque — el dron se parte en SUS pedazos reales y la animación sigue.
    const noBattery = phys.battery <= 0;
    explodeReal(phys.pos); if (drone) drone.visible = false; playOne('crash', 0.9, 0.40);
    showBanner(noBattery ? '🔋 Sin batería' : '💥 ¡Chocaste!', 'Toca para reintentar');
  }
  $('#timer').classList.add('hidden');
  _tapArm = performance.now() + (win ? 260 : 500);                            // al CHOCAR: 500 ms de gracia antes de poder resetear (Jorge)
  setTapLayer();
}

let _lowWarned = false;
function updateBattery() {
  const p = Math.max(0, phys.battery) * 100;
  $('#batFill').style.width = p + '%';
  const low = p < 22;
  $('#batFill').style.background = low ? 'linear-gradient(90deg,#ff5a5a,#ffa24d)' : 'linear-gradient(90deg,#2ee66e,#a6ff5c)';
  $('#bat').classList.toggle('low', low);
  if (low && !_lowWarned) { _lowWarned = true; synthBeep(); }
}

// ---------- loop principal ----------
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); let dt = (now - tPrev) / 1000; tPrev = now; if (dt > 0.05) dt = 0.05;

  if (state === 'fly' || state === 'lose' || state === 'win') {
    const inp = controls.update();
    const groundY = house && house.terrainY ? house.terrainY(phys.pos.x, phys.pos.z) : 0;   // escalera/rampa
    phys.t.midHeight = effFH(phys.pos.x, phys.pos.z);   // menos aire arriba → vuela más pegado al piso local
    phys.update(dt, { thr: inp.thr, yaw: inp.yaw, groundY });

    // aplicar a la malla
    if (drone) {
      drone.position.set(phys.pos.x, phys.pos.y, phys.pos.z);
      // −yaw: en Three.js +rotation.y es ANTIhorario; el rumbo de la física gira horario al dar derecha.
      // Con el signo negativo la malla gira igual que el rumbo (derecha=horario) y la nariz mira a donde vuela.
      drone.rotation.y = -phys.yaw;
      // pitch: acelerar adelante → NARIZ ABAJO (−rotation.x, porque la nariz mira a −Z); reversa → cola abajo.
      const tp = drone.userData.tilt; if (tp) { tp.rotation.x = -phys.tilt; tp.rotation.z = phys.roll; }
      for (const r of rotors) r.rotateOnAxis(r.userData.spinAxis || _AXY, phys.rotorRPM * dt * (r.userData.spinDir || 1));   // gira sobre SU eje vertical real (pivotes con ejes girados en el GLB)
    }

    // colisión (solo mientras vuela)
    if (state === 'fly') {
      levelTime = (now - levelStartT) / 1000; $('#timerV').textContent = levelTime.toFixed(1);   // cronómetro
      if (phys.state === 'crashed') {
        // PILA AGOTADA: el dron CAE (física crashed) y SOLO se rompe al TOCAR EL PISO, no antes.
        if (phys.pos.y <= phys.groundY + 0.06) endLevel(false);
      } else {
        const h = hitWorld(phys.pos);
        if (h) { endLevel(false); }                      // chocar pared/techo/obstáculo → se rompe al instante
        else {
          // recolectar puntos al pasar cerca (definen el recorrido)
          for (const c of house.collectibles) { if (c.taken) continue; const px = phys.pos.x - c.pos.x, py = phys.pos.y - c.pos.y, pz = phys.pos.z - c.pos.z; if (px * px + py * py + pz * pz < PICKUP_R * PICKUP_R) collectPoint(c); }
          // llegada: SÓLO gana si ya juntó todos los puntos (meta abierta)
          const g = house.goal.pos, dx = phys.pos.x - g.x, dy = phys.pos.y - g.y, dz = phys.pos.z - g.z;
          if (dx * dx + dy * dy + dz * dz < 0.7 * 0.7 && pointsLeft() === 0) { phys.win(); endLevel(true); }
          // trampas por proximidad
          for (const t of house.traps) { if (!t.armed) continue; const tx = phys.pos.x - t.pos.x, tz = phys.pos.z - t.pos.z; if (tx * tx + tz * tz < t.r * t.r) { t.armed = false; triggerTrap(t); } }
        }
        updateBattery();
      }
    } else if (state === 'win' && !_postWinCrashed && phys.state !== 'crashed') {
      // TRAS GANAR el dron NO es invencible (Jorge): conserva su inercia y PUEDE estrellarse.
      // El win YA contó (banner/score intactos) → el choque es cosmético, no cambia el resultado.
      if (hitWorld(phys.pos)) {
        _postWinCrashed = true;
        explodeReal(phys.pos); if (drone) drone.visible = false; playOne('crash', 0.9, 0.40);
      }
    }

    // sonido: intensidad por avance
    if (loopSrc) loopSrc.playbackRate.value = 1 + (phys.speed / phys.t.maxSpeed) * 0.4;
  }

  // meta pulsa + puntos giran + obstáculos con movimiento se animan (siempre, también en 'ready')
  if (house && house.goal.mesh) {
    const t = now / 1000; house.goal.mesh.rotation.z = t * 1.2; house.goal.mesh.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
    for (const c of house.collectibles) { if (!c.taken) { c.mesh.rotation.y = t * 2.2; c.mesh.position.y = c.pos.y + Math.sin(t * 2 + c.pos.x) * 0.08; } }
    if (house.movers) for (const m of house.movers) m.step(t, dt);
    // VIENTO (sopladores/géiseres): empuja al dron — no rompe, lo desplaza (elemento nuevo Jorge 2026-07-11)
    if (state === 'fly' && phys.state === 'flying' && house.movers) {
      for (const m of house.movers) {
        if (!m.windAt) continue;
        const w = m.windAt(phys.pos.x, phys.pos.y, phys.pos.z);
        if (w) { phys.pos.x += w[0] * dt; phys.pos.y += w[1] * dt; phys.pos.z += w[2] * dt; }
      }
    }
  }

  stepDebris(dt);
  stepFx(dt);
  updateCamera(dt);
  updateWallTransparency(dt);
  renderer.render(scene, cam);
}

// cámara chase detrás del dron
const _camGoal = new THREE.Vector3(), _look = new THREE.Vector3();
let camYaw = 0, _freezeCam = false;   // _freezeCam: solo para capturas de prueba (vista cenital)
function updateCamera(dt) {
  if (!drone || _freezeCam) return;
  // tras CHOCAR la cámara RETROCEDE y sube un poco → se aprecia el despiece completo (Jorge 2026-07-11)
  const back = state === 'lose' ? 4.4 : 2.5, up = state === 'lose' ? 1.8 : 0.9;
  // la cámara RETRASA el giro respecto al dron → al girar SE VE al dron rotar sobre su propio eje
  let d = phys.yaw - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * Math.min(1, 3.2 * dt);
  const bx = Math.sin(camYaw), bz = -Math.cos(camYaw);   // dirección de cámara (retrasada)
  let gy = phys.pos.y + up;
  if (house) gy = Math.min(gy, house.ceilingY - 0.18);       // no atravesar el techo
  _camGoal.set(phys.pos.x - bx * back, gy, phys.pos.z - bz * back);
  cam.position.lerp(_camGoal, Math.min(1, 6 * dt));
  if (house) {
    const b = house.bounds, m = 0.28;   // no atravesar muros: mantener la cámara dentro del cuarto
    cam.position.x = Math.max(b.minX + m, Math.min(b.maxX - m, cam.position.x));
    cam.position.z = Math.max(b.minZ + m, Math.min(b.maxZ - m, cam.position.z));
    cam.position.y = Math.min(cam.position.y, house.ceilingY - 0.12);
  }
  _look.set(phys.pos.x + bx * 1.4, phys.pos.y + 0.12, phys.pos.z + bz * 1.4);
  cam.lookAt(_look);
  keepDroneInView();
  sun.position.set(phys.pos.x + 5, phys.pos.y + 9, phys.pos.z + 4);
  sun.target.position.set(phys.pos.x, 0, phys.pos.z); sun.target.updateMatrixWorld();
}
// GARANTÍA DURA: el dron NUNCA sale de cámara. Proyecta el dron a pantalla (NDC) y si se pasa del
// margen seguro (bordes), acerca el punto de mira al dron hasta recentrarlo. Solo actúa en el borde.
const _ndc = new THREE.Vector3();
function keepDroneInView() {
  for (let k = 0; k < 5; k++) {
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _ndc.copy(phys.pos).project(cam);
    const out = Math.max(Math.abs(_ndc.x) - 0.88, Math.abs(_ndc.y) - 0.82, _ndc.z > 1 ? 1 : 0);
    if (out <= 0.001) break;
    _look.lerp(phys.pos, 0.45);            // menos sesgo adelante → recentra el dron
    cam.lookAt(_look);
  }
}

// ---------- muros que TAPAN la vista → transparentes (para ver el dron detrás de una pared) ----------
const _wallRay = new THREE.Raycaster();
const _wv1 = new THREE.Vector3(), _wv2 = new THREE.Vector3();
function updateWallTransparency(dt) {
  if (!house || !drone) return;
  // Al chocar/ganar NO desvanecer: la pared contra la que chocamos debe verse EN PIE (pedido Jorge).
  if (state === 'lose' || state === 'win') {
    for (const w of house.walls) { const m = w.material; if (m.opacity < 1) { m.opacity = 1; if (m.transparent) { m.transparent = false; m.needsUpdate = true; } m.depthWrite = true; } }
    return;
  }
  const cx = cam.position.x, cz = cam.position.z;
  const to = _wv1.set(phys.pos.x, phys.pos.y + 0.1, phys.pos.z);
  const dir = _wv2.subVectors(to, cam.position);
  const dist = dir.length();
  let blockers = null;
  if (dist > 0.05) {
    dir.normalize();
    _wallRay.set(cam.position, dir); _wallRay.far = dist + 0.4;         // muro(s) ENTRE cámara y dron
    const hits = _wallRay.intersectObjects(house.walls, false);
    if (hits.length) blockers = new Set(hits.map(h => h.object));
  }
  for (const w of house.walls) {
    let block = blockers ? blockers.has(w) : false;
    if (!block) {   // muro PEGADO a la cámara (la cámara quedó dentro/detrás → el ray no lo detecta)
      const p = w.geometry.parameters;
      const dx = Math.max(0, Math.abs(cx - w.position.x) - p.width / 2);
      const dz = Math.max(0, Math.abs(cz - w.position.z) - p.depth / 2);
      if (dx * dx + dz * dz < 0.45 * 0.45) block = true;
    }
    const target = block ? 0.06 : 1;
    const m = w.material;
    let next = m.opacity + (target - m.opacity) * Math.min(1, 22 * dt);
    if (block && next > 0.85) next = 0.7;                               // empieza a esconderse rápido
    const wantTransp = next < 0.98;
    if (wantTransp !== m.transparent) { m.transparent = wantTransp; m.needsUpdate = true; }   // el toggle SÍ requiere recompilar
    m.opacity = next;
    m.depthWrite = next > 0.55;                                         // muy transparente → no ocluir el dron
  }
}

function triggerTrap(t) {
  // la trampa se ACTIVA al pasar cerca: globo estalla, robot se sacude, + un "susto" que empuja al dron.
  if (t.type === 'balloon') {
    if (t.mesh) t.mesh.visible = false;
    popBurst(t.pos.x, t.pos.y, t.pos.z, 0xff4d6d);
    synthPop(1);
  } else {
    robotShake(t.mesh);
    synthPop(0.8);
  }
  // susto: lurch del dron (giro brusco + bamboleo) → las trampas IMPORTAN (cerca de un muro puede costar caro)
  if (phys.state === 'flying') { phys.yawVel += (Math.random() * 2 - 1) * 0.9; phys._wobbleT = 0; }
}

// ---------- UI ----------
// desmutea el WebAudio en iOS: reproducir el <audio> silencioso en loop dentro del gesto pone la
// sesión web en 'playback' → el sonido del juego suena aunque el iPhone esté en SILENCIO.
function unmuteIOS() { const u = $('#unmute'); if (u) { u.volume = 1; u.play().catch(() => {}); } }
$('#pre').addEventListener('pointerdown', async () => {   // pointerdown, NO click: el mata-lupa bloquea el click sintetizado del toque (bug v0.7.7: no arrancaba en iPhone)
  unmuteIOS();
  await initAudio(); if (AC && AC.state === 'suspended') AC.resume();
  $('#pre').classList.add('hidden'); $('#hud').classList.remove('hidden');
  buildLevel(levelIdx);
});
controls.triggerTakeoff = () => doTakeoff();
$('#menuBtn').addEventListener('click', () => $('#menu').classList.remove('hidden'));
$('#menuClose').addEventListener('click', () => $('#menu').classList.add('hidden'));
// click FUERA de la tarjeta (en el fondo) cierra el menú
$('#menu').addEventListener('click', e => { if (e.target === $('#menu')) $('#menu').classList.add('hidden'); });
// LUPA de iOS (doble tap / mantener): WKWebView la muestra aunque no haya texto seleccionable.
// Matar el default de touchend/dblclick FUERA de menú/botones/inputs (el juego usa pointerdown, no click).
document.addEventListener('touchend', e => { if (!e.target.closest('#menu, button, input')) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => { e.preventDefault(); });

// TOQUE en cualquier parte: despegar (ready) / reintentar (lose) / seguir (win)
$('#tapLayer').addEventListener('pointerdown', e => { e.preventDefault(); onTap(); });

// despegar/continuar con Espacio también
addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); onTap(); } });

// ---- controles táctiles = ZONAS DIAGONALES por esquina (siguen el arco del pulgar) ----
// Cada esquina inferior = pivote del pulgar; dividida por una línea ⟂ a la diagonal esquina→centro:
// disco interno (pegado a la esquina) = 1er botón, anillo externo (hacia el centro) = 2do botón.
// IZQ: interno ◀ / externo ▶ · DER: interno ▼atrás / externo ▲adelante.
const ZONE = { R1: 0.40, R2: 0.72 };   // fracción del ALTO: R1=divisor (esquina), R2=límite externo (zona 2 ampliada ×1.2, Jorge 2026-07-11)
const zonesSvg = $('#touchZones'), SVGNS = 'http://www.w3.org/2000/svg', zonePaths = {};
function zoneRadii() { const H = innerHeight; return { R1: ZONE.R1 * H, R2: ZONE.R2 * H }; }
function buildZones() {
  const W = innerWidth, H = innerHeight, { R1, R2 } = zoneRadii();
  zonesSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  zonesSvg.innerHTML = '';
  // SIN visuales (Jorge 2026-07-11: "solo función queda"): las zonas táctiles trabajan invisibles
}
function zoneOf(px, py) {
  const W = innerWidth, H = innerHeight, { R1, R2 } = zoneRadii();
  const left = px < W / 2, r = Math.hypot(px - (left ? 0 : W), py - H);
  if (r > R2) return null;                                        // fuera de las zonas → deja pasar el tap (menú/HUD)
  return left ? (r < R1 ? 'left' : 'right') : (r < R1 ? 'back' : 'accel');
}
const _zonePtrs = new Map();   // pointerId -> zona
function applyZones() {
  const t = controls._touch; t.left = t.right = t.accel = t.back = false;
  for (const z of _zonePtrs.values()) if (z) t[z] = true;

}
const zonesActive = () => controls.mode === 'touch' && state === 'fly' && !$('#touch').classList.contains('hidden');
addEventListener('pointerdown', e => {
  if (!zonesActive()) return;
  const z = zoneOf(e.clientX, e.clientY);
  if (!z) return;
  e.preventDefault(); _zonePtrs.set(e.pointerId, z); applyZones();
}, { passive: false });
addEventListener('pointermove', e => { if (_zonePtrs.has(e.pointerId)) { _zonePtrs.set(e.pointerId, zoneOf(e.clientX, e.clientY)); applyZones(); } });
const zoneUp = e => { if (_zonePtrs.delete(e.pointerId)) applyZones(); };
addEventListener('pointerup', zoneUp); addEventListener('pointercancel', zoneUp);
addEventListener('resize', buildZones); buildZones();

// menú: opciones
function wireOpts(sel, cb) { const c = $(sel); c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { c.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); cb(b.dataset.v); })); }
wireOpts('#optCraft', v => { craft = v; LS.set('craft', v); buildLevel(levelIdx); });
wireOpts('#optCtl', v => {
  controls.setMode(v); LS.set('ctl', v);
  $('#touch').classList.toggle('hidden', !(v === 'touch' && state === 'fly'));
  if (v === 'tilt' && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') controls.enableTilt(); }).catch(() => {});
  } else if (v === 'tilt') controls.enableTilt();
});
wireOpts('#optLevel', v => { levelIdx = +v; $('#menu').classList.add('hidden'); if (drone) drone.visible = true; buildLevel(levelIdx); });   // #over ya no existe (v0.3.3) — tocarlo tiraba TypeError y el nivel nunca cambiaba
wireOpts('#optLB', v => { ghost = (v === 'ghost'); LS.set('ghost', ghost); });
wireOpts('#optSnd', v => { sound = v === 'on'; LS.set('snd', sound); if (!sound) stopLoop(); else if (state === 'fly') startLoop(); });

// reflejar los ajustes guardados en los botones del menú al arrancar
function syncMenuUI() {
  const setOn = (sel, val) => { const c = $(sel); if (!c) return; c.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val))); };
  setOn('#optCraft', craft); setOn('#optCtl', controls.mode); setOn('#optSnd', sound ? 'on' : 'off');
}
syncMenuUI();

// nombre del jugador (leaderboard) — persiste en dron_name
$('#playerName').value = playerName;
$('#playerName').addEventListener('input', e => { playerName = e.target.value.slice(0, 14); LS.set('name', playerName); });

// ---------- hook de pruebas headless ----------
window.__sim = {
  THREE, get state() { return state; }, phys, controls, cam, get debris() { return debris; }, playOne,
  get house() { return house; }, get drone() { return drone; },
  setLevel(n) { levelIdx = n; buildLevel(n); },
  takeoff: doTakeoff,
  freeze(v) { _freezeCam = v; },
  start() { $('#pre').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); },
  info() { return { state, level: levelIdx, craft, pos: phys.pos, battery: phys.battery, flightHeight, rotors: rotors.length, fx: fx.length, trapsArmed: house ? house.traps.filter(t => t.armed).length : 0, points: house ? { got: house.collectibles.length - house.collectibles.filter(c => !c.taken).length, need: house.collectibles.length } : { got: 0, need: 0 }, walls: house ? house.walls.length : 0 }; },
};

// restaurar botón del leaderboard según lo guardado
if (ghost) { document.querySelectorAll('#optLB button').forEach(b => b.classList.toggle('on', b.dataset.v === 'ghost')); }
frame();
// Service Worker (offline / PWA) — no bloquea el arranque
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }
console.log('Dron Pilot v' + VERSION);
