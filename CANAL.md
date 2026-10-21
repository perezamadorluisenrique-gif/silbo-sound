# Simulador de canal acústico (`src/sim`)

Todas las cifras del proyecto se miden contra este modelo, no con móviles reales. Estas son sus suposiciones; `./score` comprueba en R0 que cada efecto hace lo que dice (RT60, DRR, SNR, deriva, saturación, CAG).

Cadena, en este orden (`simulate()` en `src/sim/channel.ts`):

1. **Altavoz** de móvil barato: paso alto Butterworth de 4.º orden a 450 Hz, paso bajo de 4.º orden a 9 kHz, resonancia de +4 dB en 2,5 kHz y valle de −5 dB en 5,5 kHz. Con `saturation`, recorte suave `tanh(3x)` antes del filtro (altavoz forzado).
2. **Sala**: respuesta al impulso sintética (`rooms.ts`): camino directo a 3 ms, 10 reflexiones tempranas en los primeros 25 ms y cola gaussiana con caída exponencial de RT60, ligeramente filtrada (absorción del aire). Se escala a una relación directo/reverberado (DRR):
   - pequeña: RT60 0,3 s, DRR +6 dB;
   - media: RT60 0,6 s, DRR +3 dB (la de R1);
   - aula grande: RT60 1,0 s, DRR 0 dB.
   Referencia: en un salón de 50 m³ con RT60 0,5 s la distancia crítica es ~0,6 m, así que DRR +3 dB equivale a móviles a ~40 cm y 0 dB a ~60 cm. A más distancia el canal real es peor que el simulado.
3. **Deriva de reloj**: remuestreo con sinc enventanada (Blackman, 32 coeficientes) por `1 + ppm·1e-6`.
4. **Ruido** rosa (o blanco) escalado para dar el SNR pedido **en la banda 500-8000 Hz**, medido sobre la parte con señal.
5. **Micrófono**: paso alto 100 Hz, paso bajo 15 kHz.
6. **Preamplificador y conversor**: ganancia que deja el pico en 0,5 (o en 2,5 con `saturation`, es decir, recorte duro) y recorte a ±1.
7. **CAG**: seguidor de RMS por bloques de 10 ms, ataque 50 ms, relajación 500 ms, objetivo −20 dBFS.
8. Cuantización a 16 bits.

## Modelo casi ultrasónico (modo discreto, R5)

`band: 'ultrasonic'` cambia tres eslabones de la cadena; el resto (deriva, saturación, CAG, cuantización) es igual:

- **Altavoz**: paso alto de 450 Hz, paso bajo Butterworth de 4.º orden en 18,5 kHz y valle de −6 dB en 19,5 kHz: los altavoces de móvil caen deprisa por encima de 18 kHz, así que la señal llega inclinada (unos −10 dB de 17,6 a 19,3 kHz). El ecualizador del chirp lo corrige.
- **Sala**: la misma respuesta al impulso, pero **sin el paso bajo de absorción del aire** en la cola. En una sala real los agudos reverberan menos (el aire y las cortinas se los comen), así que dejar la cola con toda su energía en 18 kHz es lo pesimista.
- **Micrófono**: paso bajo de 4.º orden en 20 kHz (`ultraMicHz` permite bajarlo: muchos móviles cortan en 16-18 kHz, y `score` mide qué pasa con cortes en 19, 18 y 17 kHz).
- **SNR** medido en la banda 16,5-20,5 kHz.

Ambiente para falsos positivos (`ultraAmbience()` en `noise.ts`): el ambiente normal más lo que sí llega a 16-20 kHz: llaves y roces (ráfagas de ruido filtrado por encima de 12 kHz), tonos fijos de 16,5-20 kHz como las balizas de algunas teles, tiendas y apps, silbidos que barren la banda y balizas FSK que saltan de tono.

Lo que este modelo **no** sabe: qué emite y qué capta cada móvil concreto en 17-20 kHz (varía muchísimo y es la razón del aviso de la app), la distorsión de un altavoz saturado que hace audibles productos de intermodulación (el recorte `tanh` sí está, pero no un modelo de altavoz real), y que el navegador remuestree a 44,1 kHz con un filtro que corte antes de 20 kHz.

Lo que el simulador **no** modela: movimiento de los móviles (Doppler), ecos que cambian con el tiempo, cancelación de eco o supresión de ruido del navegador (la app debe desactivarlas en `getUserMedia`), micrófonos que filtran por encima de ~16 kHz en algunos móviles.
