#!/bin/sh
# Se ejecuta al levantar el contenedor de backend con Docker Compose.
# El schema ya lo crea Postgres solo (docker-entrypoint-initdb.d, ver
# docker-compose.yml). Aca cargamos los datos de demo (idempotente: no
# duplica nada si ya estan) y despues arrancamos la API.
set -e

echo "Cargando datos de demo (usuarios y servicios)..."
node src/db/seed.js

echo "Iniciando la API..."
exec node src/server.js
