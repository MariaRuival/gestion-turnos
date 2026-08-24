-- Esquema minimo para la gestion de turnos.
-- Se ejecuta automaticamente al levantar el contenedor de Postgres (ver docker-compose.yml)
-- o manualmente con: psql -f backend/src/db/schema.sql

-- Necesaria para poder indexar columnas escalares junto con rangos (ver EXCLUDE mas abajo).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(120) NOT NULL,
    email          VARCHAR(160) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    rol            VARCHAR(20)  NOT NULL CHECK (rol IN ('cliente', 'admin')),
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servicios (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(120)   NOT NULL,
    duracion_minutos  INTEGER        NOT NULL CHECK (duracion_minutos > 0),
    precio            NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
    activo            BOOLEAN        NOT NULL DEFAULT true
);

-- Un turno pertenece a un usuario y agrupa uno o mas servicios (turno_servicios).
-- fecha_hora_fin y los totales se calculan en el backend a partir de los servicios
-- elegidos (regla de negocio #2), no se reciben del cliente.
CREATE TABLE IF NOT EXISTS turnos (
    id                       SERIAL PRIMARY KEY,
    usuario_id               INTEGER      NOT NULL REFERENCES usuarios(id),
    fecha_hora_inicio        TIMESTAMPTZ  NOT NULL,
    fecha_hora_fin           TIMESTAMPTZ  NOT NULL,
    duracion_total_minutos   INTEGER      NOT NULL,
    precio_total             NUMERIC(10, 2) NOT NULL,
    estado                   VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente', 'confirmado', 'completado', 'cancelado')),
    creado_en                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (fecha_hora_fin > fecha_hora_inicio),

    -- Regla de negocio #1, garantizada tambien a nivel de base de datos (a prueba de
    -- condiciones de carrera con dos inserts simultaneos): dos turnos "activos"
    -- (pendiente o confirmado) no pueden tener rangos de horario que se solapen.
    -- El chequeo "amigable" que devuelve un 409 con mensaje claro vive en
    -- src/models/turnoModel.js; esta constraint es la ultima linea de defensa.
    CONSTRAINT no_solapamiento_turnos EXCLUDE USING gist (
        tstzrange(fecha_hora_inicio, fecha_hora_fin, '[)') WITH &&
    ) WHERE (estado IN ('pendiente', 'confirmado'))
);

CREATE TABLE IF NOT EXISTS turno_servicios (
    turno_id     INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    servicio_id  INTEGER NOT NULL REFERENCES servicios(id),
    PRIMARY KEY (turno_id, servicio_id)
);

CREATE INDEX IF NOT EXISTS idx_turnos_usuario ON turnos (usuario_id);
