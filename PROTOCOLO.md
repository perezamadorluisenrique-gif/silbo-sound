# Protocolo común del sprint 2

Enrique lanzó el segundo sprint (tres proyectos autónomos) la tarde del 2026-10-20, hora de Cuba, tras un primer reto en el que los cuatro proyectos cerraron en su último peldaño. Corren solos en sesiones en la nube y él revisa los resultados al final: nadie va a contestar preguntas, así que decide tú con el criterio de `CHARTER.md` y deja escrito por qué.

Cada proyecto vive en una rama huérfana del repo **privado** `perezamadorluisenrique-gif/Prototipes`: `reto2/publicar`, `reto2/sonido`, `reto2/interpretabilidad`. Nada sale de esa rama (las ramas `reto/*` del primer reto se pueden leer, nunca escribir).

## Calendario

- **Cierre: 2026-10-22T00:00Z** (miércoles 21 a las 20:00 en Cuba). Después solo se escribe `RESULTADOS.md` y se pone `status: done`.
- Si al empezar faltan menos de 60 min para el cierre, dedica la sesión al cierre.

## Al empezar una sesión (en este orden)

1. Lee `STATE.md`. Si `status: done`, termina sin hacer nada más. Si `status: running` y `updated` tiene menos de 60 min, otra sesión está trabajando: termina sin tocar nada.
2. Toma el relevo: `status: running`, `updated: <ahora en UTC>` (siempre con `date -u +%Y-%m-%dT%H:%M:%SZ`; la tarea lee ese formato) y `session: <id nuevo>` (`head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n'`; recuérdalo). Commit `relevo` y push. Si el push choca, `git pull --rebase` y vuelve al paso 1.
3. Lee `CHARTER.md` y `NEXT.md`. `NEXT.md` es la memoria entre sesiones: no explores lo que ya explica.
4. Prepara el entorno con `./setup.sh` (idempotente; ver «Permisos»). Si aún no existe, créalo en esta sesión y mantenlo al día: la siguiente no debe redescubrir nada.

## Mientras trabajas

- Commit y push al menos cada 30 min, con `updated:` de `STATE.md` al día, también durante cálculos largos (despiértate con Monitor cada 25 min como mucho y toca `STATE.md`). Si la sesión se corta por el límite de uso, se pierde como mucho media hora.
- **No termines tu turno mientras corre algo** (un cálculo en segundo plano o un subagente): espera con Monitor y toca `STATE.md` en cada despertar. Si terminas el turno, la sesión puede cerrarse y el contenedor reciclarse con el trabajo dentro.
- Subagentes en segundo plano, o con encargos de 30 min como mucho, para que puedas tocar `STATE.md` entre medias. Cálculos de más de 2 h: trocéalos con puntos de control en disco y sube los resultados parciales.
- **Si te han relevado, para.** Antes de cada push haz `git pull --rebase`; si el `session:` del `STATE.md` remoto ya no es el tuyo, otra sesión te dio por muerta y tomó el relevo: deja integrados tus cambios si no chocan, añade una nota a `NEXT.md` y termina sin tocar `STATE.md`.
- La puntuación la da el script `score` del proyecto, nunca tu impresión. `rung:` en `STATE.md` solo sube con lo que el script confirma. Guarda la última salida de `score` en `SCORE.txt` (con su fecha) en cada commit de progreso: las auditorías la leen sin tener que preparar el entorno.
- Documentación e informes en español; el código y sus comentarios pueden ir en inglés.

## Ahorro de tokens

Enrique: "mucho margen no quiere decir abundancia extrema".

- Tú diseñas, depuras y revisas. El trabajo en volumen (traducir capítulos, generar ejercicios, escribir pruebas, código repetitivo) va a subagentes con `model: "sonnet"`: encargo autocontenido, que escriban en ficheros y respondan en 15 líneas como mucho.
- Nunca vuelques salidas largas a la conversación: redirige a ficheros y mira `tail`, `grep` o un resumen.
- Cálculos largos: `run_in_background` y Monitor; nada de consultar cada pocos segundos.
- Evita instalar lo pesado si hay alternativa ligera; todo lo que prepara el entorno va en `setup.sh`.
- Si dos sesiones seguidas no suben la puntuación, para: anota el bloqueo en `NEXT.md` y cambia de enfoque o baja la ambición del peldaño. Nada de fuerza bruta.
- **Cortacircuitos:** si tres sesiones seguidas no suben la puntuación (míralo en `PROGRESS.md`), cierra el proyecto como bloqueado: `RESULTADOS.md` con lo logrado y por qué se paró, y `status: done`.
- Sin pulir de más: alcanzado el último peldaño, o si lo que queda no compensa, cierra con `RESULTADOS.md` y `status: done`.

## Compactación (límites fijos, por comportamiento)

Los ajustes de Claude no se pueden cambiar desde estas sesiones (el entorno lo bloquea), así que los límites los cumples tú:

- Relevo tras uno o dos peldaños, unas 3 h o unas 150 llamadas a herramientas, lo que llegue antes.
- **Como mucho una compactación por sesión.** Si la conversación ya se compactó, termina el paso en curso y haz el relevo: `NEXT.md` es mejor memoria que un resumen automático.
- Nunca te quedes parado: una sesión inactiva no avanza y, si se compacta por inactividad, gasta para nada.

## Al terminar una sesión

Termina tras uno o dos peldaños, unas 3 h de trabajo o unas 150 llamadas a herramientas, lo que llegue antes (una sesión fresca razona mejor que una conversación enorme):

1. Reescribe `NEXT.md`: dónde está cada cosa, cómo preparar el entorno, qué sigue y qué no funcionó.
2. Añade una línea a `PROGRESS.md`: `- <UTC> | peldaño X→Y | qué se hizo | qué falló`.
3. `STATE.md`: `status: handoff` (o `done`) y `updated: <ahora>`. Commit y push.
4. No hace falta relanzar nada: la tarea del proyecto arranca sola cada hora y la siguiente sesión toma el relevo al ver `handoff`.

La tarea de cada proyecto arranca sola cada hora (publicar :07, sonido :27, interpretabilidad :47). Si encuentra `running` con `updated` de hace menos de 60 min, o `done`, termina enseguida sin gastar; si no, toma el relevo. Por eso una sesión cortada por el límite de uso se retoma como mucho una hora después de que el límite se reinicie.

## Permisos: nada que pida aprobación

Nadie está mirando: una acción que pide aprobación deja la sesión parada y le manda una notificación a Enrique. **No hagas nada de esta lista**, ni para probar:

- **Tocar la configuración de Claude**: nada dentro de `~/.claude/` (settings, hooks, permisos, memoria) ni variables o ficheros que cambien cómo funciona la sesión.
- **Ejecutar código descargado de una vez**: `setup.sh` solo contiene comandos corrientes (`npm ci`, `pip install`, `git clone`, compilar lo propio) y nunca ejecuta scripts o binarios recién bajados. Si el entorno bloquea `./setup.sh`, `./score` u otro script del repo («código externo»), ejecuta sus líneas una a una; si no se puede correr `score`, anótalo y deja que lo corra la siguiente sesión.
- **WebFetch a una URL que no salió antes en un WebSearch de esta sesión** (pide aprobación). Primero WebSearch (con `allowed_domains` si hace falta) y luego WebFetch de una URL del resultado. Para GitHub, `git clone` o `gh api`.
- **Comandos compuestos que editan y suben a la vez** (p. ej. `sed` sobre `STATE.md` + commit + push en una línea): se deniegan. Edita con Write/Edit y luego `git add/commit/push` en otra llamada.
- **Cambiar `score` para que pase algo que fallaba.** Puedes ampliarlo para medir un peldaño nuevo; si crees que una comprobación está mal, anótalo en `NEXT.md` y sigue con otra cosa.
- `add_repo`, crear o disparar tareas programadas, enviar mensajes o notificaciones, o escribir fuera de tu carpeta del proyecto, `/tmp` y la caché de paquetes.

Si aun así algo se deniega o pide aprobación: **no lo repitas ni esperes**. Anótalo en `NEXT.md` (sección «Bloqueos») y sigue por otro camino.

## Límites

- Todo se queda en la rama del proyecto: no abras PRs, no escribas en otros repos ni ramas, no publiques nada (ni en la web, ni en la OEIS, ni en redes, ni crees repos públicos). Lo que haya que enviar fuera se deja preparado para que lo envíe Enrique.
- Ficheros de más de 50 MB fuera de git (`.gitignore`); lo que se puede regenerar no se sube.
- Respeta las licencias: atribución y licencia de todo lo reutilizado, en `CREDITOS.md`.
- La red de la sesión solo llega a GitHub y a los registros de paquetes (npm, PyPI, crates). Para leer otras webs usa WebFetch o WebSearch.

## RESULTADOS.md (al cierre)

Qué se logró según `score`; cómo verlo o reproducirlo (comandos exactos); qué no se logró y por qué; y qué tiene que hacer Enrique, si algo.
