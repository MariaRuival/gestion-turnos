# Decisiones de diseno

Este documento explica como esta organizado el codigo y, sobre todo, **donde vive
cada una de las 5 reglas de negocio pedidas**, para poder explicarlo despues sin
tener que releer todo el proyecto.

## Organizacion general

backend/src/
├── server.js arranca el proceso, valida env vars obligatorias
├── app.js arma la app de Express (middlewares, rutas, error handler)
├── config/db.js pool de conexion a Postgres (lee TODO de variables de entorno)
├── db/
│ ├── schema.sql tablas, constraints, la regla de no-solapamiento a nivel DB
│ └── seed.js usuarios y servicios de demo
├── models/ una funcion por consulta SQL, sin logica de negocio
│ ├── usuarioModel.js
│ ├── servicioModel.js
│ └── turnoModel.js incluye la transaccion de creacion de turno
├── controllers/ reciben el request, aplican las reglas de negocio,
│ ├── authController.js llaman al model, devuelven la respuesta
│ ├── servicioController.js
│ └── turnoController.js <- ES EL ARCHIVO MAS IMPORTANTE DEL BACKEND
├── middleware/
│ ├── auth.js valida el JWT y el rol (cliente/admin)
│ └── errorHandler.js unico lugar que formatea errores como JSON
├── routes/ mapeo URL -> controller, con los middlewares de permisos
└── utils/turnoRules.js <- funciones PURAS de negocio (sin DB, sin Express)

frontend/src/
├── pages/ Login.jsx, ClienteView.jsx, AdminView.jsx (las 3 pantallas)
├── components/ piezas reutilizables (tarjeta de turno, checklist de servicios)
├── context/AuthContext.jsx guarda el usuario/token logueado (localStorage)
└── api/client.js unico lugar que hace fetch() a la API


**Idea central:** el frontend no decide nada de negocio, solo muestra datos y
deshabilita botones "por las dudas" (mejor UX). La autoridad final sobre las
5 reglas es siempre el backend — si alguien pega directo a la API con curl o
Postman salteando la UI, las reglas se siguen cumpliendo igual.

---

## Donde vive cada regla de negocio

### 1. No se puede crear un turno que se solape con otro existente

Implementada en **dos capas**, a proposito:

- **Capa de aplicacion** (chequeo "amigable"): [`backend/src/models/turnoModel.js`](backend/src/models/turnoModel.js)
  función `buscarSolapados()`, usada desde [`backend/src/controllers/turnoController.js`](backend/src/controllers/turnoController.js)
  función `crear()`. Usa el operador `OVERLAPS` de Postgres sobre
  `(fecha_hora_inicio, fecha_hora_fin)` contra los turnos en estado `pendiente`
  o `confirmado` (los `cancelado`/`completado` no cuentan). Si hay solapamiento,
  responde `409` con un mensaje claro.

- **Capa de base de datos** (garantia definitiva): [`backend/src/db/schema.sql`](backend/src/db/schema.sql),
  constraint `no_solapamiento_turnos` en la tabla `turnos`:
```sql
  CONSTRAINT no_solapamiento_turnos EXCLUDE USING gist (
      tstzrange(fecha_hora_inicio, fecha_hora_fin, '[)') WITH &&
  ) WHERE (estado IN ('pendiente', 'confirmado'))
```
  Por que dos capas: el chequeo de la app puede fallar ante una condicion de
  carrera (dos requests simultaneos que pasan el chequeo al mismo tiempo).
  La constraint de Postgres es atomica y a prueba de eso — si igual se cuela un
  insert simultaneo, Postgres lo rechaza con el error `23P01`, que
  `turnoModel.crear()` atrapa y traduce al mismo mensaje de error 409 (ver el
  `catch` con `err.code === '23P01'`).

### 2. El costo/duracion total se calcula sumando los servicios elegidos

- Funcion pura `calcularTotales()` en [`backend/src/utils/turnoRules.js`](backend/src/utils/turnoRules.js).
- Se usa en `turnoController.crear()`: el cliente manda solo `servicioIds`
  (nunca precio ni duracion). El backend vuelve a leer esos servicios de la
  base ([`servicioModel.buscarPorIds()`](backend/src/models/servicioModel.js)) y calcula
  `duracionTotalMinutos` / `precioTotal` el mismo — nunca confia en numeros
  que pudiera mandar el cliente. Con la duracion total calcula tambien
  `fecha_hora_fin`, que es lo que despues se usa para el chequeo de solapamiento (regla 1).

### 3. Estados del turno y transiciones permitidas

- Maquina de estados explicita en [`backend/src/utils/turnoRules.js`](backend/src/utils/turnoRules.js):
```js
  const TRANSICIONES_VALIDAS = {
    pendiente:  ['confirmado', 'cancelado'],
    confirmado: ['completado', 'cancelado'],
    completado: [],
    cancelado: [],
  };
```
  `esTransicionValida(actual, nuevo)` es la unica funcion que decide si un
  cambio de estado esta permitido. Se usa en `turnoController.cambiarEstado()`
  (funcion interna compartida por `confirmar`, `completar` y `cancelar`), que
  responde `409` si la transicion no esta en el mapa. Como el mapa no tiene
  ninguna entrada que vuelva a `pendiente` ni que salga de `completado`/`cancelado`,
  esos casos quedan bloqueados por construccion (no hace falta if-elses sueltos
  a mantener).
- En las rutas ([`backend/src/routes/turnoRoutes.js`](backend/src/routes/turnoRoutes.js)) tambien se
  restringe *quien* puede pedir cada transicion: `confirmar` y `completar` son
  solo admin; `cancelar` lo puede pedir el cliente dueno del turno o el admin.

### 4. No se puede cancelar con menos de 24hs de anticipacion

- Funcion pura `puedeCancelarPorTiempo(fechaHoraInicio)` en
  [`backend/src/utils/turnoRules.js`](backend/src/utils/turnoRules.js) — compara la fecha del
  turno contra `ahora` y devuelve `false` si faltan menos de
  `HORAS_MINIMAS_PARA_CANCELAR` (24) horas.
- Se aplica en `turnoController.cambiarEstado()` **solo** cuando `estadoNuevo === 'cancelado'`,
  antes de tocar la base. Si no se cumple, responde `409`.
- El frontend replica el mismo calculo en
  [`frontend/src/pages/ClienteView.jsx`](frontend/src/pages/ClienteView.jsx) (`faltanMenosDe24hs`)
  solo para deshabilitar el boton "Cancelar" de forma amigable — es una
  copia de UX, no la fuente de verdad; si se saltea el boton (ej. con curl),
  el backend igual lo rechaza.

### 5. Un cliente solo ve y cancela sus propios turnos

- **Ver:** el endpoint `GET /api/turnos/mios` ([`turnoController.listarMios`](backend/src/controllers/turnoController.js))
  llama a `turnoModel.listarPorUsuario(req.usuario.id)`, que filtra por
  `usuario_id` en el SQL — el cliente ni siquiera puede pedir turnos de otro
  usuario porque el id sale del JWT (`req.usuario.id`), no de un parametro que
  el cliente pueda manipular. El endpoint que trae *todos* los turnos
  (`GET /api/turnos`) esta protegido con `requiereRol('admin')` en
  [`backend/src/routes/turnoRoutes.js`](backend/src/routes/turnoRoutes.js).
- **Cancelar:** `turnoController.obtenerTurnoAutorizado()` carga el turno y, si
  quien pide la accion es un `cliente` y `turno.usuarioId !== req.usuario.id`,
  corta con `403` antes de llegar a la maquina de estados. Un admin no tiene
  esa restriccion (puede operar sobre cualquier turno).
- El JWT (`backend/src/middleware/auth.js`) es lo que garantiza que `req.usuario.id`
  y `req.usuario.rol` sean confiables: se firman en el login
  ([`authController.login`](backend/src/controllers/authController.js)) y se verifican en cada
  request a `/api/turnos/*`.

---

## Por que estas decisiones tecnicas

- **`pg` directo (sin ORM)**: el modelo de datos es chico (4 tablas) y las
  consultas son simples; un ORM hubiera agregado una capa de abstraccion sin
  aportar mucho, y hubiera complicado escribir la constraint `EXCLUDE` (regla 1)
  a mano en el schema.
- **JWT + bcryptjs, sin proveedores externos**: cumple el pedido de "login
  simple usuario/contrasena" sin sumar dependencias. `bcryptjs` (implementacion
  en JS puro) se eligio en vez de `bcrypt` para no depender de compilacion
  nativa, algo que simplifica el Dockerfile.
- **Todo el calculo de negocio en el backend**: el frontend solo replica los
  calculos donde mejora la experiencia (mostrar el total antes de reservar,
  deshabilitar un boton), pero nunca es la fuente de verdad — noten que todas
  las validaciones fuertes estan del lado de `turnoController.js` /
  `turnoRules.js` / `schema.sql`.
- **`utils/turnoRules.js` separado de los controllers**: agrupa las reglas 2, 3
  y 4 como funciones puras (sin `req`/`res`, sin SQL) para poder leerlas o
  testearlas de forma aislada, sin tener que levantar un servidor HTTP.

---

## TP1 — Git colaborativo

> El ejercicio de conflicto de Git de este TP se reprodujo directamente en este repositorio
> (PR #5, rama `feature/titulo-b` → `main`), para que la defensa se navegue sobre un único
> repo. El trabajo original del TP1 también existe en
> [`ingsoft3-tp01`](https://github.com/MariaRuival/ingsoft3-tp01), usado antes de consolidar
> todo acá siguiendo la guía del TP2 (§3.3).

### 1. Por qué Git no pudo resolver el conflicto solo

Git fusiona automáticamente cuando dos ramas modifican partes distintas de un archivo.
En este caso, tanto la rama `feature/titulo-a` como `feature/titulo-b` modificaron
la **misma línea** (el título del README), cada una con un contenido distinto
("versión A" vs "versión B"). Git no tiene forma de saber cuál de las dos versiones
es la correcta — no es una decisión técnica, es una decisión de contenido — así que
me delegó la resolución a mí marcando el archivo con los marcadores de conflicto.

Para que este conflicto nunca hubiera aparecido, la rama B debería haberse creado
**después** de mergear la rama A (partiendo de un `main` ya actualizado), o directamente
no debería haber tocado esa misma línea. En este caso el conflicto fue intencional:
lo fabriqué a propósito haciendo que ambas ramas salieran de `main` sin conocer los
cambios de la otra, tal como pide la guía del TP.

### 2. Qué problemas encontré y cómo los solucioné

- Al crear el `.gitignore` por primera vez con `cat > .gitignore << 'EOF' ... EOF`,
  el heredoc no se ejecutó bien al pegarlo en la terminal (probablemente se cortó
  al copiar/pegar) y el archivo no se creó. Lo resolví usando `nano .gitignore`
  en su lugar, que es más robusto para pegar contenido multilínea.
- Después de mergear el PR de la rama `feature/titulo-a`, me olvidé de borrar esa
  rama (sí borré `feature/titulo-b`). Quedó visible en Settings → Branches, y la
  borré manualmente desde ahí una vez que lo noté.
- El tag `v1.0.0` original se preparó como borrador de release en `ingsoft3-tp01`
  pero nunca se publicó — quedó solo la captura del borrador en `evidencias.md`.
  Se corrigió publicando el tag y la release correspondiente acá, en `gestion-turnos`
  (ver `evidencias.md`).
- Al resolver el conflicto real (recreado en este repo), la primera edición con
  `nano` dejó el título con contenido mezclado de las dos ramas en vez de reemplazarlo
  limpio. Se corrigió resolviendo el conflicto desde el editor web de GitHub,
  dejando una sola línea de título sin marcadores.

### 3. Declaración de uso de IA (TP1)

Usé Claude para que me guíe paso a paso durante todo el TP1: explicarme qué pedía
cada tarea de la guía, indicarme en qué pantalla de GitHub hacer cada configuración
(protección de rama, PRs, resolución del conflicto, tag y release), y ayudarme a
redactar este mismo archivo de decisiones. No generó código ni resolvió nada en mi
lugar dentro del repositorio: cada click, cada comando de terminal y cada decisión
de contenido (por ejemplo, qué versión del título dejar al resolver el conflicto)
los hice yo, verificando en cada paso que el resultado en GitHub fuera el esperado
antes de seguir.

---

## TP2 — Contenedores

### Por qué esta app (los 4 criterios de la guía)

- **¿Buildea y corre local sin magia?** Sí — probado desde antes del TP2 con `npm install` +
  Postgres en un contenedor suelto, sin pasos ocultos.
- **¿Tiene o se le pueden agregar tests?** Sí — 5 reglas de negocio bien delimitadas
  (no-solapamiento, cálculo de totales, máquina de estados, ventana de 24hs, aislamiento por
  usuario), cada una en una función separada en `turnoRules.js`, lo que las hace fáciles de
  testear de forma aislada en el TP5.
- **¿La entiendo lo suficiente para modificarla?** Sí — la escribí guiando a la IA paso a paso
  (no la generé de un tirón), y puedo explicar y modificar en vivo cualquiera de las 5 reglas.
- **Tamaño:** 3 pantallas (Login, Cliente, Admin), sin dependencias exóticas más que Postgres.
  No crece más de lo necesario para cumplir el objetivo del semestre.

### Imágenes base elegidas

| Servicio | Etapa de build | Etapa final | Por qué |
|---|---|---|---|
| Backend | `node:20-alpine` | `node:20-alpine` | Sin paso de compilación (JS plano, sin TypeScript ni bundler), así que build y runtime comparten la misma base. Alpine para minimizar superficie de imagen. |
| Frontend | `node:20-alpine` (con Vite) | `nginx:1.27-alpine` | El build genera archivos estáticos (`dist/`); servirlos con nginx evita cargar el runtime de Node en producción. |

### Estructura multi-stage: qué se descarta y qué queda

**Backend** — dos etapas (`deps` y `final`), ambas sobre `node:20-alpine`:
- `deps`: instala solo dependencias de producción (`npm install --omit=dev`).
- `final`: copia `node_modules` ya resuelto + código fuente, sin caché de npm ni artefactos de instalación.
- Tamaños: `node:20-alpine` base = **194MB** → imagen final `mi-backend:v0.1.0` = **202MB** (+8MB de `node_modules` y código propio).
- La ganancia de este multi-stage es menor que en lenguajes compilados (no hay un SDK pesado que descartar, como pasaría con el `dotnet/sdk` del ejemplo de la cátedra), pero igual se aplicó el principio por dos motivos: separa una capa cacheable (dependencias) del código que cambia seguido, y deja la estructura lista si en el futuro se suma un paso de build (TypeScript, bundling) sin tener que rediseñar el Dockerfile.

**Frontend** — dos etapas con bases distintas (`build` y `nginx`):
- `build`: instala *todas* las dependencias (incluidas devDependencies, como Vite) y corre `npm run build`.
- Etapa final: parte de `nginx:1.27-alpine` (**75.9MB** base) y copia únicamente `dist/` (el HTML/CSS/JS ya compilado).
- Acá el multi-stage sí es determinante: la etapa de build carga Vite, el compilador de React y todo `node_modules` de desarrollo — nada de eso viaja a producción. La imagen final (`mi-frontend:v0.1.0` = **76.2MB**) es prácticamente solo `nginx:1.27-alpine` + un puñado de archivos estáticos (+0.3MB).

### Qué persiste y qué no

- El volumen nombrado `pgdata` (declarado en `docker-compose.yml`) es lo único con estado real: sobrevive a `docker compose down` y solo se borra con `docker compose down -v`. Probado explícitamente (ver `evidencias.md`).
- Backend y frontend son completamente stateless — cualquier dato que "recuerden" en memoria se pierde al recrear el contenedor, por diseño: toda la persistencia vive en Postgres.
- El schema (`backend/src/db/schema.sql`) se monta como bind mount de solo lectura en `docker-entrypoint-initdb.d`, así que solo se aplica la primera vez que se crea el volumen — si se cambia el schema después, hay que recrear el volumen (`down -v`) para que tome efecto.

### Cómo se encuentran los servicios

Los tres contenedores (`postgres`, `backend`, `frontend`) están en la red interna que crea
`docker compose` automáticamente, donde cada uno es alcanzable por su **nombre de servicio**
vía el DNS embebido de Docker. El backend nunca usa `localhost` ni una IP para llegar a la
base: usa `PGHOST=postgres` (el nombre del servicio en el `docker-compose.yml`), y Docker
resuelve ese nombre a la IP interna correcta sin que yo tenga que saberla ni que sea estable
entre reinicios. El frontend es la excepción de siempre (§2.6 de la guía): al ser una SPA, su
JavaScript corre en el **browser del usuario**, fuera de la red de compose — por eso no puede
usar `http://backend:4000` y en su lugar usa la URL absoluta publicada en el host
(`http://localhost:4000`, ver la decisión de abajo).

### Healthcheck vs depends_on

`depends_on` por sí solo (lo que usa `frontend` hacia `backend`) solo garantiza el **orden de
arranque**: que el contenedor de Postgres haya arrancado, no que ya acepte conexiones. Por eso
`backend` usa `depends_on: postgres: condition: service_healthy` en vez de un `depends_on`
simple: el `healthcheck` de Postgres (`pg_isready`) confirma que la base está *lista para
recibir queries*, y recién ahí Docker arranca el backend. Sin esto, el backend podría
arrancar antes de que Postgres esté aceptando conexiones y morir en el primer intento de
conectarse — un problema típico que "a veces pasa y a veces no", según qué tan rápido levante
cada contenedor esa vez.

### Decisión: URL absoluta en el frontend (no proxy de nginx)

El frontend usa `VITE_API_URL=http://localhost:4000/api`, resuelto en tiempo de build de Vite (opción "URL absoluta + CORS", no la de proxy con ruta relativa). Esto significa:
- El backend necesita `CORS_ORIGIN` habilitado para el origen del frontend (en este proyecto está en `'*'` para simplificar el desarrollo local; en un entorno real convendría restringirlo al dominio exacto).
- La URL de la API queda "horneada" en el bundle del frontend al momento del build — si cambia el entorno (por ejemplo, en el TP6 con QA/PROD), hay que reconstruir la imagen del frontend con un `VITE_API_URL` distinto, a diferencia del enfoque con proxy de nginx donde la misma imagen serviría para cualquier entorno.
- Se eligió mantener este enfoque (ya estaba así antes del TP2) en vez de migrar a proxy porque ya estaba probado end-to-end y el problema que resuelve el proxy (evitar CORS, misma imagen para todo entorno) no es crítico en esta etapa del semestre.

### Problemas encontrados y cómo se resolvieron

- **Push a ghcr.io fallando con timeout de proxy** (`proxyconnect tcp: dial tcp 192.168.65.1:3128: i/o timeout`): Docker Desktop tenía activada una configuración manual de proxy sin servidor real cargado. Se resolvió desactivando "Manual proxy configuration" en Settings → Resources → Proxies y reiniciando Docker Desktop, para que use la detección automática del sistema.
- **Backend con Dockerfile de una sola etapa**: el proyecto (generado inicialmente con asistencia de IA) traía un Dockerfile funcional pero sin separación build/runtime. Se reescribió a multi-stage (`deps` + `final`) para cumplir el requisito de la cátedra, documentado arriba.

### Uso de IA

El scaffold inicial de la aplicación (backend, frontend, `docker-compose.yml` original de una sola etapa para el backend, `Dockerfile` del frontend ya multi-stage) fue generado con asistencia de Claude Code, verificado manualmente end-to-end antes de este TP (instalación de dependencias, seed, pruebas de API con curl, build del frontend). Para el TP2 específicamente, se usó IA para: identificar que el Dockerfile del backend no era multi-stage y reescribirlo, redactar el `docker-compose.registry.yml`, y guiar el proceso de publicación en ghcr.io (incluyendo el diagnóstico del error de proxy). Todo se ejecutó y verificó a mano, paso a paso, no se copió sin probar.


---

## TP3 — Planificación y trazabilidad

### 1. Duración del sprint y por qué

Elegí **1 semana** de duración para el sprint (campo Iteration del Project). La razón es alinearlo
con el ritmo real de la cursada: los TPs de la materia se entregan semana a semana, así que un
sprint corto me permite detectar rápido si algo no está saliendo bien y ajustar en el siguiente,
en vez de esperar dos o tres semanas para darme cuenta. Con un sprint más largo, un problema de
planificación (por ejemplo, subestimar una tarea) tarda más en hacerse visible.

### 2. Límite de trabajo en progreso y por qué

Configuré el límite en **2** para la columna "In Progress", siguiendo la regla de arranque de la
guía: la cantidad de personas trabajando (yo, una sola) más uno. El "más uno" es la válvula para
cuando algo queda esperando (por ejemplo, una revisión propia antes de mergear) y necesito avanzar
en otra cosa sin quedar bloqueada. Si en la práctica nunca llego a alcanzar el límite, es señal de
que está demasiado alto para mi ritmo real de trabajo individual; si lo alcanzo todo el tiempo y me
frena, lo subiría a 3.

### 3. Diagnóstico de la historia mal escrita

La historia de prueba fue: *"Como desarrollador quiero crear la tabla usuarios para guardar los
datos"*. Está mal escrita porque el "desarrollador" no es un usuario del sistema: es quien
construye el sistema. Una historia de usuario tiene que expresar valor para alguien que **recibe**
el producto (un cliente, un admin), no para quien lo programa. Si le saco el molde "Como... quiero...
para...", lo que queda ("crear la tabla usuarios") es una tarea técnica de infraestructura, no un
incremento de valor observable — es una tarea disfrazada de historia.

Cómo la reescribiría: identificando primero qué usuario real se beneficia de que exista esa tabla.
Por ejemplo: *"Como cliente quiero poder registrarme con mi email y contraseña para poder reservar
turnos"*. Con esa historia sí hay un rol real y un beneficio real, y "crear la tabla usuarios" pasa
a ser una de las tareas técnicas *dentro* de esa historia, no la historia en sí.

### 4. Problemas encontrados y cómo los resolví

- Al crear el issue del bug con `gh issue create --body '...'` directo en la terminal, el texto
  multilínea con comillas cortó el comando a mitad de camino y la terminal quedó esperando el
  cierre de la comilla (prompt `quote>`). Lo resolví con `Ctrl+C` para cancelar, y después usando
  `--body-file` apuntando a un archivo creado con `cat > archivo.md << 'EOF' ... EOF`, que es más
  robusto para contenido largo con saltos de línea.
- Mi versión de `gh` (2.90) no tiene el flag `--add-sub-issue` (existe desde la 2.94), así que la
  vinculación de la jerarquía (épica→historia, historia→tareas) la hice por la web con
  "Add existing issue" en vez de por comando, tal como la guía prevé como alternativa.
- Al buscar el botón para agregar un campo nuevo (el de Iteration/Sprint), me confundí entre la
  vista de tablero (Board) y la vista de tabla (Table): el `+` del board agrega tarjetas nuevas,
  pero el campo custom se crea desde el `+` al final de las columnas en la vista de tabla. Tuve que
  scrollear la tabla hacia la derecha para encontrarlo, porque quedaba fuera de la pantalla visible.

### 5. Declaración de uso de IA

Usé Claude para guiarme paso a paso durante todo el TP3: explicarme la jerarquía épica/historia/
tarea, decirme los comandos exactos de `gh` para crear labels e issues, guiarme en la creación y
configuración del Project (visibilidad pública, campo Iteration, WIP limit) y ayudarme a redactar
este `decisiones.md`. También leyó el enunciado completo del TP3 desde el repo de la cátedra para
asegurarse de que la jerarquía, los criterios de aceptación y el bug reprodujeran exactamente lo
que pide la guía. Yo ejecuté cada comando en mi propia terminal y verifiqué en GitHub, después de
cada paso, que el resultado fuera el esperado (el issue creado, la jerarquía navegable, el sprint
con los items asignados, el PR cerrando la tarea automáticamente) antes de seguir con el siguiente.
El bug que reporté (`#13`, sobre la validación de horarios pasados en el frontend) es real: lo
identifiqué mirando el código de `ClienteView.jsx` con ayuda de Claude, no lo inventé sin
sustento — está pendiente de confirmar si además falta del lado del backend.

---

## TP4 — CI: Pipelines as Code

### Estructura del pipeline: por qué esos jobs y por qué en paralelo

El workflow (`.github/workflows/ci.yml`) tiene dos jobs, `build-backend` y `build-frontend`,
uno por cada Dockerfile del TP2. Van en paralelo (cada uno en su propio runner) porque no
dependen entre sí: construir la imagen del backend no necesita nada de la del frontend, y
viceversa. Correrlos en paralelo en vez de en secuencia reduce el tiempo total del pipeline al
tiempo del más lento de los dos, no a la suma de ambos.

Los triggers son `pull_request` (hacia `main`) y `push` (a `main`). El primero es el que hace
el trabajo real: verifica el cambio propuesto *antes* de que se integre, y es el que alimenta
el gate del PR. El segundo deja una corrida de `main` después de cada merge — es la que lee el
badge del README, y también la que deja el cache disponible para que cualquier PR nuevo lo
aproveche desde su primera corrida (un PR solo ve el cache de su propia rama y el de la rama
base, nunca el de otras ramas).

### Qué cachea el pipeline y qué pasa si desaparece

Se cachean las **capas de la imagen Docker** (`cache-from`/`cache-to: type=gha`), con un
`scope` distinto por job (`backend` / `frontend`) para que no se pisen entre sí — sin ese
scope, ambos jobs comparten el mismo estante de cache y se sobreescriben mutuamente.
Confirmado en la segunda corrida del PR #17: todas las capas del backend (`deps 1/4` a
`final 5/5`) salieron `CACHED`, porque entre la primera y la segunda corrida no cambió nada
del código ni de las dependencias.

Si el cache desaparece (la plataforma lo puede desalojar en cualquier momento, o tiene límite
de tamaño), el pipeline no falla: simplemente reconstruye todo desde cero, más lento. El cache
es una optimización, no una dependencia — si un pipeline *falla* al no tener cache disponible,
eso en realidad significa que tenía una dependencia escondida en él, que es un bug aparte y no
un problema del cache en sí.

### Por qué el pipeline construye con el Dockerfile en vez de compilar por su cuenta

El workflow no tiene ninguna línea de `npm install` ni `npm run build` propia: delega toda la
construcción a los Dockerfiles del TP2 (`docker/build-push-action` con `context: ./backend` /
`./frontend`). La razón es evitar tener **dos definiciones de build** que puedan divergir: si
el pipeline compilara por su cuenta con comandos propios, podría estar verificando una
compilación distinta de la que después efectivamente se empaqueta y se despliega. Con esta
decisión, el pipeline verifica exactamente el mismo artefacto que se publicó a mano en el TP2
y que se va a publicar automáticamente en TPs futuros — no una aproximación paralela.

### Problemas encontrados y cómo los resolví

- Al romper el build a propósito agregando una dependencia inexistente en
  `backend/package.json`, la primera edición dejó una coma de más antes de la llave de cierre
  de `dependencies`, lo que generaba un error `EJSONPARSE` (JSON inválido) en vez del error
  que buscaba. Lo corregí ajustando la posición de la coma, y confirmé el error correcto
  (`npm error 404 Not Found - 'paquete-que-no-existe-xyz123' is not in this registry`) tanto
  en local (`docker build ./backend`) como en el pipeline, antes de abrir el PR de la
  demostración.
- Mi backend (Node/Express) no tiene paso de compilación ni empaquetado, así que romper el
  código (por ejemplo, un `import` a un archivo inexistente) no hubiera roto el build: nadie
  ejecuta el código durante un `docker build`. Por eso, siguiendo la tabla de la guía para
  stacks "que ni compilan ni empaquetan", rompí una **dependencia** en vez del código.
- Mis dos Pull Requests de la demostración (`feature/demo-gate` y `docs/muestra-del-freno`)
  tuvieron que mantenerse abiertos al mismo tiempo para poder ver el botón "Update branch"
  en acción (el efecto de `strict: true`): con un solo PR abierto, ese aviso nunca aparece
  porque no hay ningún cambio nuevo en `main` contra el cual quedar desactualizado.

### Declaración de uso de IA

Usé Claude para guiarme paso a paso durante todo el TP4: explicarme la diferencia entre
`push` y `pull_request` como triggers, redactar el workflow completo (los dos jobs, el cache
con `scope` separado), guiarme en la configuración del gate en el Ruleset (en vez de la
Branch Protection clásica, porque mi repo usa Rulesets desde el TP1), decidir conmigo la
forma correcta de romper el build para mi stack específico (Node/Express sin build), y
ayudarme a redactar este `decisiones.md`. Verifiqué cada paso ejecutándolo yo misma:
confirmé el build roto en mi máquina antes de subirlo, miré los logs reales de cada corrida
en la pestaña Actions para confirmar el `CACHED`, y revisé en el PR que los checks realmente
bloquearan el botón de merge antes de dar por bueno cada checkpoint.
