// scene_house.js — Construye el interior "casa de juguetes" de un nivel: piso, muros, techo,
// obstáculos (muebles/juguetes), trampas, PUNTOS a recolectar y el punto de llegada en el aire.
//
// MUNDOS (10): cada nivel es una UNIÓN de rectángulos (rooms + pasillos). Los muros se generan
// automáticamente por "marcha de grilla": una pared existe en todo borde entre una celda con piso
// y una sin piso. Donde dos rects se solapan/tocan, ambos lados son piso → NO hay pared = APERTURA.
// Así un cuarto "se abre" por un pasillo hacia otros lugares sin gestionar puertas a mano.
//
// COLISIÓN PRECISA: colliders con forma real (box / sphere / cyl), no la caja envolvente. El dron es
// una esfera; choca sólo si toca la forma real del objeto (p.ej. pasa al lado del poste fino de la lámpara).
//
// La parte de GEOMETRÍA es PURA (sin THREE) → exportable a node para validar todos los niveles
// (start/goal/puntos sobre piso + conectividad) y la precisión de colisión, sin navegador.
//
// API navegador: buildHouse(THREE, scene, levelIdxOrDef) → {
//   colliders:[...formas], floorY, ceilingY, walls, start:{x,z}, goal:{pos,mesh},
//   traps:[{pos,r,mesh,armed}], collectibles:[{pos,mesh,taken}], group, bounds
// }

(function () {
  const CELL = 0.5;    // resolución de la grilla de piso (m)
  const TH = 0.30;     // grosor de muro (m)

  // ---------------------------------------------------------------------------
  // NIVELES (10). Unidades = metros. rects = rooms/pasillos (se unen; solapan = apertura).
  // points = puntos a recolectar (definen el recorrido; hay que juntarlos ANTES de la meta).
  // ---------------------------------------------------------------------------
  const LEVELS = [
    { // 1 — TUTORIAL: una sala, recto. Enseña despegar + avanzar + recolectar.
      name: 'Cuarto de juegos', tutorial: true, ceiling: 3.4,
      rects: [{ x: 0, z: 0, w: 7, d: 12 }],
      start: { x: 0, z: 4.5 }, goal: { x: 0, y: 2.6, z: -4.5 },
      points: [{ x: 0, z: 2 }, { x: 0, z: -1.5 }],
      obstacles: [{ type: 'teddy', x: 2.4, z: 0 }, { type: 'lamp', x: -2.6, z: 2 }],
      traps: [],
    },
    { // 2 — TUTORIAL: sala → pasillo (se abre) → sala. Enseña cruzar una apertura.
      name: 'Dos cuartos', tutorial: true, ceiling: 3.2,
      rects: [{ x: 0, z: 4, w: 6, d: 6 }, { x: 0, z: 0, w: 2.2, d: 3 }, { x: 0, z: -4, w: 6, d: 6 }],
      start: { x: 0, z: 6 }, goal: { x: 0, y: 2.6, z: -5.5 },
      points: [{ x: 0, z: 2.5 }, { x: 0, z: 0 }, { x: 0, z: -3 }],
      obstacles: [{ type: 'lamp', x: -2, z: 5 }, { type: 'teddy', x: 2, z: -5 }],
      traps: [{ x: 0, z: 0, r: 1.1, type: 'balloon' }],
    },
    { // 3 — L: sala, pasillo LATERAL (+X) que se abre a otra sala.
      name: 'La esquina', ceiling: 3.1,
      rects: [{ x: -3, z: 3, w: 6, d: 6 }, { x: 1, z: 1, w: 6, d: 2.2 }, { x: 5, z: -1, w: 5, d: 6 }],
      start: { x: -3, z: 5 }, goal: { x: 5, y: 2.6, z: -3 },
      points: [{ x: -3, z: 1 }, { x: 1, z: 1 }, { x: 5, z: 0 }],
      obstacles: [{ type: 'sofa', x: -4.5, z: 3 }, { type: 'lamp', x: 3, z: -1 }],   // sofá y lámpara lejos de start/meta/puntos
      traps: [{ x: 1, z: 1, r: 1.0, type: 'balloon' }],
    },
    { // 4 — T: sala, baja por pasillo, cruza en T; un punto en el brazo ciego (obliga a desviarse).
      name: 'El cruce', ceiling: 3.0,
      rects: [
        { x: 0, z: 4, w: 5, d: 5 }, { x: 0, z: 0, w: 2, d: 5 }, { x: 0, z: -2.5, w: 9, d: 2 },
        { x: -4, z: -4, w: 4, d: 4 }, { x: 4, z: -4, w: 4, d: 4 },
      ],
      start: { x: 0, z: 6 }, goal: { x: 4, y: 2.5, z: -4 },
      points: [{ x: 0, z: 1 }, { x: -4, z: -4 }, { x: 0, z: -2.5 }],
      obstacles: [{ type: 'lamp', x: -2, z: 5 }, { type: 'teddy', x: 5.5, z: -5 }],   // teddy lejos de la meta (4,-4)
      traps: [{ x: 0, z: -2.5, r: 1.0, type: 'robot' }],
    },
    { // 5 — U: baja por la izquierda, cruza abajo, sube por la derecha.
      name: 'La herradura', ceiling: 3.0,
      rects: [
        { x: -4, z: 3, w: 4, d: 6 }, { x: 0, z: 0, w: 10, d: 2 }, { x: 4, z: 3, w: 4, d: 6 },
      ],
      start: { x: -4, z: 5 }, goal: { x: 4, y: 2.5, z: 5 },
      points: [{ x: -4, z: 1 }, { x: 0, z: 0 }, { x: 4, z: 1 }],
      obstacles: [{ type: 'blocks', x: -4, z: 3 }, { type: 'lamp', x: 4, z: 3 }],
      traps: [{ x: 0, z: 0, r: 1.0, type: 'balloon' }],
    },
    { // 6 — Zigzag: 3 salas, 2 pasillos alternando lado.
      name: 'El zigzag', ceiling: 2.9,
      rects: [
        { x: -4, z: 4, w: 4, d: 4 }, { x: -1, z: 3, w: 4, d: 1.8 }, { x: 2, z: 1, w: 4, d: 5 },
        { x: -1, z: -1, w: 4, d: 1.8 }, { x: -4, z: -3, w: 4, d: 5 },
      ],
      start: { x: -4, z: 5 }, goal: { x: -4, y: 2.5, z: -4 },
      points: [{ x: -3, z: 3 }, { x: 2, z: 1 }, { x: -3, z: -1 }],
      obstacles: [{ type: 'lamp', x: -5, z: 3 }, { type: 'teddy', x: 2, z: 2.4 }],   // lámpara lejos del start (-4,5)
      traps: [{ x: -1, z: 3, r: 0.9, type: 'balloon' }, { x: -1, z: -1, r: 0.9, type: 'robot' }],
    },
    { // 7 — Cruz: sala central con 4 brazos; puntos a los lados obligan a recorrer todo.
      name: 'La cruz', ceiling: 2.9,
      rects: [
        { x: 0, z: 0, w: 3, d: 3 },
        { x: 0, z: 3, w: 2, d: 3 }, { x: 0, z: 5.5, w: 4, d: 3 },
        { x: 0, z: -3, w: 2, d: 3 }, { x: 0, z: -5.5, w: 4, d: 3 },
        { x: -3, z: 0, w: 3, d: 2 }, { x: -5.5, z: 0, w: 3, d: 4 },
        { x: 3, z: 0, w: 3, d: 2 }, { x: 5.5, z: 0, w: 3, d: 4 },
      ],
      start: { x: 0, z: -5.5 }, goal: { x: 0, y: 2.4, z: 5.5 },
      points: [{ x: -5.5, z: 0 }, { x: 5.5, z: 0 }, { x: 0, z: 0 }],
      obstacles: [{ type: 'teddy', x: -5.5, z: 1.4 }, { type: 'lamp', x: 5.5, z: -1.4 }],
      traps: [{ x: 0, z: 3, r: 0.9, type: 'balloon' }, { x: 0, z: -3, r: 0.9, type: 'robot' }],
    },
    { // 8 — Serpentina S: 4 salas encadenadas.
      name: 'La serpiente', ceiling: 2.8,
      rects: [
        { x: -4, z: 4, w: 4, d: 4 }, { x: -1, z: 4, w: 4, d: 1.8 }, { x: 3, z: 2, w: 4, d: 6 },
        { x: 3, z: -2, w: 1.8, d: 3 }, { x: 1, z: -4, w: 6, d: 3 }, { x: -2, z: -4, w: 1.8, d: 3 },
        { x: -4, z: -4, w: 4, d: 4 },
      ],
      start: { x: -4, z: 5 }, goal: { x: -4, y: 2.4, z: -4 },
      points: [{ x: -4, z: 3 }, { x: 3, z: 2 }, { x: 1, z: -4 }],
      obstacles: [{ type: 'lamp', x: -5, z: 4 }, { type: 'sofa', x: 3, z: 3.5 }],
      traps: [{ x: -1, z: 4, r: 0.9, type: 'balloon' }, { x: 3, z: -2, r: 0.9, type: 'robot' }],
      movers: [{ type: 'fan', x: -2, z: -4, y: 1.3, r: 0.7, axis: 'x', speed: 1.05 }],   // ventilador cruzando el pasillo bajo
    },
    { // 9 — Dos ramas que se reúnen abajo; puntos en ambas obligan a explorar las dos.
      name: 'Las dos alas', ceiling: 2.8,
      rects: [
        { x: 0, z: 5, w: 8, d: 4 },
        { x: -3, z: 2, w: 2, d: 3 }, { x: -3, z: -2, w: 4, d: 5 },
        { x: 3, z: 2, w: 2, d: 3 }, { x: 3, z: -2, w: 4, d: 5 },
        { x: 0, z: -4, w: 8, d: 2 },
      ],
      start: { x: 0, z: 6 }, goal: { x: 3, y: 2.4, z: -3.5 },
      points: [{ x: -3, z: -2 }, { x: 0, z: -4 }, { x: 3, z: 0 }],
      obstacles: [{ type: 'teddy', x: -4.5, z: -3.5 }, { type: 'lamp', x: 1.5, z: -2 }],  // teddy y lámpara lejos de puntos/meta
      traps: [{ x: -3, z: 2, r: 0.9, type: 'balloon' }, { x: 3, z: 2, r: 0.9, type: 'robot' }],
      movers: [{ type: 'pendulum', x: -1.5, z: -4, y: 2.4, len: 1.1, axis: 'z', swing: 0.62, speed: 1.5 }],   // péndulo cruzando el pasillo de abajo
    },
    { // 10 — Ático laberinto: techo bajo, más giros, trampas densas. El más difícil.
      name: 'El ático', ceiling: 2.7,
      rects: [
        { x: 0, z: 5, w: 4, d: 4 }, { x: 0, z: 2, w: 1.8, d: 3 }, { x: 0, z: 0, w: 6, d: 2.5 },
        { x: -3, z: -1, w: 1.8, d: 3 }, { x: -3, z: -3, w: 3, d: 3 }, { x: -1, z: -3, w: 4, d: 1.8 },
        { x: 2, z: -4, w: 1.8, d: 4 }, { x: 2, z: -5.5, w: 4, d: 3 },
      ],
      start: { x: 0, z: 6.5 }, goal: { x: 3, y: 2.3, z: -5.5 },
      points: [{ x: 0, z: 0 }, { x: -3, z: -3 }, { x: 0, z: 4 }],
      obstacles: [{ type: 'lamp', x: 1.5, z: 4 }, { type: 'blocks', x: -3, z: 0 }],   // lámpara MOVIDA (antes en 0,6 = spawn en la lámpara)
      traps: [{ x: 0, z: 2, r: 0.8, type: 'balloon' }, { x: -3, z: -1, r: 0.8, type: 'robot' }, { x: 2, z: -4, r: 0.8, type: 'balloon' }],
    },
    { // 11 — CASA DE 2 PISOS: planta baja (sur) → escalera de escalones ALTOS en un pasillo → piso alto (norte)
      // con rellano, pasillo y cuarto final (goal arriba). Complejidad de niveles previos + escalera + movers.
      name: 'Casa de 2 pisos', ceiling: 3.8, flightHeight: 1.3,
      rects: [
        // --- PLANTA BAJA (z >= 2) ---
        { x: 0, z: 8, w: 6, d: 6 },        // sala de inicio  x[-3,3] z[5,11]
        { x: -4.5, z: 8, w: 5, d: 4 },     // cuarto lateral  x[-7,-2] z[6,10]
        { x: 0, z: 4, w: 2.4, d: 4 },      // pasillo de bajada a la escalera  x[-1.2,1.2] z[2,6]
        // --- ESCALERA (z -2..2), pasillo x=0 ---
        { x: 0, z: 0, w: 2.4, d: 4.6 },    // z[-2.3,2.3]
        // --- PISO ALTO (z <= -2), a la altura H ---
        { x: 0, z: -4.5, w: 6, d: 5 },     // rellano  x[-3,3] z[-7,-2]
        { x: 3, z: -6, w: 4, d: 2.4 },     // pasillo alto +X  x[1,5] z[-7.2,-4.8]
        { x: 5.5, z: -8.5, w: 5, d: 5 },   // cuarto final  x[3,8] z[-11,-6]
      ],
      start: { x: 0, z: 9.5 }, goal: { x: 5.5, y: 2.6, z: -9 },
      points: [{ x: -4.5, z: 8 }, { x: 0, z: 0 }, { x: 4.2, z: -7.2 }],   // lateral(bajo) · escalera · cuarto final CERCA de la meta pero NO pegado (regla dura)
      obstacles: [{ type: 'teddy', x: 2.2, z: 9 }, { type: 'lamp', x: -6, z: 9 }],
      traps: [{ x: 0, z: 3, r: 0.9, type: 'balloon' }],
      movers: [
        { type: 'fan', x: 0, z: 4.5, y: 1.9, r: 0.85, axis: 'z', speed: 1.0 },                   // eje a 1.9 (0.6 SOBRE la altura de vuelo 1.3) → el dron se cuela entre aspas sin chocar el buje
        { type: 'gate', x: 3, z: -6, axis: 'z', panelW: 0.85, h: 1.55, speed: 0.9, baseY: 2.0 },  // puerta que abre/cierra en el pasillo alto (2º piso)
      ],
      // escalera: escalones ALTOS que suben de z=+2 (y=0) a z=-2 (y=2.0) → subida exagerada; norte de z=-2 = 2º piso a y=2.0
      stairs: { cx: 0, w: 2.2, zBot: 2, zTop: -2, H: 2.0, steps: 6 },
    },
    { // 12 — LA PISTA (rediseño): pista circular de MUROS BAJOS (1.8 m) dentro de un cuarto grande → la cámara
      // ve por ENCIMA (nunca tapa al dron). Entrada por un tramo RECTO (chute) que desemboca en la curva por una
      // apertura del muro externo; BARROTES (postes) junto a la entrada obligan a dar la vuelta completa.
      name: 'La pista', ceiling: 3.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],            // cuarto grande normal (muros perimetrales de grilla)
      ring: {
        cx: 0, cz: -0.5, rIn: 3.0, rOut: 5.2, h: 1.8,   // corredor curvo ancho 2.2, bordes BAJOS
        gapA0: 78 * Math.PI / 180, gapA1: 102 * Math.PI / 180,   // apertura del muro externo (sur) = boca del chute
        chute: { x: 1.18, t: 0.2, z0: 4.4, z1: 6.3 },   // 2 paredes bajas rectas (x=±1.18) → pasillo recto de entrada
        posts: [{ x: -0.867, z: 2.736 }, { x: -1.061, z: 3.460 }, { x: -1.255, z: 4.185 }],  // barrotes en φ=105° (r 0.16, no pasa el dron, SÍ pasa la vista)
      },
      start: { x: 0, z: 5.5 },                          // dentro del chute (recto) → entras de frente a la curva
      goal: { x: -1.92, y: 1.5, z: 3.12 },              // φ=118°, tras la vuelta COMPLETA (los barrotes cierran el atajo)
      points: [{ x: 2.35, z: 2.86 }, { x: 4.1, z: -0.5 }, { x: 0, z: -4.6 }, { x: -4.1, z: -0.5 }],   // el 1º (φ55°) es CEBO apenas entras → te jala a girar; luego este → norte → oeste
    },
    { // 13 — LA CURVA: media curva hacia la IZQUIERDA (renombrada; 'La herradura' ya existía en el 5): entras por el sur, sales por el hueco ESTE.
      // Desarrolla la curva de La pista; barrotes cierran el atajo corto → recorres la herradura larga.
      name: 'La curva', ceiling: 3.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0.5, w: 13, d: 13 }],
      ring: {
        cx: 0, cz: -0.5, rIn: 2.6, rOut: 4.6, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180], [346 * Math.PI / 180, 360 * Math.PI / 180], [0, 14 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 3.9, z1: 5.9 },
        posts: [{ x: 2.12, z: 1.62 }, { x: 2.55, z: 2.05 }, { x: 2.97, z: 2.47 }],   // φ45° → el corto está cerrado
      },
      start: { x: 0, z: 5.2 },
      goal: { x: 5.6, y: 1.5, z: -0.5 },               // afuera del hueco este, tras la herradura
      points: [{ x: -3.12, z: 1.3 }, { x: -3.12, z: -2.3 }, { x: 1.8, z: -3.62 }],   // oeste → suroeste → sureste
    },
    { // 14 — LA CONTRACURVA: la misma media curva… pero hacia el OTRO lado (pedido Jorge: curva para un
      // lado, curva para el otro). Sales por el hueco OESTE; los barrotes cierran el atajo zurdo.
      name: 'La contracurva', ceiling: 3.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0.5, w: 13, d: 13 }],
      ring: {
        cx: 0, cz: -0.5, rIn: 2.6, rOut: 4.6, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180], [166 * Math.PI / 180, 194 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 3.9, z1: 5.9 },
        posts: [{ x: -2.12, z: 1.62 }, { x: -2.55, z: 2.05 }, { x: -2.97, z: 2.47 }],   // φ135: el atajo por la izquierda está cerrado
      },
      start: { x: 0, z: 5.2 },
      goal: { x: -5.6, y: 1.5, z: -0.5 },
      points: [{ x: 3.12, z: 1.3 }, { x: 3.12, z: -2.3 }, { x: -1.8, z: -3.62 }],   // este → sureste → suroeste
    },
    { // 15 — EL ALTILLO: primera ESCALERA LARGA a un piso 1 real (H=2.2). La meta se esconde a la IZQUIERDA
      // arriba (el impulso es seguir derecho). Desarrolla la escalera del 11 con más altura.
      name: 'El altillo', ceiling: 4.6, flightHeight: 1.4,
      rects: [{ x: 0, z: 6, w: 10, d: 6 }, { x: 0, z: 0, w: 3, d: 6 }, { x: 0, z: -5.5, w: 10, d: 5 }],
      terrain: [
        { type: 'rampz', minx: -1.5, maxx: 1.5, z0: 3, z1: -3, h0: 0, h1: 2.2 },
        { type: 'plateau', minx: -5, maxx: 5, minz: -8, maxz: -3, h: 2.2 },
      ],
      start: { x: 0, z: 8 },
      goal: { x: -3.5, y: 2.6, z: -6.5 },
      points: [{ x: 2, z: 7 }, { x: 0, z: 0 }, { x: 3.5, z: -6.5 }],   // el último (derecha) es cebo; la meta está a la IZQUIERDA
      obstacles: [{ type: 'sofa', x: 2.2, z: 4.5 }],
      traps: [{ x: -2, z: 6.5, r: 0.9, type: 'balloon' }],
    },
    { // 16 — EL PUENTE: sube, cruza un puente con PÉNDULO, baja al otro lado. Desarrolla subir Y bajar.
      name: 'El puente', ceiling: 4.2, flightHeight: 1.3,
      rects: [{ x: -6, z: 0, w: 5, d: 9 }, { x: 0, z: 0, w: 7, d: 3 }, { x: 6, z: 0, w: 5, d: 9 }],
      terrain: [
        { type: 'rampx', minz: -1.5, maxz: 1.5, x0: -3.5, x1: -1.5, h0: 0, h1: 2 },
        { type: 'plateau', minx: -1.5, maxx: 1.5, minz: -1.5, maxz: 1.5, h: 2 },
        { type: 'rampx', minz: -1.5, maxz: 1.5, x0: 1.5, x1: 3.5, h0: 2, h1: 0 },
      ],
      start: { x: -6, z: 2.5 },
      goal: { x: 6, y: 1.3, z: -2.6 },
      points: [{ x: -6, z: -2.6 }, { x: -2.5, z: 0 }, { x: 6, z: 2.6 }],   // el 1º está DETRÁS-izquierda al arrancar
      obstacles: [{ type: 'blocks', x: -6, z: -0.5 }, { type: 'lamp', x: 6, z: 0.5 }],
      movers: [{ type: 'pendulum', x: 0, z: 0, y: 1.6, len: 1.0, axis: 'z', swing: 0.55, speed: 1.4, baseY: 2 }],
    },
    { // 17 — LA OLA: pura rampa de skate — tres olas seguidas, el vuelo sube y baja con el terreno.
      name: 'La ola', ceiling: 5.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 6, d: 24 }],
      terrain: [
        { type: 'rampz', minx: -3, maxx: 3, z0: 9, z1: 7, h0: 0, h1: 1.5 }, { type: 'rampz', minx: -3, maxx: 3, z0: 7, z1: 5, h0: 1.5, h1: 0 },
        { type: 'rampz', minx: -3, maxx: 3, z0: 4, z1: 2, h0: 0, h1: 2.1 }, { type: 'rampz', minx: -3, maxx: 3, z0: 2, z1: 0, h0: 2.1, h1: 0 },
        { type: 'rampz', minx: -3, maxx: 3, z0: -1, z1: -3, h0: 0, h1: 2.7 }, { type: 'rampz', minx: -3, maxx: 3, z0: -3, z1: -5, h0: 2.7, h1: 0 },
      ],
      start: { x: 0, z: 11 },
      goal: { x: 0, y: 1.4, z: -10 },
      points: [{ x: 0, z: 7 }, { x: 0, z: 2 }, { x: 0, z: -3 }],   // las tres crestas
    },
    { // 18 — LA DONA: pista circular ELEVADA (curva + piso a la vez): dona con faldas-rampa; cruzar por el
      // centro te hunde (el vuelo sigue el terreno) → conviene rodear por arriba. Sin muros: todo visible.
      name: 'La dona', ceiling: 6, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],
      terrain: [{ type: 'ringplat', cx: 0, cz: 0, rIn: 2.6, rOut: 5.0, h: 2.0, skirt: 0.6 }],
      start: { x: 0, z: 5.7 },
      goal: { x: 3.74, y: 3.4, z: -0.66 },              // φ350: casi la vuelta entera
      points: [{ x: 2.18, z: 3.11 }, { x: -3.8, z: 0 }, { x: 0, z: -3.8 }],   // cebo φ55 → oeste → norte
      obstacles: [{ type: 'teddy', x: -5.3, z: 5.3 }],
    },
    { // 19 — EL CARACOL: escalera de CARACOL (curva + subir a la vez): rampa espiral alrededor de una
      // columna central, 260° subiendo 0→3.2, aterrizaje arriba. Lo nuevo del dominio: curva inclinada.
      name: 'El caracol', ceiling: 6.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],
      terrain: [
        { type: 'spiral', cx: 0, cz: 0, rIn: 1.6, rOut: 3.8, a0: 90 * Math.PI / 180, a1: 350 * Math.PI / 180, h0: 0, h1: 3.2 },
        { type: 'plateau', minx: 1.6, maxx: 3.9, minz: -1.8, maxz: -0.2, h: 3.2 },   // rellano de llegada
      ],
      column: { x: 0, z: 0, r: 1.55, h: 3.6 },          // columna central (colisión cyl exacta)
      start: { x: 0, z: 5.2 },
      goal: { x: -4.5, y: 1.4, z: -4.5 },               // ABAJO en el piso: coronas el caracol y te LANZAS desde arriba (Jorge)
      points: [{ x: -2.61, z: 0.7 }, { x: -0.7, z: -2.61 }, { x: 2.34, z: -1.35 }],  // marcan la espiral (φ165·255·330; el último arriba)
      obstacles: [{ type: 'teddy', x: -4.8, z: 4.8 }],
    },
    { // 20 — LA GRAN VUELTA (final): todo junto — chute con ventilador, vuelta a la pista (barrotes),
      // salida por el hueco este, escalera larga junto al muro este a una meseta con péndulo, meta al fondo.
      name: 'La gran vuelta', ceiling: 7, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      ring: {
        cx: 0, cz: 0, rIn: 3.0, rOut: 5.2, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180], [346 * Math.PI / 180, 360 * Math.PI / 180], [0, 14 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 4.7, z1: 6.4 },
        posts: [{ x: 2.40, z: 2.40 }, { x: 2.90, z: 2.90 }, { x: 3.39, z: 3.39 }],   // φ45°
      },
      terrain: [
        { type: 'rampz', minx: 5.5, maxx: 7, z0: 1, z1: -2, h0: 0, h1: 2.2 },
        { type: 'plateau', minx: 5.5, maxx: 7, minz: -7, maxz: -2, h: 2.2 },
      ],
      start: { x: 0, z: 5.9 },
      goal: { x: 5.9, y: 3.2, z: -6.3 },
      points: [{ x: 2.35, z: 3.36 }, { x: -4.1, z: 0 }, { x: 0, z: -4.1 }, { x: 6.2, z: -0.5 }],
      movers: [
        { type: 'fan', x: 0, z: 4.5, y: 1.9, r: 0.8, axis: 'z', speed: 1.0 },
        { type: 'pendulum', x: 6.2, z: -4, y: 1.5, len: 0.9, axis: 'x', swing: 0.6, speed: 1.4, baseY: 2.2 },
      ],
    },
    { // 21 — LAS DOS LOMAS: dos campanas de distinta altura; subes una, bajas al valle, subes la otra.
      name: 'Las dos lomas', ceiling: 5, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 10 }],
      terrain: [
        { type: 'ringplat', cx: -3.4, cz: 0, rIn: 0.9, rOut: 2.3, h: 1.7, skirt: 0.5 },
        { type: 'ringplat', cx: 3.4, cz: 0, rIn: 0.9, rOut: 2.3, h: 2.3, skirt: 0.5 },
      ],
      start: { x: -6, z: 3.8 },
      goal: { x: 3.4, y: 3.6, z: 1.6 },
      points: [{ x: -3.4, z: 1.6 }, { x: 0, z: -2 }, { x: 3.4, z: -1.6 }],
    },
    { // 22 — LA MONTAÑA RUSA: CUATRO olas cada vez MÁS ALTAS (1.2→3.0) en corredor ancho, con lámpara-slalom
      // en cada valle: esquivas en pleno sube-y-baja. Hermana mayor de "La ola" (antes eran casi clones).
      name: 'La montaña rusa', ceiling: 6.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 10, d: 30 }],
      terrain: [
        { type: 'rampz', minx: -5, maxx: 5, z0: 11, z1: 9, h0: 0, h1: 1.2 }, { type: 'rampz', minx: -5, maxx: 5, z0: 9, z1: 7, h0: 1.2, h1: 0 },
        { type: 'rampz', minx: -5, maxx: 5, z0: 6, z1: 4, h0: 0, h1: 1.8 }, { type: 'rampz', minx: -5, maxx: 5, z0: 4, z1: 2, h0: 1.8, h1: 0 },
        { type: 'rampz', minx: -5, maxx: 5, z0: 1, z1: -1, h0: 0, h1: 2.4 }, { type: 'rampz', minx: -5, maxx: 5, z0: -1, z1: -3, h0: 2.4, h1: 0 },
        { type: 'rampz', minx: -5, maxx: 5, z0: -4, z1: -6, h0: 0, h1: 3.0 }, { type: 'rampz', minx: -5, maxx: 5, z0: -6, z1: -8, h0: 3.0, h1: 0 },
      ],
      start: { x: 0, z: 13 },
      goal: { x: 0, y: 1.4, z: -12.5 },
      points: [{ x: 0, z: 9 }, { x: 0, z: 4 }, { x: 0, z: -1 }, { x: 0, z: -6 }],   // las cuatro crestas
      obstacles: [{ type: 'lamp', x: -2, z: 7.7 }, { type: 'lamp', x: 2, z: 1.5 }, { type: 'lamp', x: -2, z: -3.5 }],
    },
    { // 23 — LOS DOS PUENTES: dos puentes a distinta altura (1.6 y 2.6), péndulo en el bajo.
      name: 'Los dos puentes', ceiling: 5, flightHeight: 1.3,
      rects: [{ x: -5.5, z: 0, w: 3, d: 12 }, { x: 0, z: -3, w: 8, d: 3 }, { x: 0, z: 3, w: 8, d: 3 }, { x: 5.5, z: 0, w: 3, d: 12 }],
      terrain: [
        { type: 'rampx', minz: -4.5, maxz: -1.5, x0: -4, x1: -2, h0: 0, h1: 1.6 },
        { type: 'plateau', minx: -2, maxx: 2, minz: -4.5, maxz: -1.5, h: 1.6 },
        { type: 'rampx', minz: -4.5, maxz: -1.5, x0: 2, x1: 4, h0: 1.6, h1: 0 },
        { type: 'rampx', minz: 1.5, maxz: 4.5, x0: -4, x1: -2, h0: 0, h1: 2.6 },
        { type: 'plateau', minx: -2, maxx: 2, minz: 1.5, maxz: 4.5, h: 2.6 },
        { type: 'rampx', minz: 1.5, maxz: 4.5, x0: 2, x1: 4, h0: 2.6, h1: 0 },
      ],
      start: { x: -5.5, z: 5 },
      goal: { x: 5.5, y: 1.3, z: -5 },
      points: [{ x: -5.5, z: -5 }, { x: 0, z: -3 }, { x: 0, z: 3 }],
      movers: [{ type: 'pendulum', x: -1.5, z: -3, y: 1.5, len: 0.9, axis: 'z', swing: 0.55, speed: 1.4, baseY: 1.6 }],
    },
    { // 24 — EL CONO CARACOL (rediseñado, era ≈ N15 más fácil): embudo que sube 5.2 m — cada vuelta
      // MÁS CERRADA (cono) y MÁS ALTA; la cima es una meseta chiquita con la meta.
      name: 'El cono caracol', ceiling: 7.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],
      terrain: [{ type: 'funnel', cx: 0, cz: 0, rMin: 0.9, rMax: 4.6, h: 5.2 }],
      start: { x: 0, z: 5.6 },
      goal: { x: 0.3, y: 6.2, z: 0.3 },                 // la CIMA del cono
      points: [{ x: 0, z: 4.2 }, { x: -2.26, z: -2.26 }, { x: 2.2, z: 0 }],   // espiral: bajo → medio → alto
    },
    { // 25 — LA TORRE: pisos 0→4 EN UNA MISMA DIRECCIÓN (pedido Jorge): 4 escaleras seguidas hacia el
      // norte, cada una sube un piso entero (1.9). La meta arriba del todo, escondida a la izquierda.
      name: 'La torre', ceiling: 10, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 6, d: 26 }],
      terrain: [
        { type: 'rampz', minx: -3, maxx: 3, z0: 9, z1: 7, h0: 0, h1: 1.9 },
        { type: 'plateau', minx: -3, maxx: 3, minz: 5, maxz: 7, h: 1.9 },
        { type: 'rampz', minx: -3, maxx: 3, z0: 5, z1: 3, h0: 1.9, h1: 3.8 },
        { type: 'plateau', minx: -3, maxx: 3, minz: 1, maxz: 3, h: 3.8 },
        { type: 'rampz', minx: -3, maxx: 3, z0: 1, z1: -1, h0: 3.8, h1: 5.7 },
        { type: 'plateau', minx: -3, maxx: 3, minz: -3, maxz: -1, h: 5.7 },
        { type: 'rampz', minx: -3, maxx: 3, z0: -3, z1: -5, h0: 5.7, h1: 7.6 },
        { type: 'plateau', minx: -3, maxx: 3, minz: -13, maxz: -5, h: 7.6 },
      ],
      start: { x: 0, z: 11.5 },
      goal: { x: -1.8, y: 8.7, z: -11 },
      points: [{ x: 1.6, z: 6 }, { x: -1.6, z: 2 }, { x: 1.6, z: -2 }, { x: 0, z: -7.5 }],  // zigzag por los rellanos
      traps: [{ x: 0, z: 10, r: 0.9, type: 'balloon' }],
    },
    { // 26 — EL TÚNEL DE VIENTO (rehecho): sopladores laterales EMPUJAN el dron hacia las lámparas;
      // corriges el rumbo contra el viento. Elemento nuevo: viento que desplaza, no rompe.
      name: 'El túnel de viento', ceiling: 4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 8, d: 24 }],
      start: { x: 0, z: 10.5 },
      goal: { x: 0, y: 1.4, z: -10 },
      points: [{ x: 0, z: 6 }, { x: 0, z: 0 }, { x: 0, z: -6 }],
      obstacles: [{ type: 'lamp', x: 2.2, z: 4 }, { type: 'lamp', x: -2.2, z: -2 }],
      movers: [
        { type: 'blower', x: -3.6, z: 4, y: 0.6, zone: { minx: -3.4, maxx: 3.4, minz: 2, maxz: 6 }, f: [1.7, 0, 0] },
        { type: 'blower', x: 3.6, z: -2, y: 0.6, zone: { minx: -3.4, maxx: 3.4, minz: -4, maxz: 0 }, f: [-1.7, 0, 0] },
      ],
    },
    { // 27 — LA BATERÍA (rehecho): dos cañones al fondo disparan parábolas de 45° hacia ti, desfasados;
      // avanzas leyendo el ritmo de las balas. Elemento nuevo: cañón.
      name: 'La batería', ceiling: 4.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 12, d: 16 }],
      start: { x: 0, z: 7 },
      goal: { x: 0, y: 1.4, z: -6.5 },
      points: [{ x: -2, z: 3 }, { x: 2, z: 0 }, { x: 0, z: -3 }],
      movers: [
        { type: 'cannon', x: -2.5, z: -6, aim: Math.PI / 2, v0: 6.6, period: 3, phase: 0 },
        { type: 'cannon', x: 2.5, z: -6, aim: Math.PI / 2, v0: 6.6, period: 3, phase: 1.5 },
      ],
    },
    { // 28 — EL VOLCÁN: dona grande con PICO central más alto — valle anular entre las dos crestas.
      name: 'El volcán', ceiling: 6.5, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      terrain: [
        { type: 'ringplat', cx: 0, cz: 0, rIn: 2.8, rOut: 4.6, h: 2.0, skirt: 0.6 },
        { type: 'ringplat', cx: 0, cz: 0, rIn: 0.2, rOut: 1.4, h: 2.8, skirt: 0.5 },
      ],
      start: { x: 0, z: 6 },
      goal: { x: 3.2, y: 3.4, z: -1.85 },
      points: [{ x: 0, z: 3.7 }, { x: 0.8, z: 0 }, { x: -3.2, z: -1.85 }],   // cresta → PICO → cresta opuesta
    },
    { // 29 — EL VALLE: dos mesetas laterales con rampas de ancho completo y un valle con ventilador.
      name: 'El valle', ceiling: 6, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 12 }],
      terrain: [
        { type: 'plateau', minx: -7, maxx: -3, minz: -6, maxz: 6, h: 2.2 },
        { type: 'rampx', minz: -6, maxz: 6, x0: -3, x1: -1.4, h0: 2.2, h1: 0 },
        { type: 'plateau', minx: 3, maxx: 7, minz: -6, maxz: 6, h: 2.2 },
        { type: 'rampx', minz: -6, maxz: 6, x0: 3, x1: 1.4, h0: 2.2, h1: 0 },
      ],
      start: { x: 0, z: 4.5 },
      goal: { x: -5, y: 3.2, z: -4 },
      points: [{ x: 5, z: 4 }, { x: 0, z: -4.5 }, { x: -5, z: 4 }],   // derecha (cebo) → valle → izquierda
      movers: [{ type: 'fan', x: 0, z: 0, y: 1.9, r: 0.8, axis: 'x', speed: 1.0 }],
    },
    { // 30 — LOS GÉISERES (rehecho): chorros verticales que te LANZAN al techo si pasas encima —
      // serpentea entre ellos. Elemento nuevo: empuje vertical.
      name: 'Los géiseres', ceiling: 3.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],
      start: { x: 0, z: 5.6 },
      goal: { x: 0, y: 1.4, z: -5.5 },
      points: [{ x: 0, z: 2.5 }, { x: -2.5, z: -1 }, { x: 1.2, z: -4 }],
      movers: [
        { type: 'geyser', x: -2.5, z: 2.5, zone: { minx: -3.2, maxx: -1.8, minz: 1.8, maxz: 3.2 }, f: [0, 3.6, 0] },
        { type: 'geyser', x: 2.5, z: 2.5, zone: { minx: 1.8, maxx: 3.2, minz: 1.8, maxz: 3.2 }, f: [0, 3.6, 0] },
        { type: 'geyser', x: 0, z: -1, zone: { minx: -0.7, maxx: 0.7, minz: -1.7, maxz: -0.3 }, f: [0, 3.6, 0] },
        { type: 'geyser', x: 2.5, z: -4.5, zone: { minx: 1.8, maxx: 3.2, minz: -5.2, maxz: -3.8 }, f: [0, 3.6, 0] },
      ],
    },
    { // 31 — LA FORTALEZA (rehecho): la pista con un CAÑÓN ROTATORIO en la isla central — las balas
      // caen en el corredor mientras das la vuelta. Barrotes cierran el atajo.
      name: 'La fortaleza', ceiling: 7, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      ring: {
        cx: 0, cz: 0, rIn: 2.6, rOut: 5.0, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 4.6, z1: 6.3 },
        posts: [{ x: 2.12, z: 2.12 }, { x: 2.62, z: 2.62 }, { x: 3.11, z: 3.11 }],
      },
      start: { x: 0, z: 5.8 },
      goal: { x: -2.69, y: 1.5, z: 2.26 },
      points: [{ x: -3.8, z: 0 }, { x: 0, z: -3.8 }, { x: 3.8, z: 0 }],
      movers: [{ type: 'cannon', x: 0, z: 0, aim: 0, v0: 6.1, period: 3, rotate: 0.7, h0: 2.2 }],
    },
    { // 32 — EL ASCENSOR DE AIRE (puzle): la meseta NO tiene rampa (muro frontal) — la única subida
      // es dejar que el GÉISER te lance por encima del muro. El viento como herramienta, no castigo.
      name: 'El ascensor de aire', ceiling: 6.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 12, d: 14 }],
      terrain: [{ type: 'plateau', minx: -6, maxx: 6, minz: -7, maxz: -2, h: 2.6 }],
      boxWalls: [{ minx: -6, maxx: 6, minz: -2.3, maxz: -2, h: 2.6 }],
      start: { x: 0, z: 5.5 },
      goal: { x: -4, y: 3.9, z: -5.5 },
      points: [{ x: 2.5, z: 3 }, { x: 0, z: 0.5 }, { x: 3.5, z: -5 }],
      movers: [{ type: 'geyser', x: 0, z: -0.9, zone: { minx: -0.9, maxx: 0.9, minz: -1.9, maxz: 0.1 }, f: [0, 4.2, 0] }],
    },
    { // 33 — VIENTO CRUZADO: las olas de skate + sopladores alternos en las crestas.
      name: 'Viento cruzado', ceiling: 5.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 8, d: 24 }],
      terrain: [
        { type: 'rampz', minx: -4, maxx: 4, z0: 9, z1: 7, h0: 0, h1: 1.6 }, { type: 'rampz', minx: -4, maxx: 4, z0: 7, z1: 5, h0: 1.6, h1: 0 },
        { type: 'rampz', minx: -4, maxx: 4, z0: 2, z1: 0, h0: 0, h1: 2.2 }, { type: 'rampz', minx: -4, maxx: 4, z0: 0, z1: -2, h0: 2.2, h1: 0 },
      ],
      start: { x: 0, z: 10.5 },
      goal: { x: 0, y: 1.4, z: -9.5 },
      points: [{ x: 0, z: 7 }, { x: 0, z: 1 }, { x: 0, z: -6 }],
      movers: [
        { type: 'blower', x: -3.6, z: 7, y: 1.6, zone: { minx: -3.4, maxx: 3.4, minz: 5.5, maxz: 8.5 }, f: [1.8, 0, 0] },
        { type: 'blower', x: 3.6, z: 1, y: 2.2, zone: { minx: -3.4, maxx: 3.4, minz: -0.5, maxz: 2.5 }, f: [-1.8, 0, 0] },
      ],
    },
    { // 34 — EL ORGANILLO: fila de géiseres que PULSAN por fases — cruzas al ritmo (activo 50% del ciclo).
      name: 'El organillo', ceiling: 3.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 7, d: 20 }],
      start: { x: 0, z: 8.5 },
      goal: { x: 0, y: 1.4, z: -8.5 },
      points: [{ x: 0, z: 4 }, { x: 0, z: 0 }, { x: 0, z: -4 }],
      movers: [
        { type: 'geyser', x: 0, z: 6, zone: { minx: -3.5, maxx: 3.5, minz: 5.3, maxz: 6.7 }, f: [0, 3.8, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: 0, z: 2, zone: { minx: -3.5, maxx: 3.5, minz: 1.3, maxz: 2.7 }, f: [0, 3.8, 0], period: 3, duty: 0.5, phase: 1 },
        { type: 'geyser', x: 0, z: -2, zone: { minx: -3.5, maxx: 3.5, minz: -2.7, maxz: -1.3 }, f: [0, 3.8, 0], period: 3, duty: 0.5, phase: 2 },
        { type: 'geyser', x: 0, z: -6, zone: { minx: -3.5, maxx: 3.5, minz: -6.7, maxz: -5.3 }, f: [0, 3.8, 0], period: 3, duty: 0.5, phase: 0.5 },
      ],
    },
    { // 35 — CAÑONES CRUZADOS: dos cañones en esquinas opuestas cruzan fuego sobre el volcán chico central.
      name: 'Cañones cruzados', ceiling: 5, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      terrain: [{ type: 'ringplat', cx: 0, cz: 0, rIn: 0.6, rOut: 1.8, h: 1.6, skirt: 0.5 }],
      start: { x: 0, z: 6 },
      goal: { x: 0, y: 1.4, z: -6 },
      points: [{ x: -3.5, z: 2 }, { x: 1.2, z: 0 }, { x: 3.5, z: -2 }],
      movers: [
        { type: 'cannon', x: -5.5, z: 5.5, aim: -45 * Math.PI / 180, v0: 7.2, period: 3, phase: 0 },
        { type: 'cannon', x: 5.5, z: -5.5, aim: 135 * Math.PI / 180, v0: 7.2, period: 3, phase: 1.5 },
      ],
    },
    { // 36 — EL DESFILADERO: cañón ANGOSTO entre dos mesetas de DISTINTA altura, viento a lo largo del
      // cañón y péndulo a mitad de camino. (Reemplaza al Vendaval, que era clon del Valle.)
      name: 'El desfiladero', ceiling: 6.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      terrain: [
        { type: 'plateau', minx: -7, maxx: -1.3, minz: -7, maxz: 7, h: 1.8 },
        { type: 'rampx', minz: -7, maxz: 7, x0: -1.3, x1: -0.6, h0: 1.8, h1: 0 },
        { type: 'plateau', minx: 1.3, maxx: 7, minz: -7, maxz: 7, h: 2.8 },
        { type: 'rampx', minz: -7, maxz: 7, x0: 1.3, x1: 0.6, h0: 2.8, h1: 0 },
      ],
      start: { x: 0, z: 5.2 },
      goal: { x: 4.5, y: 4.2, z: -4.5 },
      points: [{ x: 0, z: 1.5 }, { x: -4.5, z: -2 }, { x: 0, z: -4.5 }],   // cañón → meseta baja → cañón otra vez
      movers: [
        { type: 'blower', x: 0, z: 6.8, y: 0.6, zone: { minx: -0.9, maxx: 0.9, minz: -7, maxz: 6 }, f: [0, 0, -2.0] },
        { type: 'pendulum', x: 0, z: -1.5, y: 2.6, len: 1.15, axis: 'x', swing: 0.6, speed: 1.5 },
      ],
    },
    { // 37 — LA CONTRACURVA VENTOSA: la contracurva… con un soplador cruzado tapando el hueco de salida
      // OESTE — empuja de costado justo al atravesar. (Reemplaza a la Barrera, clon de la curva 13.)
      name: 'La contracurva ventosa', ceiling: 3.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0.5, w: 13, d: 13 }],
      ring: {
        cx: 0, cz: -0.5, rIn: 2.6, rOut: 4.6, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180], [166 * Math.PI / 180, 194 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 3.9, z1: 5.9 },
        posts: [{ x: -2.12, z: 1.62 }, { x: -2.55, z: 2.05 }, { x: -2.97, z: 2.47 }],
      },
      start: { x: 0, z: 5.2 },
      goal: { x: -5.6, y: 1.5, z: -0.5 },
      points: [{ x: 3.12, z: 1.3 }, { x: 3.12, z: -2.3 }, { x: -1.8, z: -3.62 }],
      movers: [{ type: 'blower', x: -6.3, z: -2.4, y: 0.6, zone: { minx: -6.4, maxx: -4.4, minz: -1.5, maxz: 0.5 }, f: [0, 0, 2.2] }],
    },
    { // 38 — LA ESCALERA VENTOSA: dos pisos con sopladores cruzados en cada rellano.
      name: 'La escalera ventosa', ceiling: 6.6, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 7, d: 22 }],
      terrain: [
        { type: 'rampz', minx: -3.5, maxx: 3.5, z0: 7, z1: 5, h0: 0, h1: 1.8 },
        { type: 'plateau', minx: -3.5, maxx: 3.5, minz: 1, maxz: 5, h: 1.8 },
        { type: 'rampz', minx: -3.5, maxx: 3.5, z0: 1, z1: -1, h0: 1.8, h1: 3.6 },
        { type: 'plateau', minx: -3.5, maxx: 3.5, minz: -11, maxz: -1, h: 3.6 },
      ],
      start: { x: 0, z: 9.5 },
      goal: { x: -2, y: 4.8, z: -9 },
      points: [{ x: 2, z: 3 }, { x: -2, z: -3 }, { x: 2, z: -7 }],
      movers: [
        { type: 'blower', x: -3.2, z: 3, y: 2.4, zone: { minx: -3, maxx: 3, minz: 1.8, maxz: 4.2 }, f: [1.8, 0, 0] },
        { type: 'blower', x: 3.2, z: -5, y: 4.2, zone: { minx: -3, maxx: 3, minz: -6.2, maxz: -3.8 }, f: [-1.8, 0, 0] },
      ],
    },
    { // 39 — EL FRANCOTIRADOR: el caracol clásico, con un cañón lejano que dispara HACIA la espiral.
      name: 'El francotirador', ceiling: 6.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 13 }],
      terrain: [
        { type: 'spiral', cx: 0, cz: 0, rIn: 1.6, rOut: 3.8, a0: 90 * Math.PI / 180, a1: 350 * Math.PI / 180, h0: 0, h1: 3.2 },
        { type: 'plateau', minx: 1.6, maxx: 3.9, minz: -1.8, maxz: -0.2, h: 3.2 },
      ],
      column: { x: 0, z: 0, r: 1.55, h: 3.6 },
      start: { x: 0, z: 5.2 },
      goal: { x: 2.6, y: 4.5, z: -0.9 },
      points: [{ x: -2.61, z: 0.7 }, { x: -0.7, z: -2.61 }, { x: 1.35, z: -2.34 }],
      movers: [{ type: 'cannon', x: -5.6, z: -5.6, aim: 45 * Math.PI / 180, v0: 7.4, period: 3, h0: 1.2 }],
    },
    { // 40 — LA TORMENTA: pista ANCHA (corredor 2.4) + cañón rotatorio + soplador + géiser; casi vuelta y media.
      name: 'La tormenta', ceiling: 7, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      ring: {
        cx: 0, cz: 0, rIn: 3.2, rOut: 5.6, h: 1.8,
        gaps: [[78 * Math.PI / 180, 102 * Math.PI / 180]],
        chute: { x: 1.18, t: 0.2, z0: 5.2, z1: 6.6 },
        posts: [{ x: 2.40, z: 2.40 }, { x: 2.97, z: 2.97 }, { x: 3.54, z: 3.54 }],
      },
      start: { x: 0, z: 6.1 },
      goal: { x: -3.81, y: 1.5, z: 2.2 },
      points: [{ x: -3.11, z: -3.11 }, { x: 0, z: -4.4 }, { x: 3.11, z: -3.11 }, { x: 4.4, z: 0 }],   // casi la vuelta y media
      movers: [
        { type: 'cannon', x: 0, z: 0, aim: 0, v0: 6.1, period: 3, rotate: -0.6, h0: 2.2 },
        { type: 'blower', x: 0, z: -6.2, y: 2.0, zone: { minx: -1.5, maxx: 1.5, minz: -5.6, maxz: -3.4 }, f: [2.0, 0, 0] },
        { type: 'geyser', x: 2.2, z: 4.4, zone: { minx: 1.5, maxx: 2.9, minz: 3.7, maxz: 5.1 }, f: [0, 3.6, 0] },
      ],
    },
    { // 41 — EL CIRCUITO (innovador, pedido Jorge): GRAN pista circular AMPLIA (corredor 3.4) para ir
      // RÁPIDO un rato largo — una vuelta de ~40 m, sin obstáculos, 6 puntos marcando el ritmo.
      name: 'El circuito', ceiling: 3.6, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 19, d: 19 }],
      ring: { cx: 0, cz: 0, rIn: 4.6, rOut: 8.0, h: 1.8 },   // CERRADO: arrancas dentro del corredor
      start: { x: 0, z: 6.3 },
      goal: { x: 2.15, y: 1.5, z: 5.92 },
      points: [{ x: -4.45, z: 4.45 }, { x: -6.3, z: 0 }, { x: -4.45, z: -4.45 }, { x: 0, z: -6.3 }, { x: 4.45, z: -4.45 }, { x: 6.3, z: 0 }],
    },
    { // 42 — LA ESE (innovador, pedido Jorge: "curva para un lado, curva para el otro"): dos anillos
      // encadenados — rodeas el primero por la IZQUIERDA y el segundo por la DERECHA. Una S de verdad.
      name: 'La ese', ceiling: 3.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0.5, w: 15, d: 25 }],
      rings: [
        { cx: 0, cz: 6, rIn: 2.2, rOut: 4.2, h: 1.8,
          gaps: [[80 * Math.PI / 180, 100 * Math.PI / 180], [260 * Math.PI / 180, 280 * Math.PI / 180]],
          chute: { x: 1.18, t: 0.2, z0: 10.4, z1: 12.2 },
          posts: [{ x: 2.25, z: 7.3 }, { x: 2.77, z: 7.6 }, { x: 3.29, z: 7.9 }] },      // φ30: por la derecha NO
        { cx: 0, cz: -3.4, rIn: 2.2, rOut: 4.2, h: 1.8,
          gaps: [[80 * Math.PI / 180, 100 * Math.PI / 180], [260 * Math.PI / 180, 280 * Math.PI / 180]],
          posts: [{ x: -2.25, z: -2.1 }, { x: -2.77, z: -1.8 }, { x: -3.29, z: -1.5 }] },  // φ150: por la izquierda NO
      ],
      start: { x: 0, z: 11.5 },
      goal: { x: 0, y: 1.5, z: -9.5 },
      points: [{ x: -2.26, z: 8.26 }, { x: -2.26, z: 3.74 }, { x: 2.26, z: -1.14 }, { x: 2.26, z: -5.66 }],
    },
    { // 43 — LA GRAN BAJADA (innovador, pedido Jorge: "muy larga, un solo sentido, siempre bajando"):
      // 44 m de descenso escalonado desde h=6 — el planeo hace la mitad del trabajo; slalom al final.
      name: 'La gran bajada', ceiling: 8.6, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 8, d: 44 }],
      terrain: [
        { type: 'plateau', minx: -4, maxx: 4, minz: 18, maxz: 22, h: 6.0 },
        { type: 'rampz', minx: -4, maxx: 4, z0: 18, z1: 14, h0: 6.0, h1: 4.8 },
        { type: 'plateau', minx: -4, maxx: 4, minz: 12, maxz: 14, h: 4.8 },
        { type: 'rampz', minx: -4, maxx: 4, z0: 12, z1: 8, h0: 4.8, h1: 3.6 },
        { type: 'plateau', minx: -4, maxx: 4, minz: 6, maxz: 8, h: 3.6 },
        { type: 'rampz', minx: -4, maxx: 4, z0: 6, z1: 2, h0: 3.6, h1: 2.4 },
        { type: 'plateau', minx: -4, maxx: 4, minz: 0, maxz: 2, h: 2.4 },
        { type: 'rampz', minx: -4, maxx: 4, z0: 0, z1: -4, h0: 2.4, h1: 1.2 },
        { type: 'plateau', minx: -4, maxx: 4, minz: -6, maxz: -4, h: 1.2 },
        { type: 'rampz', minx: -4, maxx: 4, z0: -6, z1: -10, h0: 1.2, h1: 0 },
      ],
      start: { x: 0, z: 20 },
      goal: { x: 0, y: 1.4, z: -20 },
      points: [{ x: 0, z: 13 }, { x: 2, z: 7 }, { x: -2, z: 1 }, { x: 0, z: -5 }],
      obstacles: [{ type: 'lamp', x: 2, z: -13 }, { type: 'lamp', x: -2, z: -17 }],
    },
    { // 44 — EL DESCENSO DEL CONO (familia del cono — Jorge: que no quede de una sola vez): despegas en la
      // CIMA y bajas la espiral del embudo hacia afuera; los puntos van marcando la caída.
      name: 'El descenso del cono', ceiling: 8.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 14, d: 14 }],
      terrain: [{ type: 'funnel', cx: 0, cz: 0, rMin: 0.9, rMax: 5.2, h: 5.6 }],
      start: { x: 0, z: 0.2 },                          // arrancas ARRIBA
      goal: { x: 0, y: 1.4, z: -5.9 },                  // el piso, afuera del cono
      points: [{ x: 1.6, z: 0 }, { x: -2.8, z: 0 }, { x: 2.83, z: -2.83 }],   // radio creciente = altura decreciente
    },
    { // 45 — EL RELOJ (innovador): pista circular CERRADA con un cañón rotatorio LENTO en el centro — la
      // "manecilla" barre el corredor sin parar; corres por delante de ella toda la vuelta.
      name: 'El reloj', ceiling: 4.2, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 15, d: 15 }],
      ring: { cx: 0, cz: 0, rIn: 2.8, rOut: 5.4, h: 1.8 },
      start: { x: 0, z: 4.1 },
      goal: { x: 2.05, y: 1.5, z: 3.55 },
      points: [{ x: -4.1, z: 0 }, { x: 0, z: -4.1 }, { x: 4.1, z: 0 }],
      movers: [{ type: 'cannon', x: 0, z: 0, aim: 90 * Math.PI / 180, v0: 6.0, period: 1.6, rotate: 0.45, h0: 2.2 }],
    },
    { // 46 — EL TABLERO (innovador): 9 géiseres en tablero de ajedrez pulsando ALTERNADOS — cruzas leyendo
      // el patrón: cuando las "negras" soplan, las "blancas" descansan. El organillo, en 2D.
      name: 'El tablero', ceiling: 3.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 17 }],
      start: { x: 0, z: 6.8 },
      goal: { x: 0, y: 1.4, z: -6.8 },
      points: [{ x: -1.3, z: 1.7 }, { x: 1.3, z: -1.7 }, { x: 0, z: -5.1 }],
      movers: [
        { type: 'geyser', x: -2.6, z: 3.4, zone: { minx: -3.4, maxx: -1.8, minz: 2.6, maxz: 4.2 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: 0, z: 3.4, zone: { minx: -0.8, maxx: 0.8, minz: 2.6, maxz: 4.2 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 1.5 },
        { type: 'geyser', x: 2.6, z: 3.4, zone: { minx: 1.8, maxx: 3.4, minz: 2.6, maxz: 4.2 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: -2.6, z: 0, zone: { minx: -3.4, maxx: -1.8, minz: -0.8, maxz: 0.8 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 1.5 },
        { type: 'geyser', x: 0, z: 0, zone: { minx: -0.8, maxx: 0.8, minz: -0.8, maxz: 0.8 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: 2.6, z: 0, zone: { minx: 1.8, maxx: 3.4, minz: -0.8, maxz: 0.8 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 1.5 },
        { type: 'geyser', x: -2.6, z: -3.4, zone: { minx: -3.4, maxx: -1.8, minz: -4.2, maxz: -2.6 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: 0, z: -3.4, zone: { minx: -0.8, maxx: 0.8, minz: -4.2, maxz: -2.6 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 1.5 },
        { type: 'geyser', x: 2.6, z: -3.4, zone: { minx: 1.8, maxx: 3.4, minz: -4.2, maxz: -2.6 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
      ],
    },
    { // 47 — EL TURBO (innovador): viento A FAVOR todo el corredor — vas disparado — pero hay lámparas de
      // slalom: esquivar A ALTA VELOCIDAD. El viento como turbo, no como castigo.
      name: 'El turbo', ceiling: 4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 8, d: 30 }],
      start: { x: 0, z: 13.5 },
      goal: { x: 0, y: 1.4, z: -13.5 },
      points: [{ x: 0, z: 7 }, { x: 0, z: -1 }, { x: 0, z: -9 }],
      obstacles: [
        { type: 'lamp', x: 1.8, z: 9 }, { type: 'lamp', x: -1.8, z: 5 }, { type: 'lamp', x: 1.8, z: 1 },
        { type: 'lamp', x: -1.8, z: -3 }, { type: 'lamp', x: 1.8, z: -7 },
      ],
      movers: [{ type: 'blower', x: 2.8, z: 14.2, y: 0.6, zone: { minx: -3.4, maxx: 3.4, minz: -13, maxz: 14 }, f: [0, 0, -2.6] }],
    },
    { // 48 — LAS AGUJAS (innovador): bosque de TORRES finas del piso al techo — slalom puro en 3D, colisión
      // de cilindro exacta. Primer nivel donde el peligro es el BOSQUE, no el muro.
      name: 'Las agujas', ceiling: 3.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 13, d: 19 }],
      columns: [
        { x: -1.8, z: 7, r: 0.4, h: 3.2 }, { x: 1.6, z: 6, r: 0.4, h: 3.2 }, { x: -0.5, z: 4.6, r: 0.4, h: 3.2 },
        { x: 2.8, z: 3.4, r: 0.4, h: 3.2 }, { x: -2.6, z: 3, r: 0.4, h: 3.2 }, { x: 0.6, z: 1.8, r: 0.4, h: 3.2 },
        { x: -1.2, z: -0.2, r: 0.4, h: 3.2 }, { x: 2.2, z: -1, r: 0.4, h: 3.2 }, { x: -3, z: -2.2, r: 0.4, h: 3.2 },
        { x: 0, z: -3.4, r: 0.4, h: 3.2 }, { x: 1.8, z: -5, r: 0.4, h: 3.2 }, { x: -1.6, z: -6.2, r: 0.4, h: 3.2 },
      ],
      start: { x: 0, z: 8.6 },
      goal: { x: 0, y: 1.4, z: -8.3 },
      points: [{ x: 0.4, z: 5.6 }, { x: -1.5, z: 2.2 }, { x: 1, z: -2.2 }],
    },
    { // 49 — EL ZIGURAT (familia de subidas): sube en U — rampa OESTE al piso 1, vuelta por el rellano
      // norte (con ventilador), rampa ESTE que sube AL SUR hasta el piso 2 con la meta.
      name: 'El zigurat', ceiling: 7.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0.5, w: 10, d: 15 }],
      terrain: [
        { type: 'rampz', minx: -5, maxx: -1, z0: 6, z1: 2, h0: 0, h1: 2 },
        { type: 'plateau', minx: -5, maxx: 5, minz: -7, maxz: 2, h: 2 },
        { type: 'rampz', minx: 1, maxx: 5, z0: -2, z1: 2, h0: 2, h1: 4 },
        { type: 'plateau', minx: 1, maxx: 5, minz: 2, maxz: 7, h: 4 },
      ],
      start: { x: -3, z: 7 },
      goal: { x: 3, y: 5.4, z: 5.5 },
      points: [{ x: -3, z: 4 }, { x: -2.5, z: -4.5 }, { x: 3, z: 0 }],
      movers: [{ type: 'fan', x: 0, z: -4.5, y: 2.0, r: 0.8, axis: 'x', speed: 1.0, baseY: 2 }],
    },
    { // 50 — LA TORMENTA PERFECTA (FINAL): el gran circuito con TODO — manecilla de cañón, viento a favor
      // en el oeste, péndulo, géiseres pulsantes… y la vuelta completa obligada por barrotes.
      name: 'La tormenta perfecta', ceiling: 4.4, flightHeight: 1.4,
      rects: [{ x: 0, z: 0, w: 18, d: 18 }],
      ring: {
        cx: 0, cz: 0, rIn: 4.2, rOut: 7.6, h: 1.8,
        posts: [{ x: 1.42, z: 4.37 }, { x: 1.67, z: 5.14 }, { x: 1.92, z: 5.90 }, { x: 2.16, z: 6.66 }],   // φ72: sentido único
      },
      start: { x: 0, z: 6.0 },
      goal: { x: 2.77, y: 1.5, z: 5.21 },
      points: [{ x: -4.17, z: 4.17 }, { x: -5.54, z: -2.02 }, { x: 1.7, z: -5.65 }, { x: 4.17, z: -4.17 }, { x: 5.65, z: -1.7 }, { x: 4.17, z: 4.17 }],
      movers: [
        { type: 'cannon', x: 0, z: 0, aim: 90 * Math.PI / 180, v0: 7.0, period: 2.2, rotate: 0.5, h0: 2.2 },
        { type: 'blower', x: -6.9, z: 3.2, y: 0.6, zone: { minx: -7.6, maxx: -4.2, minz: -2.5, maxz: 2.5 }, f: [0, 0, -2.4] },
        { type: 'pendulum', x: -5.9, z: 0, y: 2.4, len: 1.1, axis: 'x', swing: 0.6, speed: 1.5 },
        { type: 'geyser', x: 0, z: -5.9, zone: { minx: -0.8, maxx: 0.8, minz: -6.7, maxz: -5.1 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 0 },
        { type: 'geyser', x: 5.9, z: 0, zone: { minx: 5.1, maxx: 6.7, minz: -0.8, maxz: 0.8 }, f: [0, 3.4, 0], period: 3, duty: 0.5, phase: 1.5 },
      ],
    },
  ];

  // ============================================================================
  // GEOMETRÍA PURA (sin THREE) — testeable en node
  // ============================================================================
  function insideRects(rects, x, z) {
    for (const r of rects) {
      if (x >= r.x - r.w / 2 && x <= r.x + r.w / 2 && z >= r.z - r.d / 2 && z <= r.z + r.d / 2) return true;
    }
    return false;
  }

  // Terreno (altura del suelo) por posición. Sin escalera → plano (0). Con escalera → rampa por Z:
  // al sur de zBot = 0; al norte de zTop = H; en medio interpola. La altitud del dron se mide sobre esto.
  // TERRENO data-driven (multi-piso, pisos 0→4, espirales): lista de features; altura = MAX de todas.
  //  plateau: {minx,maxx,minz,maxz,h} · rampz: {minx,maxx,z0,z1,h0,h1} · rampx: {minz,maxz,x0,x1,h0,h1}
  //  spiral:  {cx,cz,rIn,rOut,a0,a1,h0,h1} (altura por ángulo, a1−a0 ≤ 2π·0.85 para no solaparse)
  //  ringplat:{cx,cz,rIn,rOut,h,skirt} (dona elevada con falda-rampa radial de ancho skirt)
  function terrainAt(f, x, z) {
    if (f.type === 'plateau') return (x >= f.minx && x <= f.maxx && z >= f.minz && z <= f.maxz) ? f.h : 0;
    if (f.type === 'rampz') {
      if (x < f.minx || x > f.maxx) return 0;
      const t = (z - f.z0) / (f.z1 - f.z0);
      return (t >= 0 && t <= 1) ? f.h0 + (f.h1 - f.h0) * t : 0;
    }
    if (f.type === 'rampx') {
      if (z < f.minz || z > f.maxz) return 0;
      const t = (x - f.x0) / (f.x1 - f.x0);
      return (t >= 0 && t <= 1) ? f.h0 + (f.h1 - f.h0) * t : 0;
    }
    if (f.type === 'spiral') {
      const r = Math.hypot(x - f.cx, z - f.cz);
      if (r < f.rIn || r > f.rOut) return 0;
      let a = Math.atan2(z - f.cz, x - f.cx); if (a < 0) a += Math.PI * 2;
      while (a < f.a0) a += Math.PI * 2;               // desenrollar al rango [a0,a1]
      if (a > f.a1) return 0;
      return f.h0 + (f.h1 - f.h0) * (a - f.a0) / (f.a1 - f.a0);
    }
    if (f.type === 'funnel') {   // CONO caracol (Jorge): h sube linealmente del borde (rMax) a la cima (rMin); cima plana
      const r = Math.hypot(x - f.cx, z - f.cz);
      if (r >= f.rMax) return 0;
      if (r <= f.rMin) return f.h;
      return f.h * (f.rMax - r) / (f.rMax - f.rMin);
    }
    if (f.type === 'ringplat') {
      // PERFIL CAMPANA (rampa de skate, pedido Jorge 2026-07-11): sin meseta plana ni caras verticales —
      // la loma anular sube y baja SUAVE (coseno), máx en rMid. El dron nunca atraviesa el sólido: todo es rampa.
      const r = Math.hypot(x - f.cx, z - f.cz), rMid = (f.rIn + f.rOut) / 2;
      const W = (f.rOut - f.rIn) / 2 + (f.skirt || 0.5);
      const d = Math.abs(r - rMid);
      if (d >= W) return 0;
      return f.h * 0.5 * (1 + Math.cos(Math.PI * d / W));
    }
    return 0;
  }
  function terrainFn(L) {
    const s = L.stairs, T = L.terrain;
    if (T) return (x, z) => { let h = 0; for (const f of T) { const v = terrainAt(f, x, z); if (v > h) h = v; } return h; };
    if (!s) return () => 0;
    return (x, z) => {           // legacy (Mundo 11): rampa por Z + todo el norte alto
      if (z >= s.zBot) return 0;
      if (z <= s.zTop) return s.H;
      return s.H * (s.zBot - z) / (s.zBot - s.zTop);
    };
  }

  function rectsBounds(rects) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    rects.forEach(r => {
      minX = Math.min(minX, r.x - r.w / 2); maxX = Math.max(maxX, r.x + r.w / 2);
      minZ = Math.min(minZ, r.z - r.d / 2); maxZ = Math.max(maxZ, r.z + r.d / 2);
    });
    return { minX, maxX, minZ, maxZ };
  }

  // Grilla de ocupación de piso. Celda (i,j) tiene piso si su centro cae dentro de algún rect.
  function floorGrid(rects) {
    const b = rectsBounds(rects);
    const i0 = Math.floor((b.minX - CELL) / CELL), i1 = Math.ceil((b.maxX + CELL) / CELL);
    const j0 = Math.floor((b.minZ - CELL) / CELL), j1 = Math.ceil((b.maxZ + CELL) / CELL);
    const cx = i => i * CELL + CELL / 2, cz = j => j * CELL + CELL / 2;
    const at = (i, j) => insideRects(rects, cx(i), cz(j));
    return { i0, i1, j0, j1, cx, cz, at };
  }

  // Muros = borde entre celda con piso y celda sin piso, fusionando tramos colineales en cajas.
  // Devuelve [{x,z,w,d}] (numérico puro).
  function wallSegments(rects) {
    const G = floorGrid(rects);
    const walls = [];
    // --- verticales (línea X constante; normal ±X). Borde entre (i-1,j) y (i,j) en x=i*CELL ---
    for (let i = G.i0; i <= G.i1 + 1; i++) {
      let runStart = null;
      for (let j = G.j0; j <= G.j1 + 1; j++) {
        const boundary = G.at(i - 1, j) !== G.at(i, j);  // XOR: uno tiene piso, el otro no
        if (boundary && runStart === null) runStart = j;
        if ((!boundary || j > G.j1) && runStart !== null) {
          const jEnd = j - 1;
          const z0 = runStart * CELL, z1 = (jEnd + 1) * CELL;
          walls.push({ x: i * CELL, z: (z0 + z1) / 2, w: TH, d: (z1 - z0) + TH });
          runStart = null;
        }
      }
    }
    // --- horizontales (línea Z constante; normal ±Z). Borde entre (i,j-1) y (i,j) en z=j*CELL ---
    for (let j = G.j0; j <= G.j1 + 1; j++) {
      let runStart = null;
      for (let i = G.i0; i <= G.i1 + 1; i++) {
        const boundary = G.at(i, j - 1) !== G.at(i, j);
        if (boundary && runStart === null) runStart = i;
        if ((!boundary || i > G.i1) && runStart !== null) {
          const iEnd = i - 1;
          const x0 = runStart * CELL, x1 = (iEnd + 1) * CELL;
          walls.push({ x: (x0 + x1) / 2, z: j * CELL, w: (x1 - x0) + TH, d: TH });
          runStart = null;
        }
      }
    }
    return walls;
  }

  // Colisión ESFERA (dron, radio R) vs lista de colliders con forma real.
  // shape: 'sphere' | 'cyl' (eje Y) | (por defecto) 'box'/AABB. Devuelve el kind del primero que toca, o null.
  function hitColliders(colliders, px, py, pz, R) {
    for (const b of colliders) {
      if (b.shape === 'sphere') {
        const dx = px - b.x, dy = py - b.y, dz = pz - b.z;
        if (dx * dx + dy * dy + dz * dz < (R + b.r) * (R + b.r)) return b.kind;
      } else if (b.shape === 'cyl') {              // cilindro vertical (poste/pantalla de lámpara)
        const cy = Math.max(b.y0, Math.min(py, b.y1)), dy = py - cy;
        const hd = Math.hypot(px - b.x, pz - b.z), hg = Math.max(0, hd - b.r);
        if (hg * hg + dy * dy < R * R) return b.kind;
      } else if (b.shape === 'ring') {             // muro CURVO (anillo): pared cilíndrica en r∈[b.r, b.r+b.t], y∈[0,b.y1], con aperturas [[a0,a1],...]
        const dx = px - b.cx, dz = pz - b.cz, hd = Math.hypot(dx, dz);
        let a = Math.atan2(dz, dx); if (a < 0) a += Math.PI * 2;
        const gaps = b.gaps || (b.gapA0 != null ? [[b.gapA0, b.gapA1]] : []);
        let inGap = false;
        for (const g of gaps) if (a > g[0] && a < g[1]) { inGap = true; break; }
        if (inGap) continue;
        const rc = Math.max(b.r, Math.min(hd, b.r + (b.t || 0.25)));           // punto más cercano del muro (radial)
        const yc = Math.max(0, Math.min(py, b.y1 != null ? b.y1 : 99));        // ... y en alto
        const dr = hd - rc, dy = py - yc;
        if (dr * dr + dy * dy < R * R) return b.kind;
      } else if (b.shape === 'seg') {              // cápsula (segmento A→B, radio b.r): aspa fina de ventilador
        const abx = b.bx - b.ax, aby = b.by - b.ay, abz = b.bz - b.az;
        const apx = px - b.ax, apy = py - b.ay, apz = pz - b.az;
        const L2 = abx * abx + aby * aby + abz * abz || 1;
        let t = (apx * abx + apy * aby + apz * abz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (b.ax + abx * t), dy = py - (b.ay + aby * t), dz = pz - (b.az + abz * t);
        if (dx * dx + dy * dy + dz * dz < (R + b.r) * (R + b.r)) return b.kind;
      } else {                                     // AABB (muros, techo, cajas)
        const cx = Math.max(b.minx, Math.min(px, b.maxx));
        const cy = Math.max(b.miny, Math.min(py, b.maxy));
        const cz = Math.max(b.minz, Math.min(pz, b.maxz));
        const dx = px - cx, dy = py - cy, dz = pz - cz;
        if (dx * dx + dy * dy + dz * dz < R * R) return b.kind;
      }
    }
    return null;
  }

  // Colliders PRECISOS de un obstáculo (calzan la malla visual, no la caja envolvente).
  function obstacleColliders(o) {
    const C = [];
    if (o.type === 'blocks') {              // torre 2 cubos (0.5) → una caja 0.5×1.0×0.5
      C.push(aabb(o.x, o.z, 0.25, 0, 1.0, 0.25));
    } else if (o.type === 'teddy') {        // cuerpo (caja) + cabeza (esfera)
      C.push(aabb(o.x, o.z, 0.35, 0, 0.9, 0.30));
      C.push({ shape: 'sphere', x: o.x, y: 1.1, z: o.z, r: 0.40, kind: 'obstacle' });
    } else if (o.type === 'lamp') {         // poste FINO + pantalla (cilindros) → se pasa al lado
      C.push({ shape: 'cyl', x: o.x, z: o.z, y0: 0, y1: 1.6, r: 0.07, kind: 'obstacle' });
      C.push({ shape: 'cyl', x: o.x, z: o.z, y0: 1.45, y1: 1.95, r: 0.42, kind: 'obstacle' });
    } else if (o.type === 'sofa') {         // base + respaldo (2 cajas)
      C.push(aabb(o.x, o.z, 1.0, 0, 0.5, 0.45));
      C.push(aabb(o.x, o.z - 0.32, 1.0, 0.3, 0.9, 0.13));
    }
    return C;
  }
  function aabb(x, z, hw, y0, y1, hd) { return { minx: x - hw, maxx: x + hw, miny: y0, maxy: y1, minz: z - hd, maxz: z + hd, kind: 'obstacle' }; }

  // Validación PURA de un nivel (para el test node): start/goal/puntos sobre piso + todos conectados.
  function validateLevel(L) {
    const reasons = [];
    const onFloor = (p, n) => { if (!insideRects(L.rects, p.x, p.z)) reasons.push(n + ' fuera de piso (' + p.x + ',' + p.z + ')'); };
    onFloor(L.start, 'start'); onFloor(L.goal, 'goal');
    (L.points || []).forEach((p, k) => onFloor(p, 'punto' + k));
    // BFS de conectividad sobre celdas con piso desde start
    const G = floorGrid(L.rects);
    const key = (i, j) => i + ',' + j;
    const cellOf = p => ({ i: Math.floor(p.x / CELL), j: Math.floor(p.z / CELL) });
    const seen = new Set(); const q = [];
    const s = cellOf(L.start);
    if (G.at(s.i, s.j)) { seen.add(key(s.i, s.j)); q.push(s); }
    while (q.length) {
      const c = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const ni = c.i + d[0], nj = c.j + d[1];
        if (G.at(ni, nj) && !seen.has(key(ni, nj))) { seen.add(key(ni, nj)); q.push({ i: ni, j: nj }); }
      });
    }
    const reach = p => { const c = cellOf(p); return seen.has(key(c.i, c.j)); };
    if (!reach(L.goal)) reasons.push('goal NO conectado al start');
    (L.points || []).forEach((p, k) => { if (!reach(p)) reasons.push('punto' + k + ' NO conectado al start'); });
    return { ok: reasons.length === 0, reasons };
  }

  // ============================================================================
  // CONSTRUCCIÓN THREE (navegador)
  // ============================================================================
  const ROOM_TINT = 0xfbf1e0;   // techo blanco cálido (paleta suave cohesiva)

  function box(THREE, w, h, d, color, opts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0.02 }, opts || {})));
    return m;
  }

  function buildObstacle(THREE, o) {
    const g = new THREE.Group();
    if (o.type === 'blocks') {
      const cols = [0xe07a6f, 0x74b6d4, 0xe8c66a, 0x86bf8e];
      for (let i = 0; i < 2; i++) { const b = box(THREE, 0.5, 0.5, 0.5, cols[i]); b.position.y = 0.25 + i * 0.5; b.rotation.y = i * 0.3; g.add(b); }
    } else if (o.type === 'teddy') {
      const body = box(THREE, 0.7, 0.9, 0.6, 0xc98a4b); body.position.y = 0.45; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd89a5b, roughness: 0.9 })); head.position.y = 1.1; g.add(head);
    } else if (o.type === 'lamp') {
      const pole = box(THREE, 0.1, 1.6, 0.1, 0x888888); pole.position.y = 0.8; g.add(pole);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffcf66, emissiveIntensity: 0.5, side: THREE.DoubleSide })); shade.position.y = 1.7; g.add(shade);
    } else if (o.type === 'sofa') {
      const base = box(THREE, 2.0, 0.5, 0.9, 0x7e8fb5); base.position.y = 0.28; g.add(base);
      const back = box(THREE, 2.0, 0.6, 0.25, 0x6f80a6); back.position.set(0, 0.6, -0.32); g.add(back);
    }
    g.position.set(o.x, 0, o.z);
    return g;
  }

  // OBSTÁCULOS CON MOVIMIENTO (mover): ventilador que gira, péndulo que oscila, puerta que abre/cierra.
  // Devuelve { group, colliders (VIVOS, se mutan en step), step(t) }. La colisión usa la posición actual.
  function buildMover(THREE, m) {
    const g = new THREE.Group();
    const cols = [];
    const x = m.x, z = m.z, by = m.baseY || 0;   // baseY = altura del suelo local (piso alto de una casa 2 pisos)
    let step = () => {};
    if (m.type === 'fan') {
      // ventilador: aspas que giran LENTO en el plano perpendicular al pasillo (el dron cruza entre aspas)
      const axis = m.axis || 'z', r = m.r || 0.85, y = (m.y != null ? m.y : 1.3) + by, speed = m.speed || 1.1, nb = m.blades || 3;
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.4, roughness: 0.5 }));
      hub.position.set(x, y, z); g.add(hub);
      const bg = new THREE.Group(); bg.position.set(x, y, z); g.add(bg);
      const BT = 0.06;                              // media-sección real del aspa (caja 0.10 de alto) → cápsula fina
      for (let i = 0; i < nb; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(r, 0.10, 0.03), new THREE.MeshStandardMaterial({ color: 0x9fb0c4, metalness: 0.3, roughness: 0.5 }));
        const a0 = (i / nb) * Math.PI * 2;
        if (axis === 'z') { bl.position.set(Math.cos(a0) * r / 2, Math.sin(a0) * r / 2, 0); bl.rotation.z = a0; }
        else { bl.geometry = new THREE.BoxGeometry(0.03, 0.10, r); bl.position.set(0, Math.sin(a0) * r / 2, Math.cos(a0) * r / 2); bl.rotation.x = -a0; }
        bg.add(bl);
        // FORMA REAL del aspa = cápsula (segmento hub→punta), radio = media-sección. NO choca con el aire alrededor.
        cols.push({ shape: 'seg', ax: x, ay: y, az: z, bx: x, by: y, bz: z, r: BT, kind: 'obstacle', _bi: i });
      }
      cols.push({ shape: 'sphere', x, y, z, r: 0.15, kind: 'obstacle' });   // buje central (contacto real con el eje)
      g.userData.snd = { x, y, z };                    // fuente del sonido de propela por proximidad
      step = (t) => {
        const ang = t * speed;
        if (axis === 'z') bg.rotation.z = ang; else bg.rotation.x = ang;
        for (const c of cols) {
          if (c._bi == null) continue;              // el buje no rota
          const phi = (c._bi / nb) * Math.PI * 2 + ang;
          c.ax = x; c.ay = y; c.az = z;             // extremo interno = buje
          if (axis === 'z') { c.bx = x + Math.cos(phi) * r; c.by = y + Math.sin(phi) * r; c.bz = z; }
          else { c.bx = x; c.by = y + Math.sin(phi) * r; c.bz = z + Math.cos(phi) * r; }
        }
      };
    } else if (m.type === 'pendulum') {
      // péndulo: bola colgada que oscila cruzando el pasillo
      const axis = m.axis || 'x', len = m.len || 1.3, y = (m.y != null ? m.y : 2.4) + by, swing = m.swing || 1.0, speed = m.speed || 1.6;
      const piv = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x444a55 }));
      piv.position.set(x, y, z); g.add(piv);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6), new THREE.MeshStandardMaterial({ color: 0x777f8c }));
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd23f3f, metalness: 0.3, roughness: 0.4 }));
      g.add(rod); g.add(bob);
      const col = { shape: 'sphere', x, y: y - len, z, r: 0.30, kind: 'obstacle' }; cols.push(col);
      step = (t) => {
        const th = swing * Math.sin(t * speed);
        let bx = x, bz = z; const yb = y - Math.cos(th) * len;
        if (axis === 'x') bx = x + Math.sin(th) * len; else bz = z + Math.sin(th) * len;
        bob.position.set(bx, yb, bz); col.x = bx; col.y = yb; col.z = bz;
        rod.position.set((x + bx) / 2, (y + yb) / 2, (z + bz) / 2);
        rod.lookAt(x, y, z); rod.rotateX(Math.PI / 2);
      };
    } else if (m.type === 'blower' || m.type === 'geyser') {
      // SOPLADOR: viento que EMPUJA al dron (no rompe) dentro de una zona; géiser = chorro VERTICAL.
      // Opcional pulso: {period,duty,phase} (activo solo parte del ciclo). El efecto lo aplica main via m.windAt.
      const zone = m.zone, F = m.f || [0, 0, 0], per = m.period || 0, duty = m.duty != null ? m.duty : 0.5, ph = m.phase || 0;
      let active = true;
      const y = (m.y != null ? m.y : 0) + by;
      if (m.type === 'geyser') {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x74b6d4, roughness: 0.6 }));
        ring.position.set(x, y + 0.05, z); g.add(ring);
        const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 2.6, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        jet.position.set(x, y + 1.4, z); g.add(jet);
        step = (t) => { active = !per || (((t + ph) % per) < duty * per); jet.visible = active; jet.scale.y = active ? 1 + 0.08 * Math.sin(t * 9) : 0.001; };
      } else {
        // VENTILADOR: todo el conjunto MIRA hacia donde sopla (dir = f normalizado).
        // Antes quedaba fijo al eje X aunque f fuera en Z → "sopla por donde no es" (bug Jorge 2026-07-11).
        const dir = new THREE.Vector3(F[0], F[1], F[2]).normalize();
        const fanG = new THREE.Group(); fanG.position.set(x, y + 0.5, z);
        fanG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);   // +Y local → dirección del viento
        g.add(fanG);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.44, 0.42, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.4, side: THREE.DoubleSide }));
        fanG.add(body);
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x39404b, metalness: 0.5 }));
        hub.position.y = 0.1; fanG.add(hub);
        const bladeG = new THREE.Group(); bladeG.position.y = 0.08; fanG.add(bladeG);
        for (let i = 0; i < 3; i++) {
          const piv = new THREE.Group(); piv.rotation.y = i / 3 * Math.PI * 2; bladeG.add(piv);
          const bl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.17), new THREE.MeshStandardMaterial({ color: 0x9fb0c4, metalness: 0.3 }));
          bl.position.x = 0.27; bl.rotation.x = 0.55;   // paso de hélice: se LEE que empuja aire hacia +Y local
          piv.add(bl);
        }
        // chorro translúcido: se VE hacia dónde sopla (mismo lenguaje visual del géiser)
        const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.42, 1.7, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        jet.position.y = 1.1; fanG.add(jet);
        cols.push({ shape: 'cyl', x, z, y0: y, y1: y + 1.0, r: 0.5, kind: 'obstacle' });   // el cuerpo sí es sólido
        step = (t) => {
          active = !per || (((t + ph) % per) < duty * per);
          bladeG.rotation.y = t * 9;                   // giro claramente visible (sin estrobo)
          jet.visible = active; jet.scale.x = jet.scale.z = 1 + 0.05 * Math.sin(t * 7);
        };
        g.userData.snd = { x, y: y + 0.5, z };         // fuente del sonido de propela por proximidad
      }
      // viento: main lo consulta cada frame (fuerza si el dron está dentro de la zona y el pulso está activo)
      g.userData.windAt = (px, py, pz) => {
        if (!active) return null;
        if (px < zone.minx || px > zone.maxx || pz < zone.minz || pz > zone.maxz) return null;
        if (zone.miny != null && (py < zone.miny || py > zone.maxy)) return null;
        return F;
      };
    } else if (m.type === 'cannon') {
      // CAÑÓN (rework Jorge 2026-07-11): la bala SALE POR LA BOCA del barril (barril alineado por
      // quaternion a la trayectoria real — antes la rotación Euler lo dejaba de lado), VARÍA elevación
      // y fuerza por disparo (hash determinístico → testeable) y al caer REBOTA en el piso (no desaparece).
      // Opcional `rotate` rad/s = apunta girando; dirección CONGELADA al momento del disparo.
      const aim0 = m.aim || 0, v0base = m.v0 || 6.1, per = m.period || 3, ph = m.phase || 0, rot = m.rotate || 0;
      const h0 = (m.h0 != null ? m.h0 : 1.0) + by, BR = 0.2, BLEN = 1.1;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x6b7480, metalness: 0.3 }));
      base.position.set(x, by + 0.35, z); g.add(base);
      const barrelG = new THREE.Group(); barrelG.position.set(x, h0 - 0.35, z); g.add(barrelG);   // pivote (culata)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, BLEN, 12), new THREE.MeshStandardMaterial({ color: 0x3d444e, metalness: 0.5 }));
      barrel.position.y = BLEN / 2 - 0.15; barrelG.add(barrel);   // eje local +Y = línea de tiro
      const ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.4 }));
      g.add(ball);
      const col = { shape: 'sphere', x, y: -99, z, r: 0.22, kind: 'obstacle' }; cols.push(col);
      cols.push({ shape: 'cyl', x, z, y0: by, y1: by + 0.8, r: 0.5, kind: 'obstacle' });   // la base es sólida
      const rand01 = n => { const s = Math.sin(n * 127.1 + x * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
      const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
      let shot = null, pt = 0, bp = null, bv = null;   // bp/bv = posición/velocidad VIVA de la bala
      step = (t) => {
        const dt = Math.min(Math.max(t - pt, 0), 0.05); pt = t;
        const n = Math.floor((t + ph) / per);
        if (n !== shot) {                              // DISPARO n: apuntar barril + bala nace en la BOCA
          shot = n;
          const aim = aim0 + rot * n * per;
          const elev = 0.55 + rand01(n) * 0.45;        // 31°..57° (varía la trayectoria)
          const v0 = v0base * (0.85 + rand01(n + 0.5) * 0.3);   // ±15% de fuerza
          _dir.set(Math.cos(aim) * Math.cos(elev), Math.sin(elev), Math.sin(aim) * Math.cos(elev));
          barrelG.quaternion.setFromUnitVectors(_up, _dir);
          bp = new THREE.Vector3(x, h0 - 0.35, z).addScaledVector(_dir, BLEN - 0.15);   // boca real
          bv = _dir.clone().multiplyScalar(v0);
          ball.visible = true;
        }
        if (bp) {
          bv.y -= 9.8 * dt; bp.addScaledVector(bv, dt);
          if (bp.y < by + BR && bv.y < 0) {            // toca el piso → REBOTA y se va asentando
            bp.y = by + BR; bv.y *= -0.45; bv.x *= 0.75; bv.z *= 0.75;
            if (Math.abs(bv.y) < 0.4) bv.y = 0;
          }
          ball.position.copy(bp); col.x = bp.x; col.y = bp.y; col.z = bp.z;
        }
      };
    } else if (m.type === 'gate') {
      // puerta doble que ABRE y CIERRA: 2 paneles deslizan sobre el eje transversal del pasillo
      const axis = m.axis || 'x', pw = m.panelW || 0.9, ph = m.h || 2.0, speed = m.speed || 1.0, y0 = by;
      const mat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.7 });
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? pw : 0.16, ph, axis === 'x' ? 0.16 : pw), mat.clone());
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? pw : 0.16, ph, axis === 'x' ? 0.16 : pw), mat.clone());
      g.add(p1); g.add(p2);
      const c1 = { minx: 0, maxx: 0, miny: y0, maxy: y0 + ph, minz: 0, maxz: 0, kind: 'obstacle' };
      const c2 = { minx: 0, maxx: 0, miny: y0, maxy: y0 + ph, minz: 0, maxz: 0, kind: 'obstacle' };
      cols.push(c1, c2);
      step = (t) => {
        const open = (0.5 + 0.5 * Math.sin(t * speed)) * pw;   // 0 cerrado (juntas) → pw abierto
        const yc = y0 + ph / 2;
        if (axis === 'x') {
          const x1 = x - pw / 2 - open, x2 = x + pw / 2 + open;
          p1.position.set(x1, yc, z); p2.position.set(x2, yc, z);
          c1.minx = x1 - pw / 2; c1.maxx = x1 + pw / 2; c1.minz = z - 0.08; c1.maxz = z + 0.08;
          c2.minx = x2 - pw / 2; c2.maxx = x2 + pw / 2; c2.minz = z - 0.08; c2.maxz = z + 0.08;
        } else {
          const z1 = z - pw / 2 - open, z2 = z + pw / 2 + open;
          p1.position.set(x, yc, z1); p2.position.set(x, yc, z2);
          c1.minz = z1 - pw / 2; c1.maxz = z1 + pw / 2; c1.minx = x - 0.08; c1.maxx = x + 0.08;
          c2.minz = z2 - pw / 2; c2.maxz = z2 + pw / 2; c2.minx = x - 0.08; c2.maxx = x + 0.08;
        }
      };
    }
    step(0);
    return { group: g, colliders: cols, step, windAt: g.userData.windAt || null, snd: g.userData.snd || null };
  }

  function buildHouse(THREE, scene, level) {
    const L = typeof level === 'number' ? LEVELS[level] : level;
    const group = new THREE.Group();
    scene.add(group);
    const floorY = 0, ceilY = L.ceiling;
    const colliders = [];
    const b = rectsBounds(L.rects);
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;

    // PISO y TECHO (cubren la bounding; los muros encierran la forma real)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 4, spanZ + 4), new THREE.MeshStandardMaterial({ color: 0xe6d2ac, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, floorY, cz); group.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 4, spanZ + 4), new THREE.MeshStandardMaterial({ color: ROOM_TINT, roughness: 1, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, ceilY, cz); group.add(ceil);
    colliders.push({ minx: b.minX - 5, maxx: b.maxX + 5, miny: ceilY, maxy: ceilY + 2, minz: b.minZ - 5, maxz: b.maxZ + 5, kind: 'ceiling' });

    // MUROS auto-generados (perímetro de la unión de rects, con aperturas donde conectan)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf3ead9, roughness: 0.92 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xd9c39a, roughness: 0.8 });
    // paredes con OFICIO (Jorge: "tan feas"): guardapolvo de COLOR por nivel + moldura blanca arriba
    const ACCENTS = [0x9fc6a8, 0xa8b9d6, 0xd6b9a8, 0xc6a8c2, 0xb9d0a4, 0xd0c39a, 0xa4c4cc, 0xccaFa4];
    const accent = ACCENTS[(LEVELS.indexOf(L) >= 0 ? LEVELS.indexOf(L) : 0) % ACCENTS.length];
    const wainMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.85 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xfdf6e8, roughness: 0.7 });
    const walls = [];
    wallSegments(L.rects).forEach(w => {
      const wm = new THREE.Mesh(new THREE.BoxGeometry(w.w, ceilY, w.d), wallMat.clone());
      wm.position.set(w.x, ceilY / 2, w.z); wm.userData.wall = true; group.add(wm); walls.push(wm);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.02, 0.18, w.d + 0.02), baseMat);
      base.position.set(w.x, 0.09, w.z); group.add(base);
      const wain = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.03, 0.72, w.d + 0.03), wainMat);   // guardapolvo (media pared baja de color)
      wain.position.set(w.x, 0.18 + 0.36, w.z); group.add(wain);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.03, 0.14, w.d + 0.03), crownMat); // moldura de techo
      crown.position.set(w.x, ceilY - 0.07, w.z); group.add(crown);
      colliders.push({ minx: w.x - w.w / 2, maxx: w.x + w.w / 2, miny: 0, maxy: ceilY, minz: w.z - w.d / 2, maxz: w.z + w.d / 2, kind: 'wall' });
    });

    // PISTA(S) CIRCULAR(ES) de muros BAJOS (la cámara ve por encima) + entrada recta (chute) + barrotes.
    // `rings: [...]` = varios anillos (p.ej. "La ese"); `ring: {...}` legacy = uno.
    for (const rg of (L.rings || (L.ring ? [L.ring] : []))) {
      const cxr = rg.cx, czr = rg.cz, hW = rg.h || 1.8, T = 0.25;
      const trackMat = new THREE.MeshStandardMaterial({ color: 0xd8b487, roughness: 0.9, side: THREE.DoubleSide });
      const floorA = new THREE.Mesh(new THREE.RingGeometry(rg.rIn, rg.rOut, 72), trackMat);
      floorA.rotation.x = -Math.PI / 2; floorA.position.set(cxr, 0.02, czr); group.add(floorA);   // piso de la pista (madera)
      const lowMat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide });
      // muro INTERNO bajo (cilindro completo) — colisión = cyl sólido exacto
      const wIn = new THREE.Mesh(new THREE.CylinderGeometry(rg.rIn, rg.rIn, hW, 64, 1, true), lowMat(0xf3ead9));
      wIn.position.set(cxr, hW / 2, czr); group.add(wIn);
      colliders.push({ shape: 'cyl', x: cxr, z: czr, y0: 0, y1: hW, r: rg.rIn, kind: 'wall' });
      // muro EXTERNO bajo con APERTURAS (lista `gaps`; legacy gapA0/gapA1 = una sola). Un ARCO visual por
      // cada tramo ENTRE aperturas. Mapeo: θ_three = 90° − φ y el arco ARRANCA donde TERMINA la apertura
      // (con el otro borde quedaba corrido: pared visual SOBRE el hueco físico = "lámina penetrable", bug Jorge).
      const gapsSrc = (rg.gaps && rg.gaps.length) ? rg.gaps : (rg.gapA0 != null ? [[rg.gapA0, rg.gapA1]] : null);
      if (!gapsSrc) {
        // CIRCUITO CERRADO (sin aperturas): cilindro externo completo
        const wOut = new THREE.Mesh(new THREE.CylinderGeometry(rg.rOut, rg.rOut, hW, 96, 1, true), lowMat(0xe9dcc4));
        wOut.position.set(cxr, hW / 2, czr); group.add(wOut);
        colliders.push({ shape: 'ring', cx: cxr, cz: czr, r: rg.rOut, t: T, y1: hW, gaps: [], kind: 'wall' });
      } else {
        const gaps = gapsSrc.slice().sort((a, b) => a[0] - b[0]);
        for (let gi = 0; gi < gaps.length; gi++) {
          const aEnd = gaps[gi][1];                                   // el muro arranca al TERMINAR esta apertura
          const aNext = gi + 1 < gaps.length ? gaps[gi + 1][0] : gaps[0][0] + Math.PI * 2;   // ... hasta la siguiente
          const span = aNext - aEnd;
          if (span < 0.01) continue;
          const wOut = new THREE.Mesh(new THREE.CylinderGeometry(rg.rOut, rg.rOut, hW, 72, 1, true, Math.PI / 2 - aEnd - span, span), lowMat(0xe9dcc4));
          wOut.position.set(cxr, hW / 2, czr); group.add(wOut);
        }
        colliders.push({ shape: 'ring', cx: cxr, cz: czr, r: rg.rOut, t: T, y1: hW, gaps, kind: 'wall' });
      }
      // CHUTE: pasillo recto de entrada — RIELES BAJOS (1.0 m): el dron (vuela a 1.4) pasa por encima
      // y la cámara nunca queda tapada al despegar ("lámina" que vio Jorge). Colisión = forma exacta (maxy 1.0).
      if (rg.chute) {
        const ch = rg.chute, chH = ch.h || 1.0, len = ch.z1 - ch.z0, zc = (ch.z0 + ch.z1) / 2;
        [-1, 1].forEach(s => {
          const wc = box(THREE, ch.t, chH, len, 0xe9dcc4); wc.position.set(cxr + s * ch.x, chH / 2, zc);
          wc.userData.wall = true; group.add(wc); walls.push(wc);   // entra al sistema de muro-transparente
          colliders.push({ minx: cxr + s * ch.x - ch.t / 2, maxx: cxr + s * ch.x + ch.t / 2, miny: 0, maxy: chH, minz: ch.z0, maxz: ch.z1, kind: 'wall' });
        });
      }
      // BARROTES (postes): cierran el atajo pero DEJAN VER (idea Jorge); colisión cyl exacta
      (rg.posts || []).forEach((pp, i) => {
        const po = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, hW, 14), lowMat(i % 2 ? 0xe07a6f : 0xf3ead9));
        po.position.set(pp.x, hW / 2, pp.z); group.add(po);
        colliders.push({ shape: 'cyl', x: pp.x, z: pp.z, y0: 0, y1: hW, r: 0.16, kind: 'wall' });
      });
    }

    // VENTANA con luz de día en el muro del fondo
    const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.4, spanX * 0.5), Math.min(1.4, ceilY * 0.5)), new THREE.MeshBasicMaterial({ color: 0xcdeeff }));
    win.position.set(cx, ceilY * 0.58, b.minZ + 0.03); group.add(win);
    const winLight = new THREE.PointLight(0xfff2d0, 0.5, 16); winLight.position.set(cx, ceilY * 0.58, b.minZ + 1.5); group.add(winLight);

    // ALFOMBRA en la primera sala
    const r0 = L.rects[0];
    const rug = new THREE.Mesh(new THREE.CircleGeometry(Math.min(r0.w, r0.d) * 0.32, 32), new THREE.MeshStandardMaterial({ color: 0xcf9f8f, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(r0.x, 0.012, r0.z); group.add(rug);

    // LÁMPARAS de techo por sala (decor puro, sin colisión) + luz cálida
    L.rects.forEach(r => {
      if (Math.min(r.w, r.d) < 2.4) return;   // sólo en salas, no en pasillos angostos
      const cl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.1, 18), new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xffdf8a, emissiveIntensity: 0.7 }));
      cl.position.set(r.x, ceilY - 0.07, r.z); group.add(cl);
      const li = new THREE.PointLight(0xfff0c0, 0.35, 12); li.position.set(r.x, ceilY - 0.3, r.z); group.add(li);
    });

    // ESCALERA (visual): escalones de madera que suben + plataforma alta. NO colisiona (el dron
    // la sobrevuela a altura automática sobre el terreno) → subir/bajar es fácil, no se choca con ella.
    if (L.stairs) {
      const s = L.stairs, cx0 = s.cx || 0, sw = s.w, dz = (s.zBot - s.zTop) / s.steps, woodA = 0xd8b487, woodB = 0xc9a06a;
      for (let i = 0; i < s.steps; i++) {
        const topY = s.H * (i + 1) / s.steps;                 // altura acumulada del escalón i (escalones ALTOS = subida exagerada)
        const zc = s.zBot - dz * (i + 0.5);
        const st = box(THREE, sw, topY, dz + 0.02, i % 2 ? woodA : woodB); st.position.set(cx0, topY / 2, zc); group.add(st);
      }
      // PLATAFORMA del PISO ALTO: cubre TODO el área al norte de zTop a la altura H (2º piso de la casa)
      const platD = s.zTop - b.minZ + 0.6;
      const plat = box(THREE, spanX + 0.6, s.H, platD, 0xd8c4a0); plat.position.set(cx, s.H / 2, s.zTop - platD / 2 + 0.3); group.add(plat);
    }

    // TERRENO data-driven (niveles 13+): visual genérico por feature (la colisión de altura es terrainY)
    const woodA = 0xd8b487, woodB = 0xc9a06a;
    (L.terrain || []).forEach(f => {
      if (f.type === 'plateau') {
        const p = box(THREE, f.maxx - f.minx, f.h, f.maxz - f.minz, 0xd8c4a0);
        p.position.set((f.minx + f.maxx) / 2, f.h / 2, (f.minz + f.maxz) / 2); group.add(p);
      } else if (f.type === 'rampz' || f.type === 'rampx') {
        const dh = Math.abs(f.h1 - f.h0), n = Math.max(3, Math.ceil(dh / 0.33));
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n, topY = Math.max(f.h0, f.h1) === f.h1 ? f.h0 + dh * t1 : f.h0 - dh * t1;
          const hStep = Math.max(0.05, (f.h0 + (f.h1 - f.h0) * t1));
          if (f.type === 'rampz') {
            const z0 = f.z0 + (f.z1 - f.z0) * t0, z1 = f.z0 + (f.z1 - f.z0) * t1;
            const st = box(THREE, f.maxx - f.minx, hStep, Math.abs(z1 - z0) + 0.02, i % 2 ? woodA : woodB);
            st.position.set((f.minx + f.maxx) / 2, hStep / 2, (z0 + z1) / 2); group.add(st);
          } else {
            const x0 = f.x0 + (f.x1 - f.x0) * t0, x1 = f.x0 + (f.x1 - f.x0) * t1;
            const st = box(THREE, Math.abs(x1 - x0) + 0.02, hStep, f.maxz - f.minz, i % 2 ? woodA : woodB);
            st.position.set((x0 + x1) / 2, hStep / 2, (f.minz + f.maxz) / 2); group.add(st);
          }
        }
      } else if (f.type === 'spiral') {
        const n = 22, rMid = (f.rIn + f.rOut) / 2, w = f.rOut - f.rIn;
        for (let i = 0; i < n; i++) {
          const a = f.a0 + (f.a1 - f.a0) * (i + 0.5) / n, hTop = Math.max(0.06, f.h0 + (f.h1 - f.h0) * (i + 1) / n);
          const arc = rMid * (f.a1 - f.a0) / n + 0.05;
          const st = box(THREE, w, hTop, arc, i % 2 ? woodA : woodB);
          st.position.set(f.cx + Math.cos(a) * rMid, hTop / 2, f.cz + Math.sin(a) * rMid);
          st.rotation.y = -a; group.add(st);
        }
      } else if (f.type === 'funnel') {
        const pts = [new THREE.Vector2(0.02, f.h), new THREE.Vector2(f.rMin, f.h), new THREE.Vector2(f.rMax, 0.005)];
        const cone = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: 0xd8b487, roughness: 0.9, side: THREE.DoubleSide }));
        cone.position.set(f.cx, 0, f.cz); group.add(cone);
        const N = 30, TURNS = 2.2;   // cinta espiral (guía del camino) pegada a la superficie del cono
        for (let i = 0; i < N; i++) {
          const t = (i + 0.5) / N, r = f.rMax - (f.rMax - f.rMin) * t, a = t * TURNS * Math.PI * 2 + Math.PI / 2;
          const hY = f.h * (f.rMax - r) / (f.rMax - f.rMin);
          const st = box(THREE, 0.75, 0.07, r * TURNS * Math.PI * 2 / N + 0.08, i % 2 ? 0xc9a06a : 0xe0cba8);
          st.position.set(f.cx + Math.cos(a) * r, hY + 0.035, f.cz + Math.sin(a) * r);
          st.rotation.y = -a; group.add(st);
        }
      } else if (f.type === 'ringplat') {
        // superficie TORNEADA que calza el perfil campana EXACTO del terreno (nada que atravesar)
        const rMid = (f.rIn + f.rOut) / 2, W = (f.rOut - f.rIn) / 2 + (f.skirt || 0.5);
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const r = Math.max(0.02, rMid - W + (2 * W) * i / 24);
          const d = Math.abs(r - rMid);
          pts.push(new THREE.Vector2(r, Math.max(0.005, f.h * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, d / W))))));
        }
        const hill = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: 0xd8c4a0, roughness: 0.9, side: THREE.DoubleSide }));
        hill.position.set(f.cx, 0, f.cz); group.add(hill);
      }
    });

    // MUROS-CAJA sueltos (p.ej. cara frontal de una meseta sin rampa — solo se sube con el géiser)
    (L.boxWalls || []).forEach(bw => {
      const wm = box(THREE, bw.maxx - bw.minx, bw.h, bw.maxz - bw.minz, 0xe9dcc4);
      wm.position.set((bw.minx + bw.maxx) / 2, bw.h / 2, (bw.minz + bw.maxz) / 2); wm.userData.wall = true; group.add(wm); walls.push(wm);
      colliders.push({ minx: bw.minx, maxx: bw.maxx, miny: 0, maxy: bw.h, minz: bw.minz, maxz: bw.maxz, kind: 'wall' });
    });

    // COLUMNA(S): cilindro sólido con colisión exacta (`columns: [...]` = varias; `column` legacy = una)
    for (const c of (L.columns || (L.column ? [L.column] : []))) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.h, 28), new THREE.MeshStandardMaterial({ color: 0xe0cba8, roughness: 0.85 }));
      col.position.set(c.x, c.h / 2, c.z); group.add(col);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(c.r + 0.12, c.r + 0.12, 0.12, 28), new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85 }));
      cap.position.set(c.x, c.h + 0.06, c.z); group.add(cap);
      colliders.push({ shape: 'cyl', x: c.x, z: c.z, y0: 0, y1: c.h + 0.12, r: c.r, kind: 'obstacle' });
    }

    // FUERA DEL MUNDO (pensado, no accidente): la casita vive sobre un PISO DE MADERA GIGANTE de un
    // cuarto gigante; bloques de juguete enormes a lo lejos, suavizados por la niebla. Si la cámara
    // asoma por encima o entre muros, se ve un mundo coherente, no el vacío.
    const giant = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0xb98d5f, roughness: 0.95 }));
    giant.rotation.x = -Math.PI / 2; giant.position.set(cx, -0.03, cz); group.add(giant);
    const GB = [[-20, -14, 0xe07a6f], [22, -10, 0x74b6d4], [16, 18, 0x86bf8e], [-18, 16, 0xe8c66a]];
    GB.forEach(([gx, gz, gc], i) => {
      const s = 5 + (i % 2) * 2.5;
      const bl = box(THREE, s, s, s, gc); bl.position.set(cx + gx, s / 2 - 0.02, cz + gz); bl.rotation.y = 0.4 + i; group.add(bl);
    });
    // PAREDES del cuarto gigante (lejos): cierran el horizonte — nunca se ve "azul indefinido"
    const GW = 48, GH = 30;
    [[0, -GW, 0], [0, GW, Math.PI], [-GW, 0, Math.PI / 2], [GW, 0, -Math.PI / 2]].forEach(([wx, wz, ry], i) => {
      const gw = new THREE.Mesh(new THREE.PlaneGeometry(GW * 2.4, GH), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd9c8ae : 0xd2bfa2, roughness: 1 }));
      gw.position.set(cx + wx, GH / 2 - 0.03, cz + wz); gw.rotation.y = ry; group.add(gw);
    });
    // VENTANA GIGANTE con luz de día en la pared norte del cuarto gigante (referencia cálida)
    const gwin = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), new THREE.MeshBasicMaterial({ color: 0xfff3d8 }));
    gwin.position.set(cx + 8, 15, cz - GW + 0.3); group.add(gwin);
    // zócalo gigante (escala de juguete: refuerza que la casita está en un cuarto enorme)
    [[0, -GW + 0.2, 0], [-GW + 0.2, 0, Math.PI / 2]].forEach(([wx, wz, ry]) => {
      const zg = new THREE.Mesh(new THREE.PlaneGeometry(GW * 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xbfa886, roughness: 1 }));
      zg.position.set(cx + wx, 1.1, cz + wz + (ry ? 0 : 0.05)); zg.rotation.y = ry; group.add(zg);
    });

    // OBSTÁCULOS (visual + colliders precisos)
    (L.obstacles || []).forEach(o => { group.add(buildObstacle(THREE, o)); obstacleColliders(o).forEach(c => colliders.push(c)); });

    // OBSTÁCULOS CON MOVIMIENTO (ventilador/péndulo/puerta) — colisión con posición VIVA (se stepean en main)
    const movers = [];
    (L.movers || []).forEach(mm => { const mv = buildMover(THREE, mm); group.add(mv.group); movers.push(mv); });

    // TRAMPAS (globos / robot) — esfera de activación por proximidad
    const traps = [];
    (L.traps || []).forEach(t => {
      const g = new THREE.Group();
      if (t.type === 'balloon') {
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.4 })); bl.scale.y = 1.2; bl.position.y = 1.4; g.add(bl);
        const str = box(THREE, 0.02, 1.4, 0.02, 0x555555); str.position.y = 0.7; g.add(str);
      } else {
        const bo = box(THREE, 0.5, 0.6, 0.4, 0x9aa7b4); bo.position.y = 0.5; g.add(bo);
        const hd = box(THREE, 0.35, 0.35, 0.35, 0xcdd6df); hd.position.y = 1.0; g.add(hd);
      }
      g.position.set(t.x, 0, t.z); group.add(g);
      traps.push({ pos: { x: t.x, y: 1.2, z: t.z }, r: t.r, type: t.type, mesh: g, armed: true });
    });

    // PUNTOS a recolectar (estrella dorada que gira) — hay que juntarlos antes de la meta.
    const collectibles = [];
    (L.points || []).forEach(p => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 10, 20), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 }));
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffcf33, emissiveIntensity: 1.1 }));
      g.add(ring); g.add(core);
      g.position.set(p.x, L.goal.y, p.z); group.add(g);
      collectibles.push({ pos: { x: p.x, y: L.goal.y, z: p.z }, mesh: g, taken: false });
    });

    // PUNTO DE LLEGADA en el aire (anillo/esfera que pulsa). Empieza BLOQUEADO (gris) hasta juntar los puntos.
    const goalMesh = new THREE.Group();
    const gring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 12, 28), new THREE.MeshStandardMaterial({ color: 0x8a8f98, emissive: 0x44484f, emissiveIntensity: 0.6 }));
    gring.rotation.x = Math.PI / 2; goalMesh.add(gring);
    const gcore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd7dbe0, emissive: 0x777c84, emissiveIntensity: 0.7 })); goalMesh.add(gcore);
    goalMesh.position.set(L.goal.x, L.goal.y, L.goal.z); group.add(goalMesh);

    // SOMBRAS: todo recibe; las cajas/objetos proyectan (los planos — piso/techo/ventana — no)
    group.traverse(o => { if (o.isMesh) { o.receiveShadow = true; if (o.geometry && o.geometry.type !== 'PlaneGeometry' && o.geometry.type !== 'RingGeometry') o.castShadow = true; } });

    return {
      name: L.name, tutorial: !!L.tutorial, colliders, floorY, ceilingY: ceilY, walls,
      start: L.start, goal: { pos: { x: L.goal.x, y: L.goal.y, z: L.goal.z }, mesh: goalMesh, ring: gring, core: gcore },
      traps, collectibles, movers, group, bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, cx, cz },
      terrainY: terrainFn(L), flightHeight: (L.flightHeight != null ? L.flightHeight : null),
    };
  }

  // export dual: navegador (window) + node (module) para tests
  if (typeof window !== 'undefined') {
    window.buildHouse = buildHouse;
    window.hitColliders = hitColliders;
    window.DRON_LEVELS = LEVELS;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LEVELS, wallSegments, hitColliders, obstacleColliders, validateLevel, insideRects, rectsBounds, terrainFn, buildMover };
  }
})();
