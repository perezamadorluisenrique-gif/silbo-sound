# Prueba con dos (o más) móviles

Todas las cifras de este proyecto salen de un simulador (`SCORE.txt`, `CANAL.md`). Esta prueba es la que dice si valen en la vida real. Unos 30 minutos.

## 1. Poner la app en los móviles

El micrófono en el navegador solo funciona en una página **segura** (HTTPS o `localhost`), así que no basta con servir `dist/` por la wifi de casa con `http://192.168…`.

```bash
./setup.sh && node tools/build-app.ts     # deja la app en dist/
```

- **Opción A (la más cómoda): GitHub Pages.** Crea tú un repositorio público (por ejemplo `silbo`), copia dentro el contenido de `dist/` y activa Pages (Settings → Pages → rama `main`, carpeta raíz). Abre la dirección en cada móvil una vez con conexión; después funciona en modo avión (service worker). Desde el sprint no se publica nada: esto lo decides tú.
- **Opción B (Android, sin publicar): reenvío de puertos por USB.** En el portátil, `npx http-server dist -p 8080`; conecta el móvil por USB con la depuración activada, abre `chrome://inspect` en el Chrome del portátil, «Port forwarding» 8080 → `localhost:8080`, y en el móvil abre `http://localhost:8080`. Repite con el otro móvil.

Comprueba en cada móvil: «Añadir a pantalla de inicio», modo avión, abrir: debe cargar igual.

## 2. Preparación

- Apunta modelo y año de cada móvil, y navegador con versión.
- Volumen del emisor al 80-90 % (al 100 % muchos altavoces distorsionan).
- Móviles **quietos sobre la mesa** (el perfil de archivos no tolera que se muevan mientras suena).
- Sala: apunta si es pequeña, mediana o grande y si hay eco.

## 3. Qué medir

Repite cada prueba 5 veces y apunta aciertos y tiempo (de Sonar a que aparece en el receptor).

| # | prueba | distancias | qué apuntar |
|---|---|---|---|
| 1 | Texto de 140 caracteres (normal) | 20 cm, 1 m, 2 m, 4 m | ¿llega idéntico? segundos |
| 2 | Foto (la app la reduce a ~14 KB) | 20 cm, 1 m, 2 m | ¿llega? segundos; ¿cuántas vueltas del carrusel? |
| 3 | Difusión: la foto a 2-3 receptores a la vez, cada uno a distinta distancia | 0,5-2 m | ¿llega a todos? segundos de cada uno |
| 4 | Modo discreto (texto corto) | 20 cm, 1 m | ¿llega? ¿se oye algo? (pregunta a alguien joven) |
| 5 | Modo discreto con los móviles cambiados de papel | 20 cm | ¿qué móvil emite bien y cuál capta bien a 18 kHz? |
| 6 | Ruido: la prueba 1 a 1 m con música o conversación de fondo | 1 m | aciertos |

Útil para afinar: en el receptor, el espectrograma enseña si llega algo (franja de 1-8 kHz en modo normal; raya fina arriba del todo en modo discreto). Si en modo discreto no se ve nada arriba, ese par de móviles no llega a 17-20 kHz: no es un fallo del módem.

## 4. Qué esperar según el simulador

- Texto: llega en sala media a 15 dB siempre, y en la rejilla de 5-25 dB con tres salas, ±200 ppm y saturación, 900/900.
- Foto de 10 KB: ~36-40 s en sala pequeña o media; en un aula grande y con eco el perfil de archivos falla a menudo: acerca los móviles.
- Modo discreto: en el simulador funciona incluso a 5 dB; en móviles reales depende del hardware. Si no llega, es lo que avisa la app.

## 5. Si algo falla

- Graba en el receptor (otra app de grabadora) lo que se oye y guárdalo como WAV: `node tools/window-replay.ts grabacion.wav` dice si el módem lo decodifica fuera del navegador, y así se separa un fallo del módem de uno del navegador.
- Foto que no llega con los móviles quietos: probar el perfil OFDM más lento (`N: 8192, rep: 3` en `src/modem/ofdm.ts`), que en simulación también pasa.
- Apunta todo en una tabla y añádela a este fichero: será la primera medida real del proyecto.
