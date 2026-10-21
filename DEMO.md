# Silbo: guion de la demo (60 segundos)

Material: tres móviles con Silbo abierto (cargado una vez; después funciona sin conexión), en modo avión para que se vea que no hay red. Uno es el emisor; dos, receptores. Todos quietos sobre la mesa, a menos de un metro. Volumen del emisor alto, pero no al máximo.

| tiempo | qué se hace | qué se dice |
|---|---|---|
| 0-8 s | Se enseñan los tres móviles en modo avión. | «Sin internet, sin Bluetooth, sin cuentas. Solo el altavoz y el micrófono.» |
| 8-18 s | Receptores: **Recibir**. Emisor: escribe «Hola, jurado» y **Sonar**. Suena unos 4 s; el texto aparece en los dos receptores. | «Un móvil canta y el otro escucha. Como el silbo gomero, que llevaba mensajes de un valle a otro.» |
| 18-45 s | Emisor: elige la foto y **Sonar** (suena en bucle). Los receptores llenan la barra de progreso; la foto aparece en los dos a la vez, en unos 40 s. Mientras, se señala el espectrograma. | «Una foto de 10 KB, a todos los móviles de la sala a la vez: el emisor la repite en carrusel, y cada receptor coge lo que le falte en la vuelta siguiente. Da igual cuántos escuchen o cuándo lleguen.» |
| 45-55 s | Emisor: marca **Modo discreto**, escribe «¿Me oís?» y **Sonar**. Casi no se oye nada; el texto aparece. | «Y si no quieres molestar: casi ultrasonido, entre 17 y 20 kHz. Ojo: no todos los móviles llegan ahí; la app lo avisa.» |
| 55-60 s | Se enseña la frase final en pantalla. | «En sitios donde los datos son caros o no hay red, compartir no debería necesitarla.» |

## Si algo falla en directo

- El texto no llega: acercar los móviles (10-30 cm) y repetir. El perfil de texto aguanta salas muy reverberantes.
- La foto tarda: es normal que tarde una vuelta más (~36 s) si un trozo se perdió. No mover los móviles mientras suena: el perfil de archivos supone móviles quietos.
- El modo discreto no llega: es el aviso honesto en acción; decir «este móvil no llega a 18 kHz» y seguir sin él.

## Para el jurado técnico (una frase por pregunta)

- **¿Módem propio?** Sí: MFSK con saltos de frecuencia, OFDM con DQPSK diferencial, Reed-Solomon con borrados, código convolucional con Viterbi suave, chirps para sincronizar y medir la deriva de reloj, todo escrito desde cero en TypeScript.
- **¿Cómo sabéis que funciona?** Con un simulador de canal acústico (altavoz y micrófono de móvil, salas sintéticas, ruido, ±200 ppm de deriva, saturación, control de ganancia) y una prueba de punta a punta en Chromium real. Las cifras están en `SCORE.txt` y dicen siempre que son de simulación.
- **¿Y con móviles de verdad?** Eso está por medir: `PRUEBA-CON-MOVILES.md` dice cómo.
