// aircraft_glb.js — carga un helicóptero desde un GLB de Sketchfab y lo adapta al sim:
// orienta nariz=+X / arriba=+Y, escala a una longitud objetivo, apoya patines en y=0,
// cablea los rotores (nodos nombrados) a PIVOTES con el eje de giro correcto + disco de blur,
// y tinta cualquier material blanco/sin-textura (regla "cero blanco"). Devuelve un Group YA
// (se puebla async cuando el GLB termina de cargar); main.js gira userData.rotor/tailRotor.
import { Group, Box3, Vector3, MeshStandardMaterial, Mesh, BufferGeometry, Float32BufferAttribute, CylinderGeometry, BoxGeometry, ConeGeometry, MeshBasicMaterial, AdditiveBlending } from '../vendor/three.module.js?v=1.39.0';

// POSTQUEMADOR: cono de llama additive en la tobera (apunta a −X). Devuelve el grupo; main.js
// escala su largo + opacidad con el gas (g.userData.afterburner). Doble cono: naranja exterior + núcleo claro.
function makeAfterburner(x, r) {
  const grp = new Group(); grp.position.set(x, 0, 0);
  const outer = new Mesh(new ConeGeometry(r, r * 5, 16, 1, true), new MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  const inner = new Mesh(new ConeGeometry(r * 0.55, r * 3.2, 14, 1, true), new MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  for (const c of [outer, inner]) { c.rotation.z = Math.PI / 2; c.position.x = -c.geometry.parameters.height / 2; grp.add(c); }   // base en la tobera, llama hacia atrás
  grp.userData.outer = outer; grp.userData.inner = inner;
  return grp;
}
import { GLTFLoader } from '../vendor/GLTFLoader.js?v=1.39.0';
import { addRotorDisc } from './rotorblur.js?v=1.39.0';

// CIRUGÍA DE ROTOR: el rotor viene FUNDIDO en la malla → extrae los triángulos por encima de
// `frac` de la altura (el rotor está arriba) a un PIVOTE que gira en Y, y los quita del cuerpo.
function splitRotor(g, s, frac, discR, maxR = 1e9, nBlades = 0) {
  const fb = new Box3().setFromObject(s);
  const yT = fb.min.y + frac * (fb.max.y - fb.min.y);
  const rotorParts = []; let cN = 0;
  // bbox del rotor → su CENTRO geométrico es el eje de giro (no el centroide, que se descentra)
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  const acc = v => { if (v.x < xmin) xmin = v.x; if (v.x > xmax) xmax = v.x; if (v.y < ymin) ymin = v.y; if (v.y > ymax) ymax = v.y; if (v.z < zmin) zmin = v.z; if (v.z > zmax) zmax = v.z; };
  const vA = new Vector3(), vB = new Vector3(), vC = new Vector3();
  s.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const geo = o.geometry, pos = geo.attributes.position, idx = geo.index;
    o.updateWorldMatrix(true, false); const mw = o.matrixWorld;
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const body = [], rotorPos = [];
    for (let t = 0; t < tri; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      vA.fromBufferAttribute(pos, ia).applyMatrix4(mw);
      vB.fromBufferAttribute(pos, ib).applyMatrix4(mw);
      vC.fromBufferAttribute(pos, ic).applyMatrix4(mw);
      const cxz = Math.hypot((vA.x + vB.x + vC.x) / 3, (vA.z + vB.z + vC.z) / 3);   // dist XZ al centro (modelo centrado en 0)
      if ((vA.y + vB.y + vC.y) / 3 > yT && cxz < maxR) {
        rotorPos.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
        acc(vA); acc(vB); acc(vC); cN += 3;
      } else body.push(ia, ib, ic);
    }
    if (rotorPos.length) {
      geo.setIndex(body);                                  // el cuerpo se queda sin los triángulos del rotor
      const rg = new BufferGeometry(); rg.setAttribute('position', new Float32BufferAttribute(rotorPos, 3)); rg.computeVertexNormals();
      rotorParts.push({ geo: rg, mat: o.material });
    }
  });
  if (!cN) return false;
  const center = new Vector3((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2);   // CENTRO del rotor = eje de giro
  const pivot = new Group(); pivot.position.copy(g.worldToLocal(center.clone())); g.add(pivot);
  if (nBlades > 0) {
    // el rotor del modelo se DESCARTA (ya salió del cuerpo) y se pone uno PROCEDURAL limpio (gira centrado, sin basura)
    const mat = new MeshStandardMaterial({ color: 0x1b1d1a, roughness: 0.7, metalness: 0.1 });
    pivot.add(new Mesh(new CylinderGeometry(discR * 0.09, discR * 0.11, 0.06, 14), mat));   // hub
    for (let i = 0; i < nBlades; i++) {
      const arm = new Group(); arm.rotation.y = i * Math.PI * 2 / nBlades;
      const bl = new Mesh(new BoxGeometry(discR * 0.97, 0.014, discR * 0.075), mat);
      bl.position.x = discR * 0.5; arm.add(bl); pivot.add(arm);
    }
  } else {
    for (const { geo, mat } of rotorParts) { geo.translate(-center.x, -center.y, -center.z); pivot.add(new Mesh(geo, mat)); }
  }
  addRotorDisc(pivot, discR, 'y', 0.45); g.userData.rotor = pivot;
  return true;
}

const _loader = new GLTFLoader();

// tinta materiales blancos/sin-textura a un color dado (no toca los que tienen mapa ni el vidrio)
function killWhite(scene, tint) {
  scene.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.transparent) continue;                 // dejar vidrio/transparentes
      const c = m.color;
      const noMap = !m.map;
      const whiteish = c && (c.r + c.g + c.b) / 3 > 0.6;  // gris claro o blanco
      if (noMap && whiteish) { c.setRGB(tint[0], tint[1], tint[2]); m.metalness = Math.min(m.metalness ?? 0.1, 0.15); m.roughness = 0.7; }
    }
  });
}

// BRILLO: los GLB PBR salen oscuros sin environment map (metalness → negro, texturas militares
// oscuras). Baja metalness, suaviza roughness y da un PISO de brillo (auto-iluminación) para que
// no queden nunca apagados. `lift` = intensidad del piso (0.3-0.5).
function brightenGLB(scene, lift = 0.38) {
  scene.traverse(o => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || m.transparent) continue;
      if ('metalness' in m) m.metalness = Math.min(m.metalness ?? 0, 0.12);   // metal sin envMap = oscuro
      if ('roughness' in m) m.roughness = Math.min(m.roughness ?? 1, 0.72);
      if (m.emissive) {
        if (m.map) { m.emissiveMap = m.map; m.emissive.setRGB(lift, lift, lift); m.emissiveIntensity = 1; }  // textura se auto-ilumina
        else { m.emissive.copy(m.color).multiplyScalar(lift * 0.7); }                                          // color plano: piso de brillo
      }
      m.needsUpdate = true;
    }
  });
}

// reparenta el nodo del rotor a un pivote con eje propio (Y=principal, Z=cola) + disco translúcido
function wireRotor(g, scene, nodeName, key, axis, discR) {
  const node = scene.getObjectByName(nodeName);
  if (!node) { console.warn('[glb] rotor no hallado:', nodeName); return; }
  node.updateWorldMatrix(true, false);
  const wp = node.getWorldPosition(new Vector3());
  const pivot = new Group();
  pivot.position.copy(g.worldToLocal(wp.clone()));   // pos del rotor en el marco de g
  g.add(pivot);
  pivot.attach(node);                                 // conserva la pose mundial del nodo
  addRotorDisc(pivot, discR, axis, axis === 'y' ? 0.45 : 0.55);
  g.userData[key] = pivot;
}

// === ANÁLISIS AUTOMÁTICO del modelo (para integrar un avión nuevo casi sin calibrar a mano) ===
// recoge todos los vértices del modelo en coords mundo
function collectVerts(s) {
  const V = []; const v = new Vector3();
  s.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { o.updateWorldMatrix(true, false); const p = o.geometry.attributes.position, mw = o.matrixWorld; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mw); V.push([v.x, v.y, v.z]); } } });
  return V;
}
// AUTO-ORIENTAR (giro en Y): prueba las 4 rotaciones {0,90,180,270} y elige la que (a) deja el eje
// LARGO en X y (b) la punta ANGOSTA (nariz) en +X. Asume up=+Y (estándar glTF). Devuelve el ángulo.
function autoOrientY(V) {
  let bestRot = 0, bestScore = -Infinity;
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    const X = new Array(V.length);
    for (let i = 0; i < V.length; i++) { const x = V[i][0] * cs + V[i][2] * sn; const z = -V[i][0] * sn + V[i][2] * cs; X[i] = x; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (z < zmin) zmin = z; if (z > zmax) zmax = z; const _ = z; }
    const spanX = xmax - xmin, spanZ = zmax - zmin;
    if (spanX < spanZ) continue;                              // el eje largo debe quedar en X
    // sección transversal (área YZ aprox) en el extremo +X (10%) vs −X → la nariz es la más angosta
    const t = spanX * 0.12; let aFront = 0, aBack = 0;
    let fy0 = Infinity, fy1 = -Infinity, fz0 = Infinity, fz1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let i = 0; i < V.length; i++) { const z = -V[i][0] * sn + V[i][2] * cs, y = V[i][1];
      if (X[i] > xmax - t) { if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; if (z < fz0) fz0 = z; if (z > fz1) fz1 = z; }
      else if (X[i] < xmin + t) { if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; } }
    aFront = (fy1 - fy0) * (fz1 - fz0); aBack = (by1 - by0) * (bz1 - bz0);
    const score = spanX + (aBack - aFront) * 3;               // largo en X + nariz(+X) más angosta que cola
    if (score > bestScore) { bestScore = score; bestRot = rot; }
  }
  return bestRot;
}
// ALTURA del eje de rol = centro del TUBO del fuselaje. Rebanadas a lo largo de X, en cada una la
// MEDIANA de Y (robusta a la deriva/canopy), filtrando alas por |Z|. Devuelve frac de la semi-altura.
function fuselageFrac(V) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmax = -Infinity;
  for (const p of V) { if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0]; if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; if (Math.abs(p[2]) > zmax) zmax = Math.abs(p[2]); }
  const lenX = xmax - xmin, half = (ymax - ymin) / 2, cY = (ymin + ymax) / 2, zFus = zmax * 0.36;
  const NB = 24, dx = lenX / NB, meds = [];
  for (let bi = Math.floor(NB * 0.15); bi < Math.floor(NB * 0.85); bi++) {
    const lo = xmin + bi * dx, hi = lo + dx, ys = [];
    for (const p of V) if (p[0] >= lo && p[0] < hi && Math.abs(p[2]) < zFus) ys.push(p[1]);
    if (ys.length < 6) continue; ys.sort((a, b) => a - b); meds.push(ys[ys.length >> 1]);
  }
  if (!meds.length) return 0;
  meds.sort((a, b) => a - b);
  return (meds[meds.length >> 1] - cY) / half;                // frac respecto al centro del bbox
}

// opts: { url, len(longitud objetivo en X tras orientar), rotX,rotY,rotZ (alinear nariz=+X),
//         autoOrient(bool: deduce rotY), centerAxis(número frac o 'auto'),
//         mainRotor, tailRotor (nombres de nodo), mainDiscR, tailDiscR, tint([r,g,b]) }
export function buildGLBHeli(opts) {
  const g = new Group();
  _loader.load(opts.url, (gltf) => {
    const s = gltf.scene;
    // 1) orientar — manual (rotX/Y/Z) o AUTOMÁTICO (PCA-lite: deduce el giro Y que pone la nariz en +X)
    let rotY = opts.rotY || 0;
    if (opts.autoOrient) { s.updateMatrixWorld(true); rotY = autoOrientY(collectVerts(s)); console.log('[glb] autoOrient rotY=', (rotY * 180 / Math.PI).toFixed(0), '°', opts.url); }
    s.rotation.set(opts.rotX || 0, rotY, opts.rotZ || 0);
    s.updateMatrixWorld(true);
    // 2) escalar por la dimensión X tras orientar (la longitud nariz→cola), recentrar XZ, apoyar en y=0
    let box = new Box3().setFromObject(s);
    let size = box.getSize(new Vector3());
    const sc = (opts.len || 3.2) / Math.max(size.x, 0.001);
    s.scale.setScalar(sc);
    s.updateMatrixWorld(true);
    box = new Box3().setFromObject(s);
    const c = box.getCenter(new Vector3());
    s.position.x -= c.x; s.position.z -= c.z;
    if (opts.centerAxis != null) {                       // AVIONES: eje de rol en el centro del FUSELAJE (rol correcto + tobera/fuego al centro)
      // frac de la semi-altura desde el centro del bbox (negativo = bajar, porque la deriva/canopy suben el bbox).
      // 'auto' = lo deduce (rebanadas+mediana); número = valor elegido visualmente (más exacto).
      const frac = opts.centerAxis === 'auto' ? fuselageFrac(collectVerts(s)) : (typeof opts.centerAxis === 'number' ? opts.centerAxis : 0);
      if (opts.centerAxis === 'auto') console.log('[glb] centerAxis auto frac=', frac.toFixed(3), opts.url);
      const half = (box.max.y - box.min.y) / 2, axisY = c.y + frac * half;
      s.position.y -= axisY; g.userData.bottomBelow = axisY - box.min.y;
    } else {
      s.position.y -= box.min.y;                         // helis: patines en y=0
    }
    s.updateMatrixWorld(true);
    // 3) cero blanco + brillo (PBR oscuro sin envMap → piso de luz)
    if (opts.tint) killWhite(s, opts.tint);
    brightenGLB(s, opts.lift ?? 0.4);
    g.add(s);
    // 4) rotores a pivotes (tras estar s dentro de g y con matrices al día)
    g.updateMatrixWorld(true);
    if (opts.mainRotor) wireRotor(g, s, opts.mainRotor, 'rotor', 'y', opts.mainDiscR || 1.6);
    if (opts.tailRotor) wireRotor(g, s, opts.tailRotor, 'tailRotor', 'z', opts.tailDiscR || 0.3);
    // 4a) rotor FUNDIDO pero EXTRAÍBLE por altura → cirugía: el rotor real gira
    if (opts.splitRotorY) splitRotor(g, s, opts.splitRotorY, opts.mainDiscR || 1.5, opts.splitRotorR ?? 1e9, opts.procBlades ?? 0);
    // 4b) rotor FUNDIDO sin extraer: disco de blur procedural sobre el cubo
    const fb = new Box3().setFromObject(s);                    // bbox final del modelo orientado/escalado
    if (opts.procMainR) {
      const pv = new Group(); pv.position.set(0, fb.max.y * (opts.procMainY ?? 0.96), 0); g.add(pv);
      addRotorDisc(pv, opts.procMainR, 'y', 0.45); g.userData.rotor = pv;
    }
    if (opts.procTailR) {
      const pv = new Group(); pv.position.set(fb.min.x * (opts.procTailX ?? 0.92), fb.max.y * (opts.procTailY ?? 0.55), 0); g.add(pv);
      addRotorDisc(pv, opts.procTailR, 'z', 0.55); g.userData.tailRotor = pv;
    }
    // 5) POSTQUEMADOR (jets) — llama en la tobera; main.js la escala con el gas
    if (opts.afterburner) {
      const ab = makeAfterburner(fb.min.x * (opts.afterburner.x ?? 0.98), opts.afterburner.r ?? (fb.max.y - fb.min.y) * 0.18);
      g.add(ab); g.userData.afterburner = ab;
    }
  }, undefined, (e) => console.error('[glb] error cargando', opts.url, e));
  return g;
}
