# Resultados: Silbo, mensajes por sonido (sprint 2)

**Silbo** es una app web que pasa un mensaje, una foto o un archivo pequeño de un móvil a otro solo con sonido: sin internet, sin Bluetooth, sin cuentas. Funciona sin conexión una vez cargada. El módem (modulación, sincronización, corrección de errores) está escrito desde cero en TypeScript.

Frase para no técnicos: **«Le pasé un capítulo entero de un libro, 4167 palabras, a otro móvil en medio minuto y solo con el altavoz; y una foto a todos los móviles de la mesa a la vez.»** (En simulación y en Chromium con micrófono simulado; ver abajo.)

## Qué se logró según `score`

Peldaño confirmado: **R7, el último** (`SCORE.txt`, pasada completa del 2026-10-21, 1443 s). Todas las cifras son contra el simulador de canal acústico (`src/sim`, suposiciones en `CANAL.md`) o en Chromium real con micrófono simulado, **no con móviles reales**.

| peldaño | qué | resultado |
|---|---|---|
| R0 | simulador de canal (altavoz y micro de móvil, 3 salas sintéticas, ruido, ±200 ppm, saturación, CAG) autocomprobado; FSK de referencia | la FSK lenta falla en sala media (1/20): por eso el módem propio |
| R1 | texto de 140 caracteres, sala media, 15 dB | 200/200; 2,7 s por mensaje, 456 bit/s |
| R2 | rejilla de 90 condiciones (5-25 dB, 3 salas, ±200 ppm, saturación) | 900/900; 0 tramas falsas en 10 min de ambiente (control 10/10) |
| R3 | foto JPEG de 10 KB, 15 dB | 20/20 en ≤60 s (unos 36 s), OFDM a ~2,2 kbit/s útiles |
| R4 | PWA sin conexión, dos botones, espectrograma, progreso; Chromium con viewport de móvil; axe-core | todas las comprobaciones pasan |
| R5 | difusión: 6 receptores a la vez por emisión, misma sala, cada uno en su sitio | 60/60 con la foto en ≤60 s; 3 Chromium a la vez también |
| R5 | modo discreto 17,6-19,3 kHz con su propio modelo de canal | 300/300 en 60 condiciones; 0 falsos en 10 min de ambiente agudo; energía audible (<16 kHz) −90 dB |
| R6 | `DEMO.md`, página de inicio (`app/acerca.html`, español + inglés), `PRUEBA-CON-MOVILES.md`, tabla honesta | todo presente; las cifras de la tabla se comprueban contra `SCORE.txt` |
| R7 | capítulo 9 del libro de Python (28 KB → 7,8 KB comprimido) por sonido | 20/20 íntegros por SHA-256 en ≤60 s (mediana 31,5 s, 29 s por vuelta del carrusel); también en Chromium |

## Cómo verlo o reproducirlo

```bash
git clone -b reto2/sonido https://github.com/perezamadorluisenrique-gif/Prototipes silbo && cd silbo
./setup.sh                      # npm ci (Node >= 22.18)
node tools/build-app.ts         # la app queda en dist/
npx http-server dist -p 8080    # y abre http://localhost:8080 en el ordenador
./score                         # toda la escalera, ~35 min con 2 núcleos (necesita Chromium: CHROMIUM=/ruta)
node tests/e2e/r5.ts            # solo la prueba de difusión y modo discreto en Chromium
```

Para móviles: `PRUEBA-CON-MOVILES.md` (el micrófono pide HTTPS: GitHub Pages o reenvío de puertos por USB).

## Qué no se logró, y por qué

- **Nada está medido con móviles reales.** Es lo más importante que falta. El simulador no modela móviles que se mueven (el perfil de archivos supone móviles quietos), ni qué emite y capta cada móvil por encima de 17 kHz.
- **Aulas grandes con mucho eco (RT60 1 s): las fotos y archivos no llegan** (0/12 en simulación). El texto sí (perfil robusto, 900/900 incluida esa sala). La frase «a toda la clase» vale hoy para una sala pequeña o media, o con los móviles cerca. Siguiente paso técnico: un perfil de archivos con símbolos OFDM más largos o más repetición, que el carrusel alterne.
- **Modo discreto**: el simulador dice que funciona incluso a 5 dB, pero muchos móviles baratos no emiten o no captan bien a 17-20 kHz; la app lo avisa. Solo texto corto (hasta 200 bytes, unos 8-10 s).
- Velocidades modestas por diseño (robustez antes que velocidad): texto ~280-460 bit/s, archivos ~2,2 kbit/s.

## Qué tiene que hacer Enrique

1. Probarlo con dos o tres móviles siguiendo `PRUEBA-CON-MOVILES.md` y apuntar la tabla de resultados reales en ese mismo fichero.
2. Si quiere enseñarlo: publicar `dist/` (por ejemplo en GitHub Pages desde un repo nuevo; el sprint no publica nada) y ensayar `DEMO.md`.
3. Detalle encontrado de paso en el libro del primer reto (no se tocó, es de solo lectura): en la tabla final del capítulo 9, `min(list)` dice «Devuelve el elemento máximo».
