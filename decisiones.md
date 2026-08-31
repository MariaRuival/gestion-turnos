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
