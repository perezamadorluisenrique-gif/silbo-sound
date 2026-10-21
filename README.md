# Silbo: mensajes por sonido

> **In English:** Silbo is an offline web app (PWA) that sends a text, a photo or a small file from one phone to another using only sound: no internet, no Bluetooth, no accounts. The acoustic modem (MFSK and OFDM modulation, chirp sync, Reed-Solomon and Viterbi error correction) is written from scratch in TypeScript. It can broadcast to many phones at once and has a near-ultrasonic "discreet mode" (17.6-19.3 kHz). All figures below come from an acoustic channel simulator and Chromium with a simulated microphone — **not yet from real phones**. Try it: https://perezamadorluisenrique-gif.github.io/silbo-sound/

**Silbo** pasa un mensaje, una foto o un archivo pequeño de un móvil a otro solo con sonido: sin internet, sin Bluetooth, sin cuentas. Una vez cargada funciona sin conexión. El módem (modulación, sincronización, corrección de errores) está escrito desde cero en TypeScript.

**Pruébala:** https://perezamadorluisenrique-gif.github.io/silbo-sound/ (el micrófono necesita HTTPS; ábrela una vez con conexión y luego funciona en modo avión).

## Qué consigue (en simulación)

Todas las cifras salen del simulador de canal acústico (`src/sim`, suposiciones en `CANAL.md`) o de Chromium real con micrófono simulado; detalle en `SCORE.txt` y `RESULTADOS.md`.

| prueba | resultado |
|---|---|
| Texto de 140 caracteres, sala media, 15 dB | 200/200; 2,7 s por mensaje |
| Rejilla de 90 condiciones (5-25 dB, 3 salas, ±200 ppm, saturación) | 900/900; 0 tramas falsas en 10 min de ambiente |
| Foto JPEG de 10 KB | 20/20 en unos 36 s (OFDM, ~2,2 kbit/s útiles) |
| Difusión: 6 receptores a la vez | 60/60 con la foto en ≤60 s |
| Modo discreto 17,6-19,3 kHz | 300/300 en 60 condiciones |
| Capítulo de libro (28 KB → 7,8 KB comprimido) | 20/20 íntegro en una mediana de 31,5 s |

**Límites honestos:** nada está medido aún con móviles reales; en aulas grandes con mucho eco las fotos no llegan (el texto sí); muchos móviles baratos no emiten ni captan bien a 17-20 kHz (la app lo avisa).

## Demo de 60 segundos

Tres móviles en modo avión, quietos sobre la mesa a menos de un metro: un texto a dos receptores (~4 s), una foto en carrusel a los dos a la vez (~40 s) y un texto en modo discreto. Guion completo en `DEMO.md`.

## Probar con móviles reales

Sigue `PRUEBA-CON-MOVILES.md`: volumen al 80-90 %, móviles quietos, 5 repeticiones por prueba (texto a 20 cm-4 m, foto, difusión, modo discreto, ruido de fondo) y apunta los resultados en ese fichero.

## Hacer un APK para Android con PWABuilder

1. Abre https://www.pwabuilder.com/ y pega la dirección de la app: `https://perezamadorluisenrique-gif.github.io/silbo-sound/`.
2. Pulsa **Start**; PWABuilder revisa el manifiesto, el service worker y los iconos (192 y 512 px PNG ya incluidos).
3. Pulsa **Package for stores → Android → Generate Package**. Para instalarlo tú mismo vale la opción por defecto; si lo vas a subir a Google Play, guarda bien la clave de firma (`signing.keystore` y su contraseña) que viene en el zip.
4. Descomprime el zip y copia el `.apk` al móvil (o `adb install app-release-signed.apk`). Hay que permitir «instalar apps de origen desconocido».
5. Para que el APK abra sin la barra del navegador, sube el `assetlinks.json` del zip a `/.well-known/` del dominio raíz (`perezamadorluisenrique-gif.github.io`). Sin él funciona igual, con una barra arriba.

## Construir y desarrollar

```bash
npm ci                          # Node >= 22.18
node tools/build-app.ts         # la app queda en dist/
npx http-server dist -p 8080    # http://localhost:8080
npm test                        # pruebas unitarias
./score                         # escalera completa (~35 min, necesita Chromium: CHROMIUM=/ruta)
```

Cada push a `main` construye la app y la publica en GitHub Pages (`.github/workflows/pages.yml`).

Créditos y licencias: `CREDITOS.md`.
