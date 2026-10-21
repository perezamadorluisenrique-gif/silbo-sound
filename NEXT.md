# Siguiente paso

Estado: **R7 confirmado** por `./score` (último peldaño; sesión ffd6da80, 2026-10-21; ver `SCORE.txt`). Proyecto **cerrado** (`status: done`, `RESULTADOS.md`). Si alguien lo retoma: el perfil de archivos para aulas grandes (abajo).

## Nombre: «Silbo»

Por el silbo gomero, el lenguaje silbado de La Gomera con el que se mandaban mensajes de un valle a otro sin cables: la misma idea con un móvil. Corto, español y se entiende en una frase.

## Entorno

```bash
./setup.sh          # npm ci (Node >= 22.18 ejecuta .ts directamente)
npm test            # FEC, Viterbi, módem (incluido el perfil discreto), trozos
npx tsc --noEmit    # tipos
node tools/build-app.ts            # app en dist/
node tests/e2e/run.ts --no-build   # e2e de R4 (~100 s)
node tests/e2e/r5.ts --no-build    # e2e de R5: discreto + difusión con 3 Chromium (~90 s)
./score             # ~35 min con 2 núcleos; --quick para probar (no vale para subir peldaño); --only R5
```

Si el entorno bloquea `./setup.sh` o `./score` («código externo»), ejecuta sus líneas a mano: `npm ci --no-audit --no-fund` y `node scoring/score.ts`.

`score` reparte el trabajo en procesos hijos (`scoring/grid.ts`, `scoring/r3.ts`, `scoring/r5.ts`, modo `--worker`), uno por núcleo. **No edites `src/` ni `scoring/` mientras corre**: los procesos hijos cargan el código al arrancar y medirían una mezcla.

## Dónde está cada cosa

- `src/dsp/`: FFT propia, filtros biquad, PRNG con semilla.
- `src/fec/`: Reed-Solomon con borrados (`rs.ts`), CRC-32/8, aleatorizador, código convolucional K=7 tasa 1/2 con Viterbi suave (`conv.ts`).
- `src/sim/`: simulador de canal (`channel.ts`, con `band: 'ultrasonic'` para el modo discreto), ambiente de 10 min (`ambience()`) y ambiente con agudos (`ultraAmbience()`). Suposiciones en `CANAL.md`.
- `src/modem/chirp.ts`: chirps (con `taperFrac` para rampas suaves), NCC, `findChirps`.
- `src/modem/mfsk.ts`: **la trama y el receptor de todo**. Trama = chirp + cabecera MFSK (perfil, longitud, CRC-8, RS(12,4)) + carga + chirp descendente.
  - **Familias de trama** (`Family`): `PHONE` (chirps 800-7800 Hz; perfiles 0 «rápido», 1 «robusto», 2 «archivo» OFDM) y `ULTRA` (chirps 17,4-19,5 kHz de 8192 muestras; perfil 3 «discreto», `DISCRETO`). Cada familia tiene su detector; `decodeAll(rx, override, threshold, fam, skipBefore)` busca una familia y `decodeAny(rx, skip)` las dos.
  - `encodeWith(data, id)` y `airtimeWith(len, id)` para cualquier perfil (0-3).
  - `decodeAll` salta las tramas que empiezan antes de `skipBefore` (ya decodificadas) y las que la cabecera dice que terminan después del final de `rx` (incompletas: se dejan para la ventana siguiente en vez de intentarlas y fallar).
- Perfil 3 «discreto»: MFSK 3 saltos × 3 grupos × 4 tonos = 36 casillas de 46,9 Hz entre 17,63 y 19,31 kHz, 6 bit/símbolo, guarda 256 y rampas de 192 muestras (el cambio de tono no salpica por debajo de 16 kHz), RS con 64 de paridad. 140 bytes en ~8,2 s (~137 bit/s).
- `src/modem/ofdm.ts`: carga OFDM (ver detalles en el código: N=16384, prefijo 2048, 1000-7800 Hz, DQPSK diferencial, diversidad ×2, Viterbi).
- `src/file/chunks.ts`: archivos en trozos con trozo «meta», `Assembler`, carrusel sin canal de vuelta (sirve para difusión).
- `app/`: PWA. `core.ts` (planes de emisión, `Receiver`, `decodeWindow(win, skip)` que recorta lo ya decodificado: la mitad de CPU en un carrusel; sin eso, 3 Chromium a la vez en 2 núcleos perdían tramas), `main.ts` (interfaz: interruptor «Modo discreto» con aviso, espectrograma hasta 20 kHz), `worker.ts`, `capture.worklet.ts`, `sw.template.js`.
- `scoring/`: `score.ts` (la escalera), `grid.ts`, `r3.ts`, **`r5.ts`** (difusión con N receptores en la misma sala, rejilla del modo discreto, falsos positivos con ambiente agudo, micrófonos que cortan antes, fuga audible), `simcheck.ts`, `lib.ts`.
- `tests/e2e/run.ts` (R4), **`tests/e2e/r5.ts`** (R5 en Chromium: aviso visible, axe, fuga audible de lo que suena de verdad en la página, texto discreto recibido, foto a 3 receptores a la vez), `tests/e2e/capture-debug.ts` (graba lo que capta la página receptora de un WAV falso, para separar fallos del módem de fallos de captura).
- `tools/`: experimentos. `discreto-probe.ts [n] [snrs] [salas] [sat]`, `gridprobe.ts`, `frame-test.ts`, `window-replay.ts`, etc.

## Medidas (todas contra el simulador)

| perfil | qué | sala media 15 dB | otras |
|---|---|---|---|
| 0 rápido (MFSK) | 140 car. en 2,73 s, 456 bit/s | 200/200 | aula grande ~14/20 |
| 1 robusto (MFSK) | 140 car. en 4,41 s, 282 bit/s | — | rejilla R2 900/900 |
| 2 archivo (OFDM) | 1500 B en 5,0 s, ~2,4 kbit/s | 8/8 tramas | aula grande: mal (difusión 2/10 en 150 s) |
| 3 discreto (MFSK 17,6-19,3 kHz) | 140 B en 8,19 s, 137 bit/s | — | rejilla 300/300 (5-25 dB, 3 salas, ±200 ppm, saturación); 0 falsos en 10 min de ambiente agudo (control 9/10); fuga < 16 kHz −90 dB |

Difusión (R5): 10 emisiones × 6 receptores en sala pequeña o media: 60/60 con la foto en ≤60 s (mediana 38,7 s); aula grande 0/12. En Chromium, 3 receptores a la vez: ~41 s.

## Lo aprendido (no repetir)

- **El enemigo es la reverberación, no el ruido.** En aula grande (RT60 1 s, DRR 0 dB) el perfil OFDM falla casi siempre: la cola es mucho más larga que el prefijo. MFSK aguanta (el discreto pasa en aula grande a 5 dB).
- El modo discreto funcionó a la primera con el diseño MFSK del perfil robusto trasladado a 17,6 kHz: lo que cuesta allí es el móvil real, no la modulación.
- RS 48 → 64 en el discreto: a 2 dB en aula grande con saturación, 12/24 → 20/24.
- En las pruebas con varios Chromium, el fallo no era del módem: decodificando el WAV fuera del navegador salían todas las tramas. Era CPU (2 núcleos, 3 navegadores con audio en tiempo real). `capture-debug.ts` lo demuestra en un minuto.
- El dispositivo de audio falso de Chromium empieza a sonar al lanzar el navegador, no al pulsar Recibir: el tiempo hasta recibir varía entre ejecuciones (p. ej. texto 4 s o 12 s en R4) según dónde caiga.
- Lo anterior de R1-R4 sigue valiendo (Schroeder en el símbolo de referencia OFDM, búsqueda en rejilla del deslizamiento, signo del deslizamiento, `clockRatio` descarta >300 ppm).

## Riesgo honesto para móviles reales

- Perfil «archivo»: símbolos de 0,38 s con fase diferencial: **supone móviles quietos**. Pedir en `PRUEBA-CON-MOVILES.md` los móviles apoyados en la mesa; si la prueba real falla, probar N=8192 con `rep: 3`.
- Modo discreto: muchos móviles no emiten o no captan bien a 17-20 kHz, y el navegador puede remuestrear a 44,1 kHz con un filtro que corte antes. `score` mide cortes de micrófono en 19/18/17 kHz. La app avisa junto al interruptor. Un altavoz saturado puede hacerlo audible: volumen alto pero no al máximo.

## R6 (presentación): dónde está

- `DEMO.md` (guion de 60 s con plan B), `PRUEBA-CON-MOVILES.md` (instalar con HTTPS, qué medir, qué esperar), `app/acerca.html` (página de inicio para no técnicos con resumen en inglés y la tabla honesta; enlazada desde la cabecera de la app, cacheada por el service worker).
- `scoring/r6.ts` comprueba todo eso, y que **cada cifra n/m de la tabla aparezca en `SCORE.txt`**: si cambias una medida, actualiza la tabla de `app/acerca.html` a mano.

## R7: dónde está

- `assets/capitulo-09-listas.md` (capítulo 9 del libro, CC BY-NC-SA 4.0, ver `CREDITOS.md`), `scoring/r7.ts` (carrusel en el simulador, 20/20 en ≤60 s, mediana 31,5 s), `tests/e2e/r7.ts` (Chromium: el emisor recibe el .md por el selector de archivo; el receptor ofrece descargarlo idéntico, con vista previa).
- La app comprime con `CompressionStream('deflate-raw')` todo archivo que no sea foto, audio, vídeo o comprimido, si gana más del 10 %; el tipo del trozo «meta» lleva el sufijo `;silbo=deflate` (`PACKED` en `app/core.ts`) y el receptor lo descomprime.

## Si se retoma

1. **Aula grande** (lo más flojo para «a toda la clase»): el perfil OFDM da 0/12 con RT60 1 s. Probar con `tools/ofdm-genie.ts` símbolos más largos (`P='{"N":32768,"CP":4096,"rep":2}'`) o `rep: 3`; si funciona, un perfil 4 «archivo lento» que el carrusel alterne.
2. Resultados con móviles reales (`PRUEBA-CON-MOVILES.md`).

## Bloqueos

- `./setup.sh` lo bloqueó una vez el clasificador («código externo») al lanzarlo junto con otros comandos; sus líneas a mano funcionan.
