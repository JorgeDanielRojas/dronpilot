# Candidatos de sonido de propela — Dron Pilot

Sondeo Pixabay (metodo AUDIO.md: filtrar por titulo -> oir el CUERPO sostenido, no el ataque).
Elegidos 3 con TIMBRES DISTINTOS para el loop de vuelo. Escucha candidatos_propela.mp3 (voz Paulina anuncia cada uno).

| # | Titulo Pixabay | URL | Timbre (cuerpo sostenido) |
|---|---|---|---|
| 1 | Parrot AR drone 2 | https://pixabay.com/sound-effects/film-special-effects-parrot-ar-drone-2-23421/ | Zumbido GRAVE, fundamental hondo (~61 Hz), hum pesado de dron grande. Clip largo (100 s), muy lopeable. |
| 2 | electric buzz | https://pixabay.com/sound-effects/technology-electric-buzz-8456/ | Buzz MEDIO calido y fuerte (fundamental ~360 Hz, centroide ~2 kHz): abeja electrica constante. |
| 3 | Drone Flying | https://pixabay.com/sound-effects/film-special-effects-drone-flying-67483/ | Whine AGUDO brillante (centroide ~7.4 kHz): silbido fino de quad pequeno rapido. |

## Archivos
- candidatos_propela.mp3 — los 3 seguidos con voz Paulina, ~4 s de cuerpo cada uno (16.8 s total).
- opcion1/2/3.mp3 — originales completos SIN recortar (usar el que Jorge elija).
- raw_*.mp3 — los 7 candidatos crudos del sondeo.

## Descartados
- Military FPV Drone Attack (explosion) · Motor brake sound (freno) · DJI Mini 3 y UAS Drone Hover 01 (mid-brillante redundante, quedan de reserva en raw_).

## Verificacion
FFT del cuerpo (centroide + fundamental) + guard RMS por segundo del mp3 final: 0 zonas muertas (parrot tenia hueco en t=48-52 -> clip movido a t=55).
