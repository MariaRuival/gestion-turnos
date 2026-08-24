# Decisiones de diseno

Este documento explica como esta organizado el codigo y, sobre todo, **donde vive
cada una de las 5 reglas de negocio pedidas**, para poder explicarlo despues sin
tener que releer todo el proyecto.

## Organizacion general

```
backend/src/
├── server.js            arranca el proceso, valida env vars obligatorias
├── app.js                arma la app de Express (middlewares, rutas, error handler)
├── config/db.js          pool de conexion a Postgres (lee TODO de variables de entorno)
├── db/
│   ├── schema.sql         tablas, constraints, la regla de no-solapamiento a nivel DB
│   └── seed.js            usuarios y servicios de demo
├── models/                una funcion por consulta SQL, sin logica de negocio
│   ├── usuarioModel.js
│   ├── servicioModel.js
│   └── turnoModel.js       incluye la transaccion de creacion de turno
├── controllers/            reciben el request, aplican las reglas de negocio,
│   ├── authController.js    llaman al model, devuelven la respuesta
│   ├── servicioController.js
│   └── turnoController.js   <- ES EL ARCHIVO MAS IMPORTANTE DEL BACKEND
├── middleware/
│   ├── auth.js              valida el JWT y el rol (cliente/admin)
│   └── errorHandler.js      unico lugar que formatea errores como JSON
├── routes/                  mapeo URL -> controller, con los middlewares de permisos
└── utils/turnoRules.js      <- funciones PURAS de negocio (sin DB, sin Express)

frontend/src/
├── pages/                   Login.jsx, ClienteView.jsx, AdminView.jsx (las 3 pantallas)
├── components/               piezas reutilizables (tarjeta de turno, checklist de servicios)
├── context/AuthContext.jsx   guarda el usuario/token logueado (localStorage)
└── api/client.js             unico lugar que hace fetch() a la API
```

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
