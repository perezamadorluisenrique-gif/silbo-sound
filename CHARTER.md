# Sprint 2: mensajes por sonido (el proyecto «primer lugar en un hackathon»)

## Meta

Una app web que pasa un mensaje, una foto o un archivo pequeño de un móvil a otro **solo con sonido**: sin internet, sin Bluetooth, sin cuentas. Un móvil «canta» y el otro escucha.

Tiene que impresionar a alguien no técnico con una frase, como «le pasé un libro a toda la clase con el altavoz del móvil». Y tiene que sostenerse ante un jurado técnico: módem propio, corrección de errores y medidas honestas.

Contexto que le da sentido: en sitios con internet caro o intermitente, compartir sin red importa.

- Nombre provisional: elígelo tú, corto y en español, y explica la elección en `NEXT.md`.
- Todo funciona sin conexión una vez cargado (service worker) y en un móvil barato.

## Reglas

- **El módem es propio.** Escríbelo desde cero en TypeScript (o en WebAssembly generado desde TS): modulación, sincronización y corrección de errores.
  - Puedes leer artículos y especificaciones.
  - No copies código de ggwave, quiet.js, minimodem ni similares.
  - Para la interfaz se pueden usar dependencias.
- **Primero se mide.** Antes de optimizar nada, `score` necesita un **simulador de canal acústico**:
  - banda limitada al altavoz y el micrófono de un móvil;
  - ruido a varios SNR;
  - reverberación con respuestas al impulso sintéticas de salas;
  - deriva de reloj de ±200 ppm entre emisor y receptor;
  - saturación y control automático de ganancia.
  - Todas las cifras se dan contra este simulador y se dice así. Las pruebas reales las hará Enrique con dos móviles.
- **Prueba de punta a punta en un navegador real.** Chromium acepta audio falso como micrófono:
  - `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`.
  - Genera el WAV con el emisor, pásalo por el simulador y dáselo a la app receptora en Playwright.

## Escalera (la confirma `score`)

- **R0:** `score` y el simulador de canal funcionan, con un módem trivial de referencia medido (por ejemplo, FSK lento).
- **R1 (texto):**
  - un mensaje de 140 caracteres llega íntegro (comprobado con hash) en al menos el 99 % de 200 transmisiones simuladas a SNR 15 dB con reverberación media;
  - se miden la tasa útil en bit/s y el tiempo por mensaje.
- **R2 (robustez):**
  - éxito de al menos el 95 % en una rejilla de condiciones: SNR 5-25 dB, tres salas, ±200 ppm, saturación;
  - detección del inicio sin falsos positivos en 10 min de ruido ambiente simulado.
- **R3 (archivos):** una foto JPEG de unos 10 KB llega íntegra en 60 s como mucho a SNR 15 dB (con trozos y reintento de los que fallen, si hace falta).
- **R4 (app):**
  - PWA sin conexión con dos botones grandes, Enviar y Recibir, y una visualización que se entienda: forma de onda o espectrograma y barra de progreso;
  - la prueba Playwright de punta a punta pasa con texto y con foto;
  - funciona en Chromium con viewport de móvil;
  - axe-core sin infracciones `serious`.
- **R5 (efecto wow):**
  - **modo difusión:** un emisor y varios receptores a la vez, probado con N receptores simulados;
  - **modo discreto** cerca de los ultrasonidos (unos 17-20 kHz), medido con su propio modelo de canal, con un aviso honesto si en muchos móviles no llega.
- **R6 (presentación):**
  - `DEMO.md`: guion de 60 segundos para un escenario;
  - una página de inicio que lo explica para no técnicos en español, con resumen en inglés;
  - `PRUEBA-CON-MOVILES.md`: cómo lo prueba Enrique con dos móviles y qué medir;
  - una tabla de resultados honesta: qué está medido en simulación y qué no.
- **R7 (extra):** enviar por sonido un capítulo del libro de Python del primer reto, como demostración (lo tienes en `reto/libro-python`, solo lectura).

## Consejos

- La forma más segura de empezar es una modulación robusta y lenta que siempre funciona, para tener un R1 seguro. Después, una más rápida (por ejemplo, OFDM con piloto y ecualización) que se elige sola según la calidad del canal.
- Para la corrección de errores, Reed-Solomon o un código convolucional con Viterbi, más entrelazado.
- Cada mejora se mide en la rejilla del simulador antes de quedarse.
