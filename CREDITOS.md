# Créditos y licencias

Todo el código del módem, la corrección de errores y el simulador está escrito desde cero en este repositorio. No se ha copiado código de ggwave, quiet.js, minimodem ni similares.

Fórmulas y referencias usadas (conocimiento publicado, no código):

- Filtros biquad: fórmulas del «Audio EQ Cookbook» de Robert Bristow-Johnson.
- Ruido rosa: coeficientes del filtro de 3 polos y 3 ceros de Julius O. Smith III («Spectral Audio Signal Processing», CCRMA).
- Reed-Solomon: decodificación de errores y borrados con Berlekamp-Massey (forma de Blahut), búsqueda de Chien y fórmula de Forney, según R. E. Blahut, «Algebraic Codes for Data Transmission».
- Código convolucional de tasa 1/2 y longitud de restricción 7 con generadores 171 y 133 (octal), el par clásico de la NASA y de IEEE 802.11; decodificador de Viterbi con decisión suave escrito a partir de su definición de libro de texto.
- OFDM con prefijo cíclico y DQPSK diferencial en el tiempo; fases de Schroeder (M. R. Schroeder, 1970) para bajar el factor de cresta del símbolo de referencia; estimación del deslizamiento de reloj con la cuarta potencia (elimina la modulación QPSK), idea clásica de sincronización.
- CRC-32 (IEEE 802.3) y CRC-8 (polinomio 0x07): definiciones estándar.

Dependencias de desarrollo: TypeScript (Apache-2.0), @types/node (MIT), esbuild (MIT; empaqueta la app), playwright-core (Apache-2.0; maneja Chromium en la prueba de punta a punta), axe-core (MPL-2.0; comprobación de accesibilidad en la prueba, no se incluye en la app). La app publicada (`dist/`) no lleva código de terceros: solo el módem y la interfaz de este repositorio.

App: el `AudioWorklet` de captura, el service worker y el espectrograma están escritos aquí con las API estándar del navegador (Web Audio, Service Worker, Canvas).

Recursos: `assets/foto.jpg` es una imagen sintética (puesta de sol) generada por `tools/gen/foto.py` con NumPy y Pillow; no tiene derechos de terceros.

`assets/capitulo-09-listas.md` (R7) es el capítulo 9, «Listas», del libro del primer reto (rama `reto/libro-python`, commit 383ad78, copiado sin cambios). Ese libro es una traducción y adaptación al español de *Introduction to Python Programming* (OpenStax, 2024), de Udayan Das, Aubrey Lawson, Chris Mayfield y Narges Norouzi, con licencia **CC BY-NC-SA 4.0** (https://creativecommons.org/licenses/by-nc-sa/4.0/); la traducción tiene la misma licencia y no está avalada por OpenStax. Aquí se usa solo como demostración, sin fines comerciales y con la misma licencia.

Compresión (R7): `CompressionStream('deflate-raw')` del navegador (API estándar) y `zlib` de Node en la medida; formato DEFLATE (RFC 1951). No forma parte del módem.
