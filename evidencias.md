# Evidencias — TP2 Contenedores

## 1. Protección de rama funcionando

Intento de push directo a `main` (protegida por ruleset), rechazado con `GH013: Repository
rule violations found` / `Cannot update this protected ref` / `Changes must be made through
a pull request`.

[CAPTURA 1: terminal con el error GH013]

## 2. Sistema completo funcionando end-to-end

`docker compose up -d --build` levantando los 3 servicios (`postgres` healthy, `backend` y
`frontend` running), y la aplicación funcionando en `localhost:5173` logueada.

[CAPTURA 2: terminal con docker compose ps + navegador con la app funcionando]

## 3. Prueba de persistencia

Un turno creado sobrevive a `docker compose down` (sin `-v`) y desaparece con
`docker compose down -v`.

[CAPTURA 3a: turno creado, visible antes de bajar los contenedores]
[CAPTURA 3b: el mismo turno, todavía visible después de down + up]
[CAPTURA 3c: la lista vacía después de down -v + up]

## 4. Imágenes publicadas y públicas en ghcr.io

Las dos imágenes (`mi-backend`, `mi-frontend`) en tag `v0.1.0`, visibles en la pestaña
Packages del perfil de GitHub con visibilidad Public, y confirmado con un `docker pull`
exitoso después de `docker logout` (sin sesión activa).

[CAPTURA 4a: perfil de GitHub, Packages, ambas en Public]
[CAPTURA 4b: terminal con el docker pull exitoso post-logout]

## 5. Comparación de tamaño de imágenes

| Imagen | Tamaño |
|---|---|
| `node:20-alpine` (base de build, back y front) | 194MB |
| `nginx:1.27-alpine` (base final del frontend) | 75.9MB |
| `ghcr.io/mariaruival/mi-backend:v0.1.0` (imagen final) | 202MB |
| `ghcr.io/mariaruival/mi-frontend:v0.1.0` (imagen final) | 76.2MB |

La diferencia se nota fuerte en el frontend: la etapa de build carga Vite + todo
`node_modules` de desarrollo, pero la imagen final es casi enteramente `nginx:alpine` más
los estáticos compilados (+0.3MB sobre la base). En el backend la diferencia es mínima
porque no hay paso de compilación que descartar — ver el detalle en `decisiones.md`.

[CAPTURA 5: terminal con `docker images | grep -E 'mi-backend|mi-frontend|node|nginx'`]
