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

## Fix: URL de la API horneada a localhost en el build

**Problema encontrado**: `VITE_API_URL` se resuelve en build-time, y su default
(`http://localhost:4000/api`) quedaba literalmente incrustado en el bundle JS.
Funcionaba perfecto en mi propia máquina (browser y backend comparten
`localhost`), pero fallaba en silencio —fetch rechazado, sin error visible más
allá de la consola— para cualquiera que abriera la app desde otro host: LAN,
un dominio real, o el profesor conectándose en vivo en la defensa de P1.

**Cómo lo detecté**: revisando con Claude Code tras una observación del
profesor en la mesa de P1 sobre algo "raro" relacionado a nginx. Reproduje el
síntoma accediendo al frontend por la IP de LAN de mi máquina en vez de
`localhost` y viendo el bundle seguir apuntando a `localhost:4000` con
`curl`.

**Solución**: `proxy_pass` en `nginx.conf` (`/api/` → `http://backend:4000/api/`,
resuelto por DNS interno de Docker Compose) para que el frontend le pegue
siempre a `/api` relativo, mismo origin, sin importar el host. El mismo proxy
se agregó en `vite.config.js` (con `loadEnv`) para no romper `npm run dev` /
`npm run preview`, que no pasan por nginx.

**Cambios**: `frontend/src/api/client.js` (default a `/api`),
`frontend/Dockerfile` y `docker-compose.yml` (`VITE_API_URL` default a `/api`),
`.env.example` (raíz y frontend), `vite.config.js` (proxy de dev), y
`frontend/nginx.conf` (proxy + `Cache-Control`: `no-cache` en `index.html`,
`public, max-age=31536000, immutable` en `/assets/`, este último un hallazgo
secundario del mismo audit).

**Verificado**: `nginx -t` OK, bundle sin `localhost:4000`, request real desde
IP de LAN a `/api/servicios` respondiendo por el proxy, login end-to-end desde
esa misma IP, `/admin` directo por URL sigue en 200 (SPA fallback intacto).

**IA**: usé Claude Code para auditar `nginx.conf`, el Dockerfile del frontend
y el routing, reproducir el bug con `curl`/`docker compose`, e implementar el
fix. Verifiqué cada cambio corriendo los comandos de arriba yo misma antes de
commitear.

---


## TP5 — Testing y calidad

### 1. Qué testeé y por qué

Elegí testear las 4 reglas de negocio de `turnoRules.js` y el controlador `turnoController.crear`
(regla #1, solapamiento) — son las que más duelen si se rompen: un bug en el cálculo de totales
cobra mal, uno en la máquina de estados permite transiciones inválidas, uno en el solapamiento
permite doble-reserva.

- `calcularTotales` (regla #2): suma de duración/precio, incluido el caso de que Postgres
  devuelve `NUMERIC` como string (probé con precios tipo `'1500.50'`).
- `esTransicionValida` (regla #3): parametrizado con `it.each` sobre las 4 transiciones válidas y
  5 inválidas, más un test que compara contra `TRANSICIONES_VALIDAS` completo para que no se
  desactualice si se agrega una transición nueva al código.
- `puedeCancelarPorTiempo` (regla #4): 25hs (permite), exactamente 24hs — el borde — (permite),
  23hs (rechaza).
- `turnoController.crear` / solapamiento (regla #1): **test con mock**, mockeando `turnoModel` y
  `servicioModel`. No solo devuelvo datos fijos (eso sería un stub): verifico la interacción —
  `expect(turnoModel.crear).not.toHaveBeenCalled()` cuando hay solapamiento, para probar que el
  turno nunca se intenta crear.

Total: 17 tests de backend (mínimo pedido: 8).

Del lado del frontend testeé `src/api/client.js` — el único archivo sin DOM con lógica propia —
mockeando `fetch` y `localStorage` con `vi.stubGlobal`: un test de `login`, uno parametrizado
sobre 6 métodos del `api` (`it.each`), uno de caso de error (mensaje exacto que viene del backend),
y uno de mock que verifica que el header `Authorization: Bearer <token>` se arma bien. Total: 9
tests (mínimo pedido: 4).

PRs: [#24](https://github.com/MariaRuival/gestion-turnos/pull/24) (backend),
[#26](https://github.com/MariaRuival/gestion-turnos/pull/26) (frontend).

### 2. Qué queda adentro de la cuenta de cobertura, y qué no

**Backend** — adentro: `controllers/`, `middleware/auth.js` y `utils/`. Afuera: `server.js`,
`routes/*`, `app.js`, `middleware/errorHandler.js` (arranque y wiring de Express, sin reglas de
negocio — el enunciado los marca explícitamente como excluibles) y `config/`, `db/`, `models/`
(consultas SQL puras, ya documentado arriba en "Organización general": sin lógica de negocio).

Importante: `middleware/auth.js` se queda **adentro** aunque hoy esté en 0%, porque `requiereRol`
implementa la parte administrativa de la regla #5 (el comentario del código lo dice textual).
Excluirlo solo porque no tiene tests sería la trampa que señala el enunciado — esconder lógica no
testeada en vez de medir lo que importa.

**Frontend** — adentro: solo `src/api/client.js`. Los componentes React quedan fuera de esta
cuenta, no porque falte cubrirlos sino porque requieren testing con DOM, una categoría distinta a
la que pide este TP (el enunciado la deja como "opcional avanzado", fuera de alcance acá).

### 3. Umbral de coverage: el número, la métrica y por qué

**Backend** — medición real antes de definir el umbral: 24.4% líneas, 24.21% statements, 23.8%
funciones, **18.64% ramas**. Lo que más pesa en contra: `authController.js` (87 líneas, 0%) y
`middleware/auth.js` (0%) — login, registro y verificación de JWT quedaron fuera del alcance de
tests que prioricé en este TP (me concentré en las reglas de turnos). Umbral elegido: **20%
líneas / 20% statements / 20% funciones / 15% ramas** — por debajo de la medición real en los
cuatro casos (margen de ~4 puntos en línea/statements, ~3.6 en ramas), para que el freno exista de
verdad sin ser una meta que yo misma tendría que esquivar.

**Frontend** — medición real: 100% líneas, 100% statements, 81.81% funciones, **87.5% ramas**.
Umbral elegido: **90% líneas / 90% statements / 70% funciones / 75% ramas**, también por debajo
de la medición real en los cuatro casos. No cerré las dos ramas que faltan para llegar a 100%: ya
supero el mínimo de 4 tests pedido, y el objetivo de esta tarea es que el umbral frene retrocesos,
no maximizar el número.

Verificación del freno en los dos lados: corrí la suite con el umbral real (pasa, exit code 0) y
con un valor pisado por línea de comandos sin tocar el archivo (falla, exit code 1). Backend:
`Jest: "global" coverage threshold for lines (50%) not met: 24.4%`. Frontend: `ERROR: Coverage
for functions (81.81%) does not meet global threshold (95%)`.

### 4. Por qué un coverage alto no garantiza calidad (mi propio ejemplo)

`client.js` da 100% en líneas y en statements, pero 81.81% en funciones: dos métodos enteros,
`api.registro` y `api.crearTurno`, nunca son llamados por ningún test. El número de línea no lo
delata porque esas funciones *existen* como código alcanzable desde otros tests indirectamente
cubiertos — lo que falta no es que el archivo se ejecute, es que **nadie verificó qué hacen esos
dos métodos en particular**. Un 100% en líneas se puede lograr sin haber probado nunca la mitad
de la superficie pública del archivo; por eso el enunciado pide reportar siempre rama y función
además de línea, no solo el número más fácil de inflar.

### 5. El ejercicio de la rama sin cubrir

Elegí `backend/src/utils/turnoRules.js`, línea 23: el parámetro por default de
`puedeCancelarPorTiempo(fechaHoraInicio, ahora = new Date())`. Mis 3 tests de esta función siempre
pasan `ahora` explícito (25hs, 24hs, 23hs de anticipación), así que la rama del `= new Date()` —
usar el reloj real cuando no se pasa el segundo argumento — nunca se ejecuta.

- **Qué entrada la recorrería**: llamar a la función con un solo argumento,
  `puedeCancelarPorTiempo(fechaFutura)`, sin pasar `ahora`.
- **Qué decidí hacer**: no lo agregué. Testear contra `new Date()` real introduce no-determinismo
  (el resultado depende del instante exacto en que corre el test) sin sumar cobertura de una regla
  nueva — ya pruebo el comportamiento de la función con los 3 casos de borde reales que importan.
  El parámetro por default existe para que el código de producción (`turnoController`) lo llame
  cómodo sin tener que pasar la hora actual a mano, no como una rama de negocio que haya que
  verificar aparte.

### 6. Problemas encontrados y cómo los resolví

- El pipeline empezó a fallar de forma intermitente con `429 Too Many Requests` de Docker Hub al
  hacer `FROM node:20-alpine` — el límite de pulls anónimos compartido entre todos los runners de
  GitHub Actions. Solución: `docker/login-action` en ambos jobs con una cuenta gratuita de Docker
  Hub (`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`), que mueve las pulls al límite autenticado por
  cuenta en vez del pool anónimo saturado.
- Al correr la etapa de test del frontend en un contenedor con el volumen montado directo en
  `/app/coverage`, la corrida fallaba con `EBUSY: resource busy or locked, rmdir
  '/app/coverage'`. Causa: Vitest borra la carpeta de coverage completa antes de escribir el
  reporte (`coverage.clean`, default `true`), y el punto de montaje de un volumen Docker no se
  puede borrar desde adentro del contenedor. Jest no tiene este problema porque no limpia la
  carpeta antes de escribir. Solución: montar un directorio padre y que Vitest escriba en una
  subcarpeta adentro, controlada por `COVERAGE_DIR` — mismo mecanismo que ya usaba el script
  `test:coverage`, solo cambia dónde apunta el volumen del `docker run`.

### 7. Coverage dentro del pipeline

Cada Dockerfile tiene una etapa `test` nueva, en el medio (entre `deps`/`build` y la imagen
final), para que el pipeline testee el mismo código y las mismas dependencias que después se
despliegan. El job de CI la construye con `target: test`, la corre con `docker run`, y
`coverage-summary.json` (generado por el reporter `json-summary`) se convierte en una tabla
Markdown agregada a `$GITHUB_STEP_SUMMARY` — visible en la página de la corrida sin descargar
nada — mientras el reporte HTML completo se sube como artefacto descargable.

Verificado en una corrida real: el Summary de `build-backend` mostró 24.4% / 24.21% / 23.8% /
18.64%, y el de `build-frontend` 100% / 100% / 81.81% / 87.5% — coinciden exacto con lo medido en
mi máquina.

PRs: [#27](https://github.com/MariaRuival/gestion-turnos/pull/27) (coverage backend),
[#28](https://github.com/MariaRuival/gestion-turnos/pull/28) (coverage frontend),
[#29](https://github.com/MariaRuival/gestion-turnos/pull/29) (Dockerfiles con la etapa test),
[#30](https://github.com/MariaRuival/gestion-turnos/pull/30) (ci.yml).

### 8. Declaración de uso de IA

Usé Claude para planificar juntas qué reglas testear y con qué técnica en cada una, para decidir
el scope y el umbral de coverage (discutiendo qué incluir/excluir y por qué, contra lo que pide
el enunciado), y para diagnosticar los dos problemas de infraestructura del pipeline (Docker Hub,
EBUSY de Vitest). Claude Code generó los archivos de test, las configs de Jest/Vitest y los
cambios de `ci.yml` a partir de esos planes. En cada paso corrí yo misma la suite y leí la salida
completa (nombres de test, tabla de coverage, mensajes de error exactos) antes de commitear;
puedo explicar qué verifica cada assert y qué rama/función específica quedó sin cubrir en cada
archivo.

### 9. El umbral bloqueando un merge — los 2 Pull Requests

**PR 1** — [#32](https://github.com/MariaRuival/gestion-turnos/pull/32): agregué `urgenciaDeTurno`
a `turnoRules.js`, una función de 7 caminos, sin tests. Compiló perfecto y los 17 tests existentes
siguieron en verde, pero el build se frenó igual: `branches` cayó a 14.47%, por debajo del umbral
de 15% (corrida roja:
[`.../runs/38013678642`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38013678642),
log: `Jest: "global" coverage threshold for branches (15%) not met: 14.47%`). Agregué los 7 tests
que faltaban —uno por camino— y el build volvió a verde (corrida verde:
[`.../runs/38013892657`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38013892657)).
Mergeado con la secuencia completa en su historial.

**Ratchet intermedio** — [#33](https://github.com/MariaRuival/gestion-turnos/pull/33): una vez
cubierta `urgenciaDeTurno`, el coverage real de ramas subió a 35.52%, muy por encima del umbral
original de 15% — demasiado margen para que un solo método sin tests lo rompiera de nuevo. Subí el
umbral de `branches` a 32% (dejando `lines`/`statements`/`functions` en 20, que seguían ajustados).
Esto es la práctica de "ratchet": cuando la cobertura mejora, se sube el piso para que no se pueda
retroceder — mergeado en verde, sin romper nada (branches real 35.52% > 32%).

**PR 2** — [#34](https://github.com/MariaRuival/gestion-turnos/pull/34): agregué
`proximaAccionDisponible` (otra función de varios caminos, combinando estado y rol), también sin
tests. Con el umbral ya en 32%, esto bastó para frenar de nuevo: `branches` cayó a 30.68% (corrida
roja: [`.../runs/38014595056`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38014595056)).
**Este PR queda abierto y en rojo a propósito, sin arreglar, hasta la defensa** — es la prueba de
que el freno sigue vigente, no solo que funcionó una vez.


## TP6 — CD: Entornos, Promoción y Gate Humano

### Enlaces de este TP

- Paquetes públicos: `ghcr.io/mariaruival/gestion-turnos-backend` y
  `ghcr.io/mariaruival/gestion-turnos-frontend` (pull verificado sin credenciales, con`docker logout ghcr.io` antes de probar).
- Cadena de publicación: corrida de un PR con "Entrar al registry" salteado —
  [`.../runs/38560275602`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38560275602) —
  y la corrida real de `main` que sí publica —
  [`.../runs/38560556369`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38560556369).
- QA: [turnos-front-qa.onrender.com](https://turnos-front-qa.onrender.com) /
  [turnos-api-qa.onrender.com](https://turnos-api-qa.onrender.com).
- PROD: [turnos-front-prod.onrender.com](https://turnos-front-prod.onrender.com) /
  [turnos-api-prod.onrender.com](https://turnos-api-prod.onrender.com).
- Deploy automático a QA con smoke en verde:
  [`.../runs/38604678741`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38604678741).
- Rechazo a PROD, con motivo:
  [`.../runs/38783459478`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38783459478).
- Aprobación a PROD:
  [`.../runs/38784862878`](https://github.com/MariaRuival/gestion-turnos/actions/runs/38784862878).
- Release [`v6.0.0`](https://github.com/MariaRuival/gestion-turnos/releases/tag/v6.0.0), tagueada
  sobre el commit que Render reporta como desplegado en `production` (no la punta de `main`).

### 1. Por qué el artefacto se publica solo en verde

El job que publica a `ghcr.io` es el mismo que corre los tests y mide el coverage — publicar es
el último paso de ese job, después de construir la etapa de tests y correrlos. Si cualquier paso
anterior falla, el workflow corta ahí y la publicación nunca se ejecuta: no hace falta ninguna
condición explícita, es consecuencia del orden. Si el registry publicara igual aunque los tests
fallaran, "publicado" dejaría de significar "pasó la verificación" y pasaría a significar solo
"compiló" — el umbral de coverage del TP5 perdería sentido, porque algo podría romperlo y la
imagen rota se publicaría de todos modos.

Son **tres controles encadenados**, no uno: nada entra a `main` sin los checks en verde
(protección de rama), solo `main` dispara la publicación, y publicar es el último paso del mismo
job que verifica. Los tres juntos hacen imposible por accidente que se publique algo no
verificado.

### 2. Continuous Delivery vs Continuous Deployment

Implementé **Continuous Delivery** hacia producción, no Deployment: todo merge a `main` que pasa
los tests queda listo para desplegarse a PROD, pero no se despliega solo — necesita mi aprobación
manual en el environment `production`. QA sí es Continuous Deployment real: cada merge se
despliega ahí sin que nadie intervenga.

Elegí Delivery para PROD porque la app maneja datos reales de negocio y, aunque el pipeline mide
coverage y corre smoke tests, ninguno de los dos prueba flujos de negocio completos — un humano
mirando el diff y el estado de QA agrega un juicio que el pipeline no tiene. Para llegar a
Deployment completo necesitaría más tests de integración/e2e y más confianza en que el pipeline
solo detecta regresiones técnicas, no de producto.

### 3. Diseño de la cadena y alcance de cada secret
`deploy-qa` depende de los dos builds y solo corre en push a `main`, nunca en un PR. `deploy-prod`
depende de `deploy-qa`: si QA falla o su smoke no da verde, `deploy-prod` ni arranca. Los secrets
están scopeados por environment, no por repo: `RENDER_HOOK_*_QA` solo existen dentro de un job con
`environment: qa`, `RENDER_HOOK_*_PROD` solo dentro de `environment: production`. Si estuvieran a
nivel repo, cualquier job —incluido uno corriendo sobre cualquier rama— podría leerlos; el
environment es lo que hace el hook de PROD inalcanzable para cualquier corrida que no pasó por la
aprobación. `deploy-prod` además tiene `concurrency: { group: deploy-prod, cancel-in-progress:
false }`, para que una corrida vieja encolada nunca se despliegue después de una más nueva.

### 4. Qué mira el aprobador antes de aprobar

Que el smoke test de `deploy-qa` haya dado verde para ese commit específico (no "QA anda", sino
"QA anda con este commit"); qué tipo de cambio es (infraestructura pura vs algo que un usuario
notaría); y si falta documentar algo antes de que quede en producción. Lo practiqué con los dos
caminos: un **rechazo** (el commit solo agregaba el job `deploy-prod`, sin nada de producto para
mostrar) y una **aprobación** (un cambio chico pero visible — el badge de versión —, confirmado a
simple vista en PROD después del deploy).

### 5. Letra chica del free tier

Los servicios free de Render duermen tras inactividad; la primera request puede tardar 50+
segundos. Mi smoke test lo absorbe con un loop de reintentos (30 × 20s) en vez de esperar
respuesta inmediata. Elegí Neon para Postgres en vez del Postgres propio de Render porque el de
Render **expira a los 30 días** de creado (14 de gracia antes de borrarse) — no cubre ni el resto
del cuatrimestre; Neon es permanente en su free tier (con límites de uso, no de tiempo).

### 6. Qué garantía pierdo porque Render reconstruye en vez de usar mi imagen

El pipeline publica una imagen verificada en `ghcr.io`, pero Render no la usa: clona el repo y
reconstruye con mi Dockerfile de forma independiente cada vez. Lo que corre en Render podría no
ser bit-a-bit idéntico a lo verificado en CI si una dependencia sin pin exacto resuelve distinto
entre un build y otro. La garantía de "lo que se probó es lo que corre" depende acá de que el
Dockerfile y el lockfile sean deterministas, no de una cadena de custodia real del binario.

### 7. Qué prueba mi smoke test y qué no

Prueba: el proceso vivo, la base conectada (`/health` hace un `SELECT 1` real), que el commit
desplegado es exactamente el recién mergeado (comparando contra `RENDER_GIT_COMMIT`), y que el
front responde. No prueba: ningún flujo de negocio real (login, crear un turno), ni el proxy de
`/api/` de punta a punta desde el browser (eso lo verifiqué a mano por separado), ni performance.

### 8. Deployment pattern para producción real + plan de rollback

Elegiría **rolling deployment** antes que blue-green o canary: blue-green duplica el costo de
infraestructura (dos entornos completos en paralelo) y canary necesita enrutar tráfico por
porcentaje, algo que no tengo con el free tier de Render. Rolling es lo que ya tengo de hecho: un
servicio por entorno, reemplazado completo en cada deploy. Para canary en serio necesitaría un
proxy/load balancer propio delante de dos instancias de PROD y una forma de decidir el split.

**Plan de rollback**: disparar los Deploy Hooks de PROD con el SHA del commit anterior
(`&ref=$SHA_ANTERIOR`), el mismo mecanismo que un deploy normal, apuntando hacia atrás. Lo medí de
verdad: disparé los hooks a las 15:38:53 y Render marcó el backend *Live* en 23.8s y el frontend en
33.9s — **~34 segundos en total** (manda el más lento). Fue rápido porque Render ya tenía ese
commit construido de un deploy anterior y reusó la cache de Docker; un commit nunca antes
desplegado tardaría lo mismo que un deploy normal (varios minutos).

Lo que el rollback de código **no** deshace: un cambio de schema aplicado a la base (lo aplico a
mano, sin migraciones versionadas) sigue aplicado después de volver el código atrás — si un deploy
hubiera borrado una columna, esa columna sigue borrada aunque el código vuelva. Rollback de código
y de datos son problemas distintos; este pipeline solo resuelve el primero.

### 9. Problemas encontrados y cómo los resolví

- **Nombre de imagen en mayúsculas**: `github.repository` incluye el usuario tal cual, y Docker
  rechaza tags con mayúsculas. Un step arma el nombre en minúsculas antes de usarlo, y corre
  siempre (no solo en push), porque Docker valida el formato del tag al construir aunque
  `push: false`.
- **`/health` caía en el fallback del SPA**: nginx reenvía todo lo que no sea `/api/` o `/assets/`
  a `index.html`. Se resolvió con un `location = /health` explícito, con el mismo proxy que
  `/api/`.
- **Header `Host` incorrecto hacia Render**: el proxy mandaba el `Host` del frontend, y Render
  enruta por ese header — la llamada a la API volvía al propio frontend. Se arregló con
  `proxy_set_header Host $proxy_host`.
- **Puerto fijo (`listen 80`) contra el `$PORT` de Render**: Render espera que el contenedor
  escuche en el puerto que asigna vía `PORT`. Se resolvió parametrizando `listen ${PORT};`, con
  `PORT=80` como default para no romper `docker compose`.
- **El template de nginx se vació solo en un commit** (probablemente el editor, a mitad de un
  commit) y quedó mergeado en `main`. Se detectó comparando con el commit anterior y se restauró
  en un PR de fix antes de afectar un deploy real.
- **El primer smoke test tenía tres bugs encadenados**: `curl -f` contra una llamada que siempre
  daba 401 hacía fallar el script aunque todo anduviera bien; un 401 de una ruta protegida no
  probaba que la base estuviera conectada (el middleware de auth corta antes de llegar a la
  base); y `bash -e` cortaba el loop entero ante el primer timeout de red, normal durante un cold
  start, en vez de reintentar. Se resolvió rediseñando el smoke sobre `/health` (sin auth, con un
  `SELECT 1` real), comparando el commit devuelto contra `$GITHUB_SHA`, con `|| true` para que un
  timeout no corte el script.
- **Una corrida quedó colgada ~21 horas** esperando aprobación tras un corte de batería a mitad de
  sesión. Se canceló manualmente y se re-disparó el pipeline con un commit vacío, en su propio PR
  (`main` está protegida, ni un commit vacío puede pushearse directo).
- **"Allow administrators to bypass configured protection rules" venía tildado por default** en el
  environment `production` — si quedaba así, el gate no me habría frenado a mí misma (soy admin
  del repo), y la Fase 5 habría sido decorativa. Se destildó antes de probar nada.

### 10. Declaración de uso de IA

Usé Claude para planificar cada fase (publicación de imágenes, Neon, Render, la plantilla de nginx, el gate humano, el rollback) y para diagnosticar cada problema a medida que apareció: el nombre de imagen en mayúsculas, el header `Host`, el puerto fijo, los tres bugs del smoke test, y el archivo de nginx vaciado. Claude Code generó los cambios de código y de `ci.yml` a partir de esos diagnósticos, pero cada verificación la corrí yo misma: probé con `curl` QA y PROD con y sin token, confirmé en el navegador el login completo en los dos entornos, miré los logs reales de
Render para cada deploy, y disparé y cronometré el rollback a mano desde mi terminal.

## Enlaces del TP7

- Paquetes públicos: `ghcr.io/mariaruival/gestion-turnos-backend:sha-59d34cc00fbffce53f0e1d2317b7b9b5e1c7a993`
  y `ghcr.io/mariaruival/gestion-turnos-frontend:sha-59d34cc00fbffce53f0e1d2317b7b9b5e1c7a993`
  (el commit que terminó en PROD; `docker pull` verificado sin credenciales en los dos).
- **Corrida roja** (integración verde, e2e roja, frenando la promoción) — commit que rompió la app:
  [`ef7758e`](https://github.com/MariaRuival/gestion-turnos/commit/ef7758e) (PR
  [#48](https://github.com/MariaRuival/gestion-turnos/pull/48), un solo `data-testid` cambiado en
  `ClienteView.jsx`, sin tocar `e2e/`). Corrida:
  [`.../runs/40010304255`](https://github.com/MariaRuival/gestion-turnos/actions/runs/40010304255),
  job e2e en rojo:
  [`.../job/120614548995`](https://github.com/MariaRuival/gestion-turnos/actions/runs/40010304255/job/120614548995).
  Artefactos de esa misma corrida: `playwright-report-integracion` (verde) y `playwright-report-e2e`
  (rojo, con la traza del timeout buscando `reserva-submit`).
- **Corrida completa en verde**, después del fix (PR
  [#50](https://github.com/MariaRuival/gestion-turnos/pull/50)), hasta PROD:
  [`.../runs/40013057136`](https://github.com/MariaRuival/gestion-turnos/actions/runs/40013057136).
- QA: [turnos-front-qa.onrender.com](https://turnos-front-qa.onrender.com) /
  [turnos-api-qa.onrender.com](https://turnos-api-qa.onrender.com). PROD:
  [turnos-front-prod.onrender.com](https://turnos-front-prod.onrender.com) /
  [turnos-api-prod.onrender.com](https://turnos-api-prod.onrender.com) — vivas hasta la defensa.
- Release [`v7.0.0`](https://github.com/MariaRuival/gestion-turnos/releases/tag/v7.0.0), tagueada
  sobre el commit que *Deployments* reporta como desplegado en `production`
  (`59d34cc...`), no el último de `main`.

---

## TP7 — Contenedores en runtime, integración y e2e como gate

### 1. "Build once, deploy many": qué problema del TP6 resuelve

En el TP6, Render **reconstruía** cada servicio desde el repo con mi Dockerfile — nunca ejecutaba la
imagen que mi pipeline había publicado en `ghcr.io`. Eso significa que "lo que se probó" (la imagen
que pasó tests y coverage) y "lo que corre" (una reconstrucción posterior, independiente) podían no
ser el mismo artefacto: si una dependencia sin pin exacto resolvía distinto entre un build y otro, QA
y PROD podían terminar corriendo código distinto aunque el commit fuera idéntico — exactamente el
escenario que describe el enunciado ("el rebuild de PROD resolvió una dependencia distinta"). Mi
propio ejemplo real de esta clase de problema, aunque lo encontré en otro contexto: en el TP7 mismo,
Render **nunca inyecta `RENDER_GIT_COMMIT`** a un servicio *image-backed*, algo que sí hacía cuando
el servicio estaba conectado a Git — un comportamiento que cambia según *cómo* se construye, no según
qué código tiene. Cerrar el hueco (Fase 1) significa que ahora el pipeline le dice a los 4 servicios
**qué imagen exacta** ejecutar, y esa imagen es bit a bit la que ya pasó build + tests + coverage.

### 2. Estrategia de etiquetas, qué garantiza cada una, y por qué no `latest`

- **`sha-<commit>`** en `ghcr.io`: identifica una imagen con el código exacto de un commit. Es lo que
  usan los Deploy Hooks (`imgURL=ghcr.io/.../gestion-turnos-backend:sha-<commit>`) para desplegar — así
  QA y PROD siempre reciben una imagen trazable a un commit específico, nunca "la última que haya".
- **`v7.0.0`** en git: le pone nombre humano a un punto del historial para la defensa y el catálogo de
  versiones — no participa del deploy en sí, el pipeline no lo usa para nada.
- Mi pipeline **nunca publica `latest`**: cada build se publica únicamente con el tag `sha-${{
  github.sha }}`, generado dinámicamente en cada corrida. Si publicara `latest`, cualquier servicio
  apuntando a ese tag correría la versión más reciente sin que el pipeline se lo dijera explícitamente
  — perdería la trazabilidad "qué commit corre dónde" que es la base de todo este TP.
- **Con qué imagen configuré los 4 servicios de Render, y por qué no es esa la que corre**: en
  *Settings → Build → Source*, cada servicio quedó con *Existing Image* apuntando a
  `sha-c809970384e4d0d15ec4196503cca99e287ae7dd` (el commit con el que hice el primer deploy manual, de
  prueba). Esa URL es solo la **imagen inicial** con la que arrancó el servicio — la que corre *hoy*
  es la del **último Deploy Hook** disparado por el pipeline (`imgURL=...:sha-<commit más reciente>`),
  no la del campo de configuración, que nunca se actualiza solo. Se confirma en *Events*: cada entrada
  dice "Triggered via Deploy Hook" con el `sha-<commit>` de esa corrida en particular.
- **No creé servicios nuevos**: cambié la fuente de los 4 servicios ya existentes del TP6 (Settings →
  Build → Source → Edit → Existing Image), así que no hay servicios viejos que haya tenido que
  abandonar o limpiar.

### 3. De la release a la imagen, en un paso

```bash
git rev-list -n1 v7.0.0
```

Devuelve el commit (`59d34cc...`), y ese mismo string es la etiqueta `sha-<commit>` de los dos
paquetes en `ghcr.io` — no hace falta ningún paso intermedio ni traducción manual.

### 4. Cómo se comprueba desde afuera que un entorno ejecuta la imagen (y qué no prueba el smoke)

Entrando a *Events* de cada servicio en Render: cada deploy dice **"Triggered via Deploy Hook"** (no
"Deploy triggered by a new commit" ni nada que sugiera reconstrucción) y nombra el `sha-<commit>`
exacto de esa corrida — la misma etiqueta que figura en el package de `ghcr.io`. Un deploy hecho a
mano desde el panel de Render, en cambio, se vería distinto ahí (sin esa leyenda), y por eso el
enunciado insiste en que **solo** el pipeline dispara deploys.

Lo que el smoke test (del TP6, heredado acá) **no** prueba: solo confirma que el proceso responde y
que el commit coincide (`/health` con `GIT_SHA` horneado en la imagen, ya que Render no inyecta
`RENDER_GIT_COMMIT` a servicios *image-backed*) — nunca confirma que un flujo de negocio real
funcione de punta a punta. Mi propio caso: durante la demo de este TP, el smoke test de `deploy-qa`
pasaba en verde sin problema aunque el botón de reservar tuviera el `data-testid` roto — "el proceso
responde con el commit correcto" y "el botón de reservar funciona" son preguntas completamente
distintas, y solo la e2e contesta la segunda.

### 5. Qué pruebo en integración, qué en e2e, y por qué el tercero de cada suite

**Integración** (`frontend/e2e/api.spec.js`, sin navegador, contra `turnos-api-qa.onrender.com`):
1. CRUD de servicios completo — alta, `GET` lo encuentra, `DELETE`, `GET` ya no lo encuentra.
2. Alta con nombre vacío → `400`, nada se crea.
3. **La elegida por mí**: un cliente autenticado (no admin) intenta crear un servicio → `403`, no
   `401` (porque SÍ está autenticado, solo no tiene el rol) → nada se crea. La elegí porque es
   exactamente el tipo de regla que, si se rompe, nadie se entera hasta que alguien nota que el
   catálogo de servicios cambió sin que un admin lo tocara — un bug de permisos silencioso.

**E2E** (`frontend/e2e/tareas.spec.js`, con navegador, contra `turnos-front-qa.onrender.com`):
1. Admin crea un servicio desde la UI, lo ve en pantalla sin recargar, lo elimina, desaparece.
2. Cliente intenta reservar sin elegir servicios → ve el mensaje de error, no navega, "Mis turnos"
   no cambia.
3. **La elegida por mí ("el flujo de todos los días")**: un cliente reserva un turno real con un
   servicio, y lo ve aparecer en "Mis turnos" — es literalmente la razón de existir de la app; si
   esto se rompe, es lo primero que notaría cualquier usuario.

**Qué NO puse en cada suite, y por qué (pirámide)**: la integración no prueba nada de interfaz (no
sabe que existe un botón, solo que un `POST` devuelve `403`) — eso es trabajo de la e2e. La e2e, a su
vez, no repite casos de permisos ya cubiertos por integración (sería redundante y más lento — un
test con navegador tarda ~10x más que uno de integración) ni repite las reglas de negocio puras que
ya probé con mocks en el TP5 (`turnoRules.js`) — esas no necesitan ni API real ni navegador.

### 6. El par verde/rojo que diagnosticó mi rotura

Rompí `ClienteView.jsx` cambiando el `data-testid` del botón de reservar de `reserva-submit` a
`reserva-enviar` — un cambio que compila perfecto, no toca el backend, y es invisible para un humano
con mouse (el botón sigue funcionando, solo cambió un atributo interno). En la corrida resultante:
**`integracion` quedó verde** (nunca tocó el front, la API seguía sana) y **`e2e` quedó roja**, con
el mismo mensaje exacto en los dos tests que usan ese botón: `waiting for getByTestId('reserva-
submit')`, timeout agotado. El *page snapshot* del reporte de e2e mostraba la pantalla completamente
funcional — formulario cargado, servicios con precios, botón visible con su texto — lo único "raro"
era que Playwright nunca encontró el identificador técnico que buscaba. Ese contraste (integración
sana + e2e ciega a un elemento que a simple vista está ahí) es la señal inequívoca de "el problema es
un detalle del front, específicamente algo que un test automatizado busca por un identificador que
cambió" — sin necesidad de leer una línea de código para llegar a esa conclusión.

### 7. Por qué mi integración es "amplia" (contra QA ya desplegado) y no "estrecha"

Elegí que `api.spec.js` le hable a la API de QA **real, ya desplegada**, en vez de levantar un
backend local con una base en memoria o mockeada. Qué gano: pruebo exactamente la configuración que
también usan los usuarios reales (CORS, variables de entorno de Render, el driver real de Postgres
contra Neon, la latencia real de la red) — un bug que solo aparece por una variable de entorno mal
seteada en QA jamás aparecería contra un backend local perfecto. Qué pierdo: velocidad (cada test
depende de la red y del cold start del free tier) y determinismo — QA es una base compartida entre
todas mis corridas, así que tuve que diseñar cada test para que fabrique su propio dato único (con
`Date.now()` en el nombre) y lo borre al terminar, en vez de asumir un estado limpio de la base.

### 8. Cold start y qué es un test flaky

Cada job (`integracion`, `e2e`) espera primero a que la API y el front respondan, con un loop de
hasta 10 intentos × 10 segundos antes de correr la suite — así el cold start del free tier de Render
no cuenta como un fallo de los tests en sí. Dentro de la e2e, `loginUI` reintenta el login **una
sola vez** si la primera respuesta fue un `502` real (cold start de la API o de la base) — pero no si
el login simplemente tardó más de lo normal, porque ahí hay que esperar la navegación, no reintentar
sobre una página que ya cambió.

Un **test flaky** es uno que pasa o falla de forma inconsistente **sin que el código haya cambiado**
— por factores externos (timing, estado compartido, orden de ejecución) en vez de por un bug real.
Tuve varios casos reales durante este TP: los dos archivos de Playwright corriendo en paralelo se
pisaban entre sí contando servicios en la misma base (se resolvió con `workers: 1` y, para el
pipeline, con `e2e` dependiendo de `integracion` en vez de correr en paralelo); los horarios de los
turnos de prueba chocaban entre corridas del mismo minuto (se resolvió eligiendo un horario al azar,
meses en el futuro); y el login fallando por un `502` puntual del cold start (resuelto con el
reintento de arriba). En todos los casos, la señal de que era "flaky" y no un bug real fue que corría
la misma suite varias veces seguidas y el resultado cambiaba sin tocar código.

### 9. Cómo la misma imagen del front sirve en QA y en PROD

Nada de la URL del backend queda **horneado** en la imagen del front al momento del build — viene del
patrón de template de nginx que ya armé en el TP6: `default.conf.template` usa `${BACKEND_URL}`,
`${DNS_RESOLVER}` y `${PORT}`, y el script de arranque de la imagen oficial de nginx (`envsubst`) los
reemplaza recién cuando el **contenedor arranca**, no cuando se construye la imagen. Así, la imagen
`sha-<commit>` del front es idéntica en QA y en PROD — lo único que cambia es la variable de entorno
`BACKEND_URL` que Render le inyecta a cada servicio (`https://turnos-api-qa.onrender.com` en uno,
`https://turnos-api-prod.onrender.com` en el otro), configurada una sola vez en el panel de cada
servicio, nunca en el Dockerfile ni en el pipeline.

### 10. Problemas encontrados y cómo los resolví

- **`RENDER_GIT_COMMIT` dejó de existir** al pasar los servicios a *Existing Image* (Render solo la
  inyecta a deploys conectados a Git). Mi smoke test del TP6 comparaba ese valor contra `$GITHUB_SHA`
  y hubiera quedado roto para siempre. Solución: hornear el commit **dentro** de la imagen con un
  `ARG GIT_SHA` / `ENV GIT_SHA=$GIT_SHA` en el Dockerfile (pasado por el pipeline como `build-args` al
  publicar), y que `/health` devuelva `RENDER_GIT_COMMIT || GIT_SHA || null`.
- **Las dos suites en paralelo se pisaban**: `integracion` cuenta servicios antes/después de un alta
  inválida, mientras `e2e` crea y borra su propio servicio contra la misma base de QA al mismo
  tiempo. Encontrado analizando qué dato toca cada test, antes de que fallara en la práctica.
  Solución: `e2e` pasó a depender de `integracion` (`needs: [integracion]`) en vez de correr en
  paralelo — se serializan sin perder los dos jobs separados en Actions.
- **El login en la e2e fallaba con `502` real** contra QA recién desplegado (cold start de la API y
  de la base de Neon, no solo del front) — el chequeo de "¿está despierto?" del job `e2e` solo
  probaba el front, nunca un login real. Se resolvió haciendo que ese chequeo también confirme
  `/health` de la API antes de arrancar la suite, y agregando un reintento único en `loginUI` que
  distingue "la URL cambió" (éxito, no reintentar) de "apareció `login-error`" (reintentar una vez)
  — verificado con cuatro escenarios simulados, incluido uno con una contraseña incorrecta real, para
  confirmar que el reintento nunca tapa un bug genuino.
- **Confusión de ramas locales viejas**: después de mergear un PR y borrar su rama remota (buena
  práctica habitual), seguí trabajando sobre la copia local de esa misma rama para un commit
  posterior no relacionado — `git push` la recreó en GitHub como "nueva", lo cual generó confusión
  sobre qué PR correspondía a qué cambio. Se resolvió identificando el estado real con `gh pr view
  --json state,mergedAt` y `git log origin/main`, y llevando el commit suelto a una rama nueva y
  limpia con `git cherry-pick` en vez de reusar la rama vieja.
- **Trabajo migrado entre dos máquinas** (Mac → Windows → Mac) a mitad del TP: la configuración de
  `gh auth login` y Docker Desktop tuvo que rehacerse en la máquina Windows, y se confirmó la
  arquitectura (`AMD64`) antes de cualquier `docker pull`, ya que la Mac es Apple Silicon (ARM) y
  necesita `--platform linux/amd64` mientras que Windows no.

### 11. Declaración de uso de IA

Usé Claude para planificar las 5 fases del TP (cerrar la cadena, el CRUD de servicios como recurso
natural para las pruebas, las dos suites, el gate, la release), para diagnosticar cada problema real
a medida que apareció (`RENDER_GIT_COMMIT` ausente, las suites pisándose, el `502` del login, la
confusión de ramas), y para diseñar junto a mí qué tests entraban en cada suite y por qué. Claude
Code generó el código (el CRUD, los `data-testid`, los dos specs de Playwright, los cambios de
`ci.yml`) a partir de esos planes, y en varios casos encontró y corrigió solo problemas que yo no
había anticipado (el `workers: 1`, el riesgo de las dos suites en paralelo, el caso límite del
reintento del login). Puedo explicar qué verifica cada test de las dos suites, contra qué entorno
corre, y qué pasa si falla — lo hice en la práctica durante la demo de este mismo TP, diagnosticando
el fallo real con los reportes antes de arreglarlo.