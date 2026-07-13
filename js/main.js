// main.js — Orquestador de Dron Pilot. Junta Three + dron GLB + física + controles + casa + audio.
// Estados de juego: 'pre' (pantalla previa) → 'ready' (en piso, esperar DESPEGAR) → 'fly' → ('win'|'lose').
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const VERSION = '0.14.0';   // v= para deploy/guard
const $ = s => document.querySelector(s);
const DRONE_R = 0.30;      // radio de colisión del dron (esfera)
const PICKUP_R = 1.0;      // radio para recolectar un punto (0.75→1.0: costaba agarrarlos, Jorge 2026-07-12)
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
  bear: { maxSpeed: 6.5, fwdAccel: 9.5, drag: 1.45, yawMax: 1.9, yawAccel: 4.4, tiltMax: 0.78, rollFactor: 0.52, wobbleAmp: 0.48, riseDamp: 3.4, batterySec: 32, rotorIdleRPM: 22, rotorFullRPM: 52 },   // tilt/wobble fuertes: Jorge quiere que se MENEE
  fly: { maxSpeed: 5.6, fwdAccel: 8.0, drag: 1.6, yawMax: 2.0, yawAccel: 4.6, tiltMax: 0.42, rollFactor: 0.36, wobbleAmp: 0.34, riseDamp: 3.0, batterySec: 40, rotorIdleRPM: 12.5, rotorFullRPM: 13.75 },   // mariposa: flotona, aleteo = rotorRPM (mitad y luego ×1.25, Jorge 2026-07-12)
};
// giro (rad) que pone la NARIZ del modelo mirando a −Z (dirección de vuelo). Se calibra con render.
const _AXY = new THREE.Vector3(0, 1, 0);
const CRAFT_YAW = { drone: Math.PI, coax: Math.PI, bear: 0, fly: Math.PI };   // GLB nariz en +Z (medido con render de flechas) → 180° para volar de frente; oso = 0: CARA a la cámara (Jorge quiere verle la cara al volar)
let house = null, drone = null, rotors = [], wings = [], craft = LS.get('craft', 'drone'), levelIdx = 0, loadGen = 0;
let state = 'pre', flightHeight = 2.5, tPrev = performance.now(), debris = [], fx = [];
let _postWinCrashed = false;   // choque cosmético permitido UNA vez tras ganar (el dron no es invencible)
let _heroPiece = null;         // pieza del GOL DE MUERTO: la cámara la sigue y no expira
let _crashSrc = null;          // fuente del sonido de choque (se CORTA si entra el gol de muerto)
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
// textura de ruido para la pelusa del oso (alphaMap de las capas shell-fur) — 1 sola, cacheada
let _furTex = null;
function getFurTexture() {
  if (!_furTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 24000; i++) {
      const v = 90 + (Math.random() * 165 | 0);
      g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      g.fillRect((Math.random() * 256) | 0, (Math.random() * 256) | 0, 1, 1);
    }
    _furTex = new THREE.CanvasTexture(cv);
    _furTex.wrapS = _furTex.wrapT = THREE.RepeatWrapping;
    _furTex.repeat.set(2, 2);
  }
  return _furTex;
}
const loader = new GLTFLoader();
function loadCraft(kind) {
  const SRC = {
    drone: { url: 'models/drone.glb', len: 0.55 },
    coax: { url: 'models/simulus_heli.glb', len: 0.9 },
    bear: { url: 'models/bear.glb', len: 0.55, maxH: 0.6 },     // el oso es ALTO: tope vertical aparte
    fly: { url: 'models/butterfly.glb', len: 0.68 },
  };
  const src = SRC[kind] || SRC.drone;
  const url = src.url;
  const targetLen = src.len;   // tamaño real dentro de la casa (m)
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
    let s = targetLen / horiz;
    if (src.maxH && size.y * s > src.maxH) s = src.maxH / size.y;   // nave alta (oso): que no sea una torre
    m.scale.setScalar(s);
    // ORIENTAR: girar el modelo para que su NARIZ mire hacia adelante (−Z = dirección de vuelo)
    m.rotation.y = CRAFT_YAW[kind] || 0;
    // centrar en el origen del holder — DESPUÉS de rotar: si se centra antes, el giro de 180° (CRAFT_YAW)
    // descentra el contenido en −2·(offset crudo del modelo) → la mariposa quedaba 0.59 m ADELANTE del
    // collider (esfera en phys.pos) y atravesaba paredes. Medir tras rotar centra bien las 4 naves.
    const box2 = new THREE.Box3().setFromObject(m); const c = new THREE.Vector3(); box2.getCenter(c);
    m.position.sub(c);
    // rotores: SOLO los pivotes de hélice (no las mallas hijas '_Material_0' → si giro ambos se cancelan)
    const RX = /prop|rotor|blade|helice|hélice/i;
    rotors = []; wings = [];
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
    // OSO (Jorge): PELUCHE de verdad — sheen de terciopelo + PELUSA en capas (shell fur: copias del
    // mesh infladas por la normal con alphaTest de ruido → silueta peluda) + propela clonada del dron.
    // Mira a la CÁMARA (CRAFT_YAW.bear = 0): vuela de frente a nosotros, propela en la espalda (−Z).
    if (kind === 'bear') {
      const furTex = getFurTexture();
      const baseMeshes = [];
      m.traverse(o => { if (o.isMesh && o.material) baseMeshes.push(o); });
      const SHELLS = 6;
      for (const o of baseMeshes) {
        const mt0 = Array.isArray(o.material) ? o.material[0] : o.material;
        if (mt0.transparent) continue;   // overlay de la boca (BLEND): se queda como viene, sin pelusa
        const plushOpts = {
          map: mt0.map || null, normalMap: mt0.normalMap || null, side: mt0.side,
          color: mt0.color ? mt0.color.clone() : new THREE.Color(0xb5793f),
          roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffe2b8),
        };
        o.material = new THREE.MeshPhysicalMaterial(plushOpts);
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const gb = o.geometry.boundingBox;
        const furLen = o.geometry.boundingSphere.radius * 0.085;   // largo del pelo ∝ tamaño del mesh (unidades locales)
        // el TORSO/BRAZOS del cuerpo van bajo el suéter: pelo solo del cuello para arriba (si no,
        // atraviesa la ropa y la mancha de marrón). El suéter sí lleva pelusa completa.
        const isBody = /body/i.test(mt0.name);
        const furMinY = isBody ? gb.min.y + (gb.max.y - gb.min.y) * 0.62 : gb.min.y - 1;
        const furMaxL = isBody ? 0.30 : 9;   // en el cuerpo, pelo SOLO sobre texels marrones (el hocico claro se ensuciaba)
        for (let i = 1; i <= SHELLS; i++) {
          const sm = new THREE.MeshPhysicalMaterial({ ...plushOpts, color: plushOpts.color.clone().multiplyScalar(1 + 0.04 * i), alphaMap: furTex, alphaTest: 0.24 + 0.50 * i / SHELLS });
          const dist = furLen * i / SHELLS;
          sm.onBeforeCompile = shd => {
            shd.uniforms.furD = { value: dist }; shd.uniforms.furMinY = { value: furMinY }; shd.uniforms.furMaxL = { value: furMaxL };
            shd.vertexShader = 'uniform float furD;\nuniform float furMinY;\nvarying float vFurOk;\n' + shd.vertexShader.replace('#include <begin_vertex>',
              '#include <begin_vertex>\n\tvFurOk = step(furMinY, position.y);\n\ttransformed += objectNormal * furD * vFurOk;');
            // sin pelo bajo el cuello, sobre texels oscuros (ojos/nariz: se embarraban en negro) ni
            // sobre texels claros del cuerpo (hocico). diffuseColor ya está en espacio LINEAL
            // (marrón cabeza ≈0.04 · ojos ≈0.002 · hocico ≈0.5)
            shd.fragmentShader = 'varying float vFurOk;\nuniform float furMaxL;\n' + shd.fragmentShader.replace('#include <alphatest_fragment>',
              'float furL = dot(diffuseColor.rgb, vec3(0.3333));\nif (vFurOk < 0.5 || furL < 0.012 || furL > furMaxL) discard;\n#include <alphatest_fragment>');
          };
          // clave ÚNICA por malla+capa: con clave compartida Three reusa el programa cacheado y NO
          // llama onBeforeCompile en los demás materiales → furD queda sin subir (pelo invisible + z-fight)
          sm.customProgramCacheKey = () => 'bearfur_' + o.name + '_' + i;
          let sh;
          if (o.isSkinnedMesh) { sh = new THREE.SkinnedMesh(o.geometry, sm); sh.bind(o.skeleton, o.bindMatrix); }
          else sh = new THREE.Mesh(o.geometry, sm);
          sh.position.copy(o.position); sh.quaternion.copy(o.quaternion); sh.scale.copy(o.scale);
          sh.userData.noShadow = true; sh.frustumCulled = false;
          o.parent.add(sh);
        }
      }
      const bb = new THREE.Box3().setFromObject(m); const bs = new THREE.Vector3(); bb.getSize(bs);
      // cabeza casi recta mirando al jugador (Jorge 2026-07-12 "de frente a mí" — la caída fuerte
      // lo dejaba mirando el piso); un toque mínimo de inclinación para que no se vea tieso
      m.traverse(o => {
        if (/^neck_/.test(o.name)) o.rotation.x += 0.05;
        if (/^head_/.test(o.name)) o.rotation.x += 0.07;
      });
      loader.load('models/drone.glb', (g2) => {
        if (gen !== loadGen) return;                 // NO disponer g2: el clone comparte geometría/materiales
        let prop = null; g2.scene.traverse(o => { if (!prop && /propeller_1_object$/i.test(o.name)) prop = o; });
        if (!prop) return;
        const rotor = new THREE.Group(); rotor.name = 'bear_rotor';
        const pc = prop.clone(true); pc.position.set(0, 0, 0); rotor.add(pc);
        const pb = new THREE.Box3().setFromObject(pc); const ps = new THREE.Vector3(); pb.getSize(ps);
        const targetD = bs.x * 0.85;                 // diámetro ≈ ancho de hombros
        rotor.scale.setScalar(targetD / (Math.max(ps.x, ps.z) || 1));
        // hub AFUERA del cuerpo (detrás de la espalda, no clavado en el cuello — Jorge) + mástil que
        // sale de la espalda hasta el hub (se LEE el montaje). Espalda = −Z (el oso mira a la cámara).
        const hub = new THREE.Vector3(0, bs.y * 0.14, -bs.z * 0.62);
        rotor.position.copy(hub);
        const anchor = new THREE.Vector3(0, bs.y * 0.02, -bs.z * 0.40);
        const dirM = hub.clone().sub(anchor), lenM = dirM.length();
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, lenM, 8), new THREE.MeshStandardMaterial({ color: 0x555b64, metalness: 0.4 }));
        mast.position.copy(anchor.clone().add(hub).multiplyScalar(0.5));
        mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirM.normalize());
        tiltPivot.add(mast);
        tiltPivot.add(rotor);
        rotor.userData.spinDir = 1; rotor.userData.spinAxis = new THREE.Vector3(0, 1, 0);
        rotors.push(rotor);
      }, undefined, () => {});
    }
    // MARIPOSA (Jorge): ALETEO — las alas vienen separadas (cirugía offline wingL/wingR); cada una se
    // re-cuelga de un PIVOTE y se bate alrededor del eje del cuerpo (línea nariz-cola, x=0).
    if (kind === 'fly') {
      const wingNodes = [];
      m.traverse(o => { if (/^wing[LR]$/.test(o.name)) wingNodes.push(o); });
      const ROOT_Y = 1.837;   // altura de la RAÍZ del ala en coords del modelo (mediana del borde raíz MEDIDA en la malla; aprobado Jorge 2026-07-12)
      for (const wn of wingNodes) {
        const parent = wn.parent;
        const piv = new THREE.Group(); parent.add(piv);
        piv.position.set(0, ROOT_Y, 0); wn.position.set(0, -ROOT_Y, 0);   // la bisagra pasa POR la raíz, no bajo el cuerpo
        piv.add(wn);
        piv.updateMatrixWorld(true);
        const pq = new THREE.Quaternion(); piv.getWorldQuaternion(pq);
        piv.userData.axis = new THREE.Vector3(0, 0, 1).applyQuaternion(pq.invert()).normalize();   // eje del cuerpo en frame local
        piv.userData.side = wn.name === 'wingL' ? 1 : -1;
        // POSE INICIAL = base del aleteo (0.14): en ready el aleteo no corre y sin esto las alas quedaban
        // en ángulo 0 (caídas/planas, "despegadas del cuerpo", Jorge). Con 0.14 nacen en el diedro pegado.
        piv.quaternion.setFromAxisAngle(piv.userData.axis, piv.userData.side * 0.14);
        wings.push(piv);
      }
    }
    m.traverse(o => { if (o.isMesh) o.castShadow = !o.userData.noShadow; });   // la nave PROYECTA sombra (cue de altura); capas de pelusa NO (duplicarían el blob)
    tiltPivot.add(m);
    // EJE DE GIRO por rotor: el eje LOCAL que corresponde a la VERTICAL del mundo (un pivote del GLB
    // puede venir con ejes girados → rotateY a secas lo hace girar VERTICAL; caso propela, Jorge).
    holder.updateMatrixWorld(true);
    const _wq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
    rotors.forEach(r => { if (!r.userData.spinAxis) { r.getWorldQuaternion(_wq); r.userData.spinAxis = _up.clone().applyQuaternion(_wq.clone().invert()).normalize(); } });
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
  // spawnear SOBRE el terreno local (no en floorY): en niveles con plateau alto en el spawn (43 "La gran
  // bajada", 44) el dron nacía 6 m BAJO el terreno y al despegar subía todo eso + inercia → chocaba el techo
  // y explotaba al comenzar (Jorge). En niveles planos terr(start)=0=floorY → sin cambio.
  const startY = terr(house.start.x, house.start.z);
  phys.reset({ x: house.start.x, y: startY, z: house.start.z });
  drone.position.set(house.start.x, startY, house.start.z);
  camYaw = 0;
  state = 'ready';
  _lowWarned = false; _postWinCrashed = false; _heroPiece = null;
  if (typeof _zonePtrs !== 'undefined') { _zonePtrs.clear(); controls._touch.left = controls._touch.right = controls._touch.accel = controls._touch.back = false; }
  $('#levelName').textContent = 'Nivel ' + (idx + 1) + ' · ' + house.name;
  $('#touch').classList.add('hidden');
  $('#timer').classList.add('hidden');
  showBanner('', '');       // sin botón: toca la pantalla para volar
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
let _impactV = { x: 0, y: 0, z: 0 };   // velocidad del vuelo EN el impacto (endLevel la captura antes de congelar)
// el choque según la nave: dron/heli/mariposa se DESPIEZAN; el OSO es PELUCHE (Jorge 2026-07-12):
// cae ENTERO al piso y REBOTA con las cosas — una sola pieza de debris grande con colisión viva.
function crashCraft() {
  if (craft === 'bear') tumbleBear(); else { explodeReal(phys.pos); if (drone) drone.visible = false; }
  _crashSrc = playOne('crash', 0.9, 0.40);
}
function tumbleBear() {
  const tp = drone && drone.userData.tilt;
  if (!tp || !drone.userData.model) { explode(phys.pos); return; }   // GLB aún no cargó
  tp.updateWorldMatrix(true, true);
  scene.attach(tp);   // el conjunto ENTERO (oso + propela + mástil) sale del holder conservando su pose
  // el oso choca PEGADO al muro (su cuerpo es fino, collider ~0.19 al frente); si la pieza (R 0.26) NACE
  // solapada con la pared, el asentado refleja los 3 ejes y NUNCA cae → sacarla del muro por el sentido
  // contrario al golpe hasta que su esfera libre (Jorge: el peluche cae al piso y rebota, no se queda flotando).
  { const pos = tp.position; let hx = _impactV.x, hz = _impactV.z; const hl = Math.hypot(hx, hz);
    if (hl > 0.05) { hx /= hl; hz /= hl; for (let k = 0; k < 24 && debrisHit(pos.x, pos.y, pos.z, 0.26); k++) { pos.x -= hx * 0.03; pos.z -= hz * 0.03; } } }
  debris.push({
    mesh: tp, R: 0.26, stay: true, life: 0,
    v: { x: -_impactV.x * 0.55, y: Math.max(1.4, -_impactV.y * 0.4 + 1.2), z: -_impactV.z * 0.55 },   // rebote del golpe: atrás y arriba
    w: { x: (Math.random() * 2 - 1) * 3.5, y: (Math.random() * 2 - 1) * 4.5, z: 0 },
  });
  rotors = []; wings = [];   // la propela viaja con el oso pero ya no gira (nave muerta)
  popBurst(phys.pos.x, phys.pos.y, phys.pos.z, 0xffe08a);
}
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
  const REST = 0.45;   // restitución del rebote
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.life += dt; d.v.y -= 9.8 * dt;
    const R = d.R || 0.07;                        // radio por pieza (el oso entero usa 0.26)
    const p = d.mesh.position;
    // REBOTE contra paredes/objetos (Jorge 2026-07-11): probar el paso POR EJE y reflejar el eje que choca
    const nx = p.x + d.v.x * dt, ny = p.y + d.v.y * dt, nz = p.z + d.v.z * dt;
    if (debrisHit(nx, p.y, p.z, R)) { d.v.x *= -REST; d.w.y *= -0.7; } else p.x = nx;
    if (debrisHit(p.x, ny, p.z, R)) { d.v.y *= -REST; d.v.x *= 0.75; d.v.z *= 0.75; } else p.y = ny;
    if (debrisHit(p.x, p.y, nz, R)) { d.v.z *= -REST; d.w.x *= -0.7; } else p.z = nz;
    const fy = d.R ? d.R * 0.9 : 0.03;            // piso: el oso descansa sobre su radio, no hundido
    if (p.y < fy) { p.y = fy; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; if (d.stay) { d.w.x *= 0.7; d.w.y *= 0.7; } }
    d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.y += d.w.y * dt;
    // ⭐ Las PIEZAS también RECOGEN puntos y REVIENTAN globos después del choque (Jorge 2026-07-11)
    if (state === 'lose' && house) {
      for (const c of house.collectibles) { if (c.taken) continue; const cx = p.x - c.pos.x, cy = p.y - c.pos.y, cz = p.z - c.pos.z; if (cx * cx + cy * cy + cz * cz < 0.6 * 0.6) collectPoint(c); }
      for (const t2 of house.traps) { if (!t2.armed) continue; const tx = p.x - t2.pos.x, tz = p.z - t2.pos.z; if (tx * tx + tz * tz < t2.r * t2.r * 0.64) { t2.armed = false; triggerTrap(t2); } }
    }
    // ⭐ GOL DE MUERTO (Jorge 2026-07-11): si una PIEZA del despiece toca la meta (ya desbloqueada)
    // después de chocar → el nivel VALE, con logro especial (único mensaje que existe en el juego).
    if (state === 'lose' && house && !house._deadWin && pointsLeft() === 0) {
      const g = house.goal.pos, gx = p.x - g.x, gy = p.y - g.y, gz = p.z - g.z;
      if (gx * gx + gy * gy + gz * gz < 0.75 * 0.75) {
        house._deadWin = true; state = 'win';
        _heroPiece = d; d.hero = true;                 // la CÁMARA pasa a seguir a la pieza ganadora (Jorge)
        try { if (_crashSrc) { _crashSrc.stop(); _crashSrc = null; } } catch (e) {}   // el estrellarse NO suena sobre el gol (Jorge)
        house.goal.mesh.visible = false; popBurst(g.x, g.y, g.z, 0xffd23f);
        if (!playOne('deadwin', 0.9)) synthWin();   // arcade REAL solo aquí (Pixabay, Jorge); melodía-identidad → SIN pitch-var
        const bn = $('#banner'); $('#bTitle').textContent = '☠️🏁 ¡GOL DE MUERTO!'; $('#bHint').textContent = 'La pieza llegó por ti'; $('#bBoard').innerHTML = ''; bn.classList.remove('hidden');
        LS.set('ach_deadgoal', true);
        setTapLayer();
      }
    }
    if (d.life > 2.4 && !d.hero && !d.stay) { scene.remove(d.mesh); disposeMesh(d.mesh); debris.splice(i, 1); }   // el peluche (stay) se queda tirado
  }
}

// ---------- colisión de la NAVE vs FORMAS reales (box/sphere/cyl) — delega en el módulo puro ----------
// Precisa: sólo choca si toca la forma real del objeto, no su caja envolvente (p.ej. pasa al lado del
// poste fino de la lámpara). Muros/techo = AABB exacto; obstáculos = compuestos por sub-formas.
// El COLLIDER DE LA NAVE calza SU silueta real (medido con test/measure_craft.js): dron/coax = 1 esfera;
// oso = cápsula VERTICAL (alto y fino) → no choca con el aire de los lados; mariposa = disco ANCHO y PLANO
// (5 esferas) → las puntas de las alas SÍ chocan y no atraviesa por arriba/abajo. Offsets en marco local
// (nariz −Z, derecha +X, arriba +Y), centrados en phys.pos; se rotan por la orientación real de la malla.
const CRAFT_COLLIDER = {
  drone: [{ dx: 0, dy: 0, dz: 0, r: DRONE_R }],
  coax:  [{ dx: 0, dy: 0, dz: 0, r: DRONE_R }],
  bear:  [{ dx: 0, dy: -0.155, dz: 0, r: 0.185 }, { dx: 0, dy: 0, dz: 0, r: 0.185 }, { dx: 0, dy: 0.155, dz: 0, r: 0.185 }],   // 0.68 alto × 0.37 ancho
  fly:   [{ dx: 0, dy: 0, dz: 0, r: 0.19 }, { dx: -0.15, dy: 0, dz: 0, r: 0.19 }, { dx: 0.15, dy: 0, dz: 0, r: 0.19 }, { dx: 0, dy: 0, dz: -0.10, r: 0.19 }, { dx: 0, dy: 0, dz: 0.10, r: 0.19 }],   // 0.68 ancho × 0.58 fondo × 0.38 alto (plano)
};
function hitWorld(p) {
  const spheres = CRAFT_COLLIDER[craft] || CRAFT_COLLIDER.drone;
  const ry = drone ? drone.rotation.y : -phys.yaw;   // orientación real de la malla (holder.rotation.y = −yaw)
  const cy = Math.cos(ry), sy = Math.sin(ry);
  for (const sp of spheres) {
    const wx = p.x + sp.dx * cy + sp.dz * sy;         // offset local rotado por yaw (giro sobre Y) → mundo
    const wy = p.y + sp.dy;
    const wz = p.z - sp.dx * sy + sp.dz * cy;
    let h = window.hitColliders(house.colliders, wx, wy, wz, sp.r);
    if (h) return h;
    if (house.movers) for (const m of house.movers) { h = window.hitColliders(m.colliders, wx, wy, wz, sp.r); if (h) return h; }   // obstáculos con movimiento (posición viva)
  }
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
  await Promise.all([load('loop', 'audio/drone_loop.mp3'), load('start', 'audio/drone_start.mp3'), load('crash', 'audio/crash2.mp3'),
    load('pop', 'audio/balloon_pop.mp3'), load('deadwin', 'audio/arcade_win.mp3')]);   // Pixabay, elegidos por Jorge 2026-07-11 (globo 3 + arcade 1)
  if (buffers.loop) buffers.loop = makeSeamless(buffers.loop, 0.12);   // loop INFINITO sin corte (Jorge 2026-07-11)
}
// El mp3 trae silencio de encoder en los bordes → en loop se OYE el corte en cada vuelta (hover).
// Fix una sola vez al cargar: recortar los bordes casi-silencio y hornear un CROSSFADE cola→cabeza
// (potencia constante) → el buffer resultante loopea continuo. Lo usan el loop de vuelo y el ventilador.
function makeSeamless(buf, xfSec) {
  const sr = buf.sampleRate, ch = buf.numberOfChannels, TH = 0.003;
  let s = 0, e = buf.length - 1;
  const d0 = buf.getChannelData(0);
  while (s < e && Math.abs(d0[s]) < TH) s++;
  while (e > s && Math.abs(d0[e]) < TH) e--;
  const len = e - s + 1, xf = Math.min(Math.round(xfSec * sr), Math.floor(len / 4));
  const outLen = len - xf;
  if (outLen < sr * 0.2) return buf;                 // demasiado corto tras recortar: dejarlo como está
  const out = AC.createBuffer(ch, outLen, sr);
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < outLen; i++) dst[i] = src[s + i];
    for (let i = 0; i < xf; i++) {                   // cabeza = cabeza·sin + cola·cos (equal-power)
      const a = (i / xf) * Math.PI / 2;
      dst[i] = src[s + i] * Math.sin(a) + src[s + outLen + i] * Math.cos(a);
    }
  }
  return out;
}
// pitchVar = fracción de variación de tono EN VIVO (sonido que REPITE nunca suena idéntico; regla dura Jorge)
const _lastRate = {};
function playOne(name, gain = 1, pitchVar = 0) {
  if (!AC || !buffers[name] || !sound) return; const s = AC.createBufferSource(); s.buffer = buffers[name];
  if (pitchVar) {   // variación SENTIBLE: rango amplio + nunca dos seguidos parecidos (anti-repetición)
    // rango ASIMÉTRICO (Jorge): poco hacia lo grave, más hacia lo agudo → [1−0.45·pv, 1+pv]
    let r; do { r = 1 + (Math.random() * 1.45 - 0.45) * pitchVar; } while (_lastRate[name] != null && Math.abs(r - _lastRate[name]) < pitchVar * 0.45);
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

// sonido de VENTILADOR/propela por PROXIMIDAD (Jorge 2026-07-11): se oye al acercarse, volumen moderado.
// Reusa el loop de propela a rate 0.55 (más grave que el dron → se distingue). Gain por distancia a la
// fuente `snd` más cercana (fan/blower): pleno a ≤1.2 m, nada a 5.5 m, curva cuadrática, tope 0.18.
let fanSrc = null, fanGain = null;
function updateFanSound(dt) {
  const srcs = (house && house.movers) ? house.movers.filter(m => m.snd) : [];
  let d = Infinity;
  for (const m of srcs) d = Math.min(d, Math.hypot(phys.pos.x - m.snd.x, phys.pos.y - m.snd.y, phys.pos.z - m.snd.z));
  const near = Math.max(0, 1 - Math.max(0, d - 1.2) / 4.3);
  const target = (sound && srcs.length && state !== 'pre') ? 0.18 * near * near : 0;
  if (target > 0 && !fanSrc && AC && buffers.loop) {
    fanSrc = AC.createBufferSource(); fanSrc.buffer = buffers.loop; fanSrc.loop = true; fanSrc.playbackRate.value = 0.55;
    fanGain = AC.createGain(); fanGain.gain.value = 0; fanSrc.connect(fanGain).connect(AC.destination); fanSrc.start();
  }
  if (fanGain) fanGain.gain.value += (target - fanGain.gain.value) * Math.min(1, dt * 8);
  window.__fanGain = fanGain ? fanGain.gain.value : 0;   // observable para el smoke
}

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
      const r = await fetch(SCORE_URL + (SCORE_URL.includes('?') ? '&' : '?') + 'level=' + level + '&top=50');
      list = await r.json();
    } else {
      const r = await fetch(SCORE_URL + (SCORE_URL.includes('?') ? '&' : '?') + 'top=50', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, level, time }) });
      list = await r.json();
    }
  } catch (e) { list = []; }   // sin red / local → el juego sigue igual
  renderBoard(list, level, time, name);
}
function renderBoard(list, level, myTime, myName) {
  const el = $('#bBoard'); if (!el) return;
  if (!Array.isArray(list)) list = [];
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  let myShown = false, rows = '<div class="hd">Mejores tiempos · Nivel ' + (level + 1) + '</div>';
  list.slice(0, 5).forEach((r, i) => {
    const me = !myShown && !ghost && r.name === myName && Math.abs(r.time - myTime) < 0.01;
    if (me) myShown = true;
    rows += '<div class="' + (me ? 'me' : '') + '">' + (i + 1) + '. ' + esc(r.name) + ' — ' + (+r.time).toFixed(1) + 's</div>';
  });
  // TU PUESTO siempre visible (Jorge 2026-07-12): en modo "sin marca" es el puesto que TENDRÍAS (no publica);
  // compitiendo, si no saliste en el top-5 se agrega tu fila abajo. Lista top-50 → más allá se dice ">50".
  if (!myShown) {
    const ahead = list.filter(r => +r.time < myTime - 0.005).length;
    const place = ahead >= 50 ? '>50' : '#' + (ahead + 1);
    rows += '<div class="me">' + (ghost ? '→ Irías ' + place + ' — ' + myTime.toFixed(1) + 's (sin marca)'
                                        : '→ Vas ' + place + ' — ' + myTime.toFixed(1) + 's') + '</div>';
  }
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
  else if (state === 'win') { if (drone) drone.visible = true; levelIdx = levelIdx >= 59 ? levelIdx : levelIdx + 1; LS.set('unlocked', Math.max(LS.get('unlocked', 0), levelIdx)); buildLevel(levelIdx); }
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
  if (!win) {   // el dron EXPLOTÓ: congelar la física — si sigue con inercia, el "fantasma" invisible
    // atraviesa paredes y la cámara (que persigue phys.pos) termina detrás de muros, lejos del despiece
    _impactV = { x: phys.vel.x, y: phys.vel.y, z: phys.vel.z };   // guardar ANTES de congelar (rebote del peluche)
    phys.speed = 0; phys.yawVel = 0; phys.vel = { x: 0, y: 0, z: 0 };
  }
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
    // TIEMPO + LEADERBOARD visibles al ganar (restaurado Jorge 2026-07-12; el resto de la UI sigue minimal)
    $('#bTitle').textContent = (isBest && best != null ? '🏆 ¡NUEVO MEJOR TIEMPO! · ' : '¡Llegaste! · ') + levelTime.toFixed(1) + 's';
    $('#bHint').textContent = '';
    $('#bBoard').innerHTML = ''; $('#banner').classList.remove('hidden');
    submitScore(levelIdx, levelTime);                                          // envía (o solo lee en modo sin marca) + pinta la tabla
  } else {
    // NO tapamos la pantalla: se VE el choque — el dron se parte en SUS pedazos reales y la animación sigue.
    const noBattery = phys.battery <= 0;
    crashCraft();
    showBanner(noBattery ? '🔋 Sin batería' : '💥 ¡Chocaste!', '');
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
    const inp0 = controls.update();
    const inp = state === 'lose' ? { thr: 0, yaw: 0 } : inp0;   // tras explotar el input ya no maneja al fantasma (en win sigue vivo — diseño v0.3.8)
    const groundY = house && house.terrainY ? house.terrainY(phys.pos.x, phys.pos.z) : 0;   // escalera/rampa
    phys.t.midHeight = effFH(phys.pos.x, phys.pos.z);   // menos aire arriba → vuela más pegado al piso local
    phys.update(dt, { thr: inp.thr, yaw: inp.yaw, groundY });

    // el PELUCHE que rebota manda: phys.pos lo sigue (ya no integra tras el choque) → la cámara,
    // el keepDroneInView y los muros-transparentes siguen al oso, nunca lo pierden de cuadro
    if (state === 'lose' || state === 'win') {
      const bt = debris.find(d => d.stay);
      if (bt) { phys.pos.x = bt.mesh.position.x; phys.pos.y = bt.mesh.position.y; phys.pos.z = bt.mesh.position.z; }
    }
    // aplicar a la malla
    if (drone) {
      drone.position.set(phys.pos.x, phys.pos.y, phys.pos.z);
      // −yaw: en Three.js +rotation.y es ANTIhorario; el rumbo de la física gira horario al dar derecha.
      // Con el signo negativo la malla gira igual que el rumbo (derecha=horario) y la nariz mira a donde vuela.
      drone.rotation.y = -phys.yaw;
      // pitch: acelerar adelante → NARIZ ABAJO (−rotation.x, porque la nariz mira a −Z); reversa → cola abajo.
      const tp = drone.userData.tilt; if (tp) { tp.rotation.x = -phys.tilt; tp.rotation.z = phys.roll; }
      for (const r of rotors) r.rotateOnAxis(r.userData.spinAxis || _AXY, phys.rotorRPM * dt * (r.userData.spinDir || 1));   // gira sobre SU eje vertical real (pivotes con ejes girados en el GLB)
      // ALETEO de la mariposa: batir alrededor del eje del cuerpo; frecuencia = rotorRPM del tune
      for (const w of wings) w.quaternion.setFromAxisAngle(w.userData.axis, w.userData.side * (0.14 + 0.42 * Math.sin(now / 1000 * phys.rotorRPM)));
    }

    // colisión (solo mientras vuela)
    if (state === 'fly') {
      levelTime = (now - levelStartT) / 1000; $('#timerV').textContent = levelTime.toFixed(1);   // cronómetro
      if (phys.state === 'crashed') {
        // PILA AGOTADA: cae con física… y se comporta IGUAL que volando (Jorge 2026-07-11):
        // si en la caída toca pared/objeto → despiece AHÍ; si llega al piso → se rompe en el piso.
        if (hitWorld(phys.pos) || phys.pos.y <= phys.groundY + 0.06) endLevel(false);
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
        _impactV = { x: phys.vel.x, y: phys.vel.y, z: phys.vel.z };
        crashCraft();
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
    updateFanSound(dt);
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
  // ⭐ CÁMARA-HÉROE (Jorge): tras el GOL DE MUERTO enfoca la PIEZA ganadora y la sigue de inmediato
  if (_heroPiece && state === 'win') {
    const hp = _heroPiece.mesh.position;
    const dx = cam.position.x - hp.x, dz = cam.position.z - hp.z, hl = Math.hypot(dx, dz) || 1;
    _camGoal.set(hp.x + (dx / hl) * 2.3, hp.y + 1.25, hp.z + (dz / hl) * 2.3);
    cam.position.lerp(_camGoal, Math.min(1, 8 * dt));
    if (house) {
      const b = house.bounds, mM = 0.28;
      cam.position.x = Math.max(b.minX + mM, Math.min(b.maxX - mM, cam.position.x));
      cam.position.z = Math.max(b.minZ + mM, Math.min(b.maxZ - mM, cam.position.z));
      cam.position.y = Math.min(Math.max(cam.position.y, 0.4), house.ceilingY - 0.12);
    }
    cam.lookAt(hp.x, hp.y, hp.z);
    return;
  }
  // tras CHOCAR: ZOOM-OUT RÁPIDO y amplio → se ve el despiece entero y un posible GOL DE MUERTO (Jorge)
  const back = state === 'lose' ? 7.2 : 2.5, up = state === 'lose' ? 3.4 : 0.9;
  const lerpK = state === 'lose' ? 10 : 6;
  // la cámara RETRASA el giro respecto al dron → al girar SE VE al dron rotar sobre su propio eje
  let d = phys.yaw - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * Math.min(1, 3.2 * dt);
  const bx = Math.sin(camYaw), bz = -Math.cos(camYaw);   // dirección de cámara (retrasada)
  let gy = phys.pos.y + up;
  if (house) gy = Math.min(gy, house.ceilingY - 0.18);       // no atravesar el techo
  _camGoal.set(phys.pos.x - bx * back, gy, phys.pos.z - bz * back);
  cam.position.lerp(_camGoal, Math.min(1, lerpK * dt));
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
let _wallSnap = false;   // al entrar en lose/win se restaura todo UNA vez (la pared del choque reaparece al instante)
const _crashWalls = new Set();   // paredes del CHOQUE (a <0.9 del punto): NUNCA se desvanecen en lose/win
function updateWallTransparency(dt) {
  if (!house || !drone) return;
  // También en 'lose'/'win': el zoom-out del choque puede dejar muros ENTRE cámara y despiece →
  // se desvanecen igual que en vuelo "para poder ver" (Jorge 2026-07-11). PERO la pared del CHOQUE
  // queda EN PIE (regla original de Jorge, reafirmada 2026-07-11 "las paredes explotan → revertir"):
  // (a) snap-restauro todo al entrar al choque (venía desvanecida por la aproximación) y
  // (b) el ray se queda corto (no alcanza la pared pegada al despiece) — ver abajo.
  if (state === 'lose' || state === 'win') {
    if (!_wallSnap) {
      _wallSnap = true;
      _crashWalls.clear();
      for (const w of house.walls) {
        const m = w.material; m.opacity = 1; if (m.transparent) { m.transparent = false; m.needsUpdate = true; } m.depthWrite = true; m.userData._bt = 99;
        // pared(es) del choque por IDENTIDAD (un margen de distancia en el ray no es robusto: la cámara
        // alta+diagonal cruza la cara del muro hasta ~0.9 antes del despiece que quedó DENTRO del muro)
        const p = w.geometry.parameters;
        const dx = Math.max(0, Math.abs(phys.pos.x - w.position.x) - p.width / 2);
        const dz = Math.max(0, Math.abs(phys.pos.z - w.position.z) - p.depth / 2);
        // radio 0.5 = radio del dron (0.30) + colchón: SOLO la pared realmente tocada (el despiece queda
        // pegado/dentro de ella). Con 0.9 caían también paredes vecinas de pasillo que SÍ deben desvanecer.
        if (dx * dx + dz * dz < 0.5 * 0.5) _crashWalls.add(w);
      }
    }
  } else { _wallSnap = false; if (_crashWalls.size) _crashWalls.clear(); }
  const tgt = (_heroPiece && state === 'win') ? _heroPiece.mesh.position : phys.pos;   // en gol de muerto la cámara sigue a la PIEZA
  const cx = cam.position.x, cz = cam.position.z;
  const to = _wv1.set(tgt.x, tgt.y + 0.1, tgt.z);
  const dir = _wv2.subVectors(to, cam.position);
  const dist = dir.length();
  let blockers = null;
  if (dist > 0.05) {
    dir.normalize();
    // En vuelo el ray pasa 0.4 más allá del dron (muro inminente también se apaga). Tras chocar NO:
    // la pared del choque debe seguir EN PIE (Jorge: "las paredes explotan → revertir"). Ojo: phys.pos
    // queda hasta ~0.45 DENTRO del muro (penetra radio 0.30 + avance del frame) → el ray se queda
    // 0.65 ANTES del despiece para no alcanzar la cara del muro chocado.
    _wallRay.set(cam.position, dir);
    _wallRay.far = (state === 'lose' || state === 'win') ? Math.max(0.1, dist - 0.65) : dist + 0.4;
    const hits = _wallRay.intersectObjects(house.walls, false);
    if (hits.length) blockers = new Set(hits.map(h => h.object));
  }
  // dos muros pueden COMPARTIR material → decidir por MATERIAL (si cualquiera bloquea, se desvanece);
  // si no, un muro pide 0.06 y el otro 1 sobre el mismo material y queda oscilando a medias (caso lv10).
  const matBlock = new Map();
  for (const w of house.walls) {
    let block = (blockers ? blockers.has(w) : false) && !_crashWalls.has(w);   // pared del choque: EN PIE siempre
    if (!block && !_crashWalls.has(w)) {   // muro PEGADO a la cámara (la cámara quedó dentro/detrás → el ray no lo detecta)
      const p = w.geometry.parameters;
      const dx = Math.max(0, Math.abs(cx - w.position.x) - p.width / 2);
      const dz = Math.max(0, Math.abs(cz - w.position.z) - p.depth / 2);
      if (dx * dx + dz * dz < 0.45 * 0.45) block = true;
    }
    matBlock.set(w.material, (matBlock.get(w.material) || false) || block);
  }
  for (const [m, block] of matBlock) {
    // HISTÉRESIS anti-flicker: el ray puede rozar el borde del muro y alternar por frame → el lerp
    // queda a medias (~0.5, "muro fantasma"). Bloqueado se queda 0.35 s tras el último bloqueo.
    const ud = m.userData;
    ud._bt = block ? 0 : (ud._bt == null ? 99 : ud._bt + dt);
    const eff = ud._bt < 0.35;
    const target = eff ? 0.06 : 1;
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
    if (!playOne('pop', 1, 0.30)) synthPop(1);   // globo REAL (Pixabay, Jorge); repite → pitch-var; synth solo de fallback
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
  THREE, get state() { return state; }, phys, controls, cam, renderer, get debris() { return debris; }, playOne, get buffers() { return buffers; },
  get house() { return house; }, get drone() { return drone; },
  setLevel(n) { levelIdx = n; buildLevel(n); },
  takeoff: doTakeoff,
  hit(x, y, z) { return hitWorld({ x, y, z }); },   // prueba: ¿el collider de la nave choca en (x,y,z)?
  collider() { return CRAFT_COLLIDER[craft] || CRAFT_COLLIDER.drone; },
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
