# Gestión de Turnos — Sistema de reservas

Aplicacion web para gestionar turnos de un negocio chico (peluqueria, consultorio, etc.).
Un cliente reserva turnos eligiendo servicio(s), fecha y hora; un admin ve todos los
turnos y los confirma o marca como completados.

**Stack:** Node.js + Express (API REST) · React + Vite (frontend) · PostgreSQL.

Para el detalle de como esta organizado el codigo y donde vive cada regla de negocio,
ver [decisiones.md](./decisiones.md).

## Estructura del repo

```
gestion-turnos/
├── backend/          API REST (Express)
├── frontend/          SPA (React + Vite)
├── docker-compose.yml  levanta los 3 servicios (postgres, backend, frontend)
└── .env.example        variables para docker-compose
```

## Usuarios de demo

Se cargan automaticamente (con Docker) o con `npm run seed` (sin Docker):

| Rol     | Email               | Contrasena  |
|---------|----------------------|-------------|
| admin   | admin@negocio.com    | Admin123!   |
| cliente | cliente1@mail.com    | Cliente123! |
| cliente | cliente2@mail.com    | Cliente123! |

Un cliente nuevo tambien se puede registrar solo desde la pantalla de login.

---

## Opcion A: correr todo con Docker (recomendado)

Requisitos: Docker y Docker Compose.

```bash
# desde la raiz del repo
cp .env.example .env
docker compose up --build
```

Esto levanta 3 contenedores: `postgres` (con el schema ya creado), `backend`
(que ademas carga los usuarios/servicios de demo al arrancar) y `frontend`
(build de produccion servido con nginx).

- Frontend: http://localhost:5173
- API: http://localhost:4000/api

Para bajar los contenedores:

```bash
docker compose down          # conserva los datos de Postgres
docker compose down -v       # borra tambien el volumen de datos
```

---

## Opcion B: correr sin Docker

Requisitos: Node.js 18+, PostgreSQL 14+ corriendo en tu maquina.

### 1. Crear la base de datos y el esquema

```bash
createdb gestion_turnos
psql -d gestion_turnos -f backend/src/db/schema.sql
```

(Ajusta usuario/host segun tu instalacion de Postgres, ej. `psql -U postgres -h localhost -d gestion_turnos -f backend/src/db/schema.sql`)

### 2. Backend

```bash
cd backend
cp .env.example .env
# editar .env con los datos de conexion a tu Postgres local (PGHOST, PGUSER, etc.)
npm install
npm run seed      # carga usuarios y servicios de demo (opcional pero recomendado)
npm run dev       # levanta la API en http://localhost:4000 con recarga automatica
```

Para produccion (sin recarga automatica): `npm start`.

### 3. Frontend

En otra terminal:

```bash
cd frontend
cp .env.example .env   # solo necesario si el backend no corre en http://localhost:4000
npm install
npm run dev
```

Abrir http://localhost:5173

### 4. Build de produccion del frontend (sin Docker)

```bash
cd frontend
npm run build           # genera frontend/dist
npm run preview         # sirve ese build en http://localhost:4173
```

---

## Variables de entorno

Ningun secreto ni cadena de conexion esta hardcodeado: todo se lee via `dotenv`
desde variables de entorno.

- `backend/.env.example` → conexion a Postgres, puerto de la API, `JWT_SECRET`, CORS.
- `frontend/.env.example` → `VITE_API_URL`, la URL de la API que consume el navegador.
- `.env.example` (raiz) → variables que usa `docker-compose.yml` para levantar los 3 servicios.

## API (resumen)

| Metodo | Ruta                        | Quien             | Que hace                                  |
|--------|-----------------------------|--------------------|--------------------------------------------|
| POST   | /api/auth/login              | publico            | Login, devuelve JWT                       |
| POST   | /api/auth/registro           | publico            | Alta de un cliente nuevo                  |
| GET    | /api/servicios                | autenticado        | Lista de servicios activos                |
| POST   | /api/turnos                   | cliente            | Crea un turno propio                      |
| GET    | /api/turnos/mios              | cliente            | Lista los turnos propios                  |
| GET    | /api/turnos                   | admin              | Lista todos los turnos del negocio        |
| PATCH  | /api/turnos/:id/cancelar      | cliente (lo suyo) / admin | Cancela un turno                    |
| PATCH  | /api/turnos/:id/confirmar     | admin               | pendiente → confirmado                    |
| PATCH  | /api/turnos/:id/completar     | admin               | confirmado → completado                   |

## Troubleshooting

- **El backend no arranca / "Faltan variables de entorno obligatorias"**: falta `JWT_SECRET`
  en `backend/.env`. Copia `backend/.env.example` a `.env` y completa los valores.
- **El frontend no encuentra la API**: revisa `VITE_API_URL` en `frontend/.env` (o en el
  `.env` de la raiz si usas Docker) — debe apuntar al puerto publicado del backend.
- **Error de conexion a Postgres**: confirma que el servicio/proceso de Postgres este
  corriendo y que `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` en `backend/.env`
  coincidan con tu instancia.

