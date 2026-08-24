# Evidencias — TP2 Contenedores

## 1. Protección de rama funcionando

Intento de push directo a `main` (protegida por ruleset), rechazado con `GH013: Repository
rule violations found` / `Cannot update this protected ref` / `Changes must be made through
a pull request`.

<img width="1436" height="840" alt="image" src="https://github.com/user-attachments/assets/51141751-5888-47c8-9545-cb19bf5198ca" />


## 2. Sistema completo funcionando end-to-end

`docker compose up -d --build` levantando los 3 servicios (`postgres` healthy, `backend` y
`frontend` running), y la aplicación funcionando en `localhost:5173` logueada.

<img width="1280" height="695" alt="image" src="https://github.com/user-attachments/assets/591686d1-feb1-4b00-b193-f85fd99510b7" />
<img width="1600" height="818" alt="image" src="https://github.com/user-attachments/assets/9b94ca9a-fb7a-4048-9dab-5259c629c221" />



## 3. Prueba de persistencia

Un turno creado sobrevive a `docker compose down` (sin `-v`) y desaparece con
`docker compose down -v`.

<img width="1600" height="774" alt="image" src="https://github.com/user-attachments/assets/aa744488-0751-45fb-ba66-7940e35735c8" />

<img width="1600" height="875" alt="image" src="https://github.com/user-attachments/assets/792bd822-b966-4d97-b048-3b16a6e47d47" />


## 4. Imágenes publicadas y públicas en ghcr.io

Las dos imágenes (`mi-backend`, `mi-frontend`) en tag `v0.1.0`, visibles en la pestaña
Packages del perfil de GitHub con visibilidad Public, y confirmado con un `docker pull`
exitoso después de `docker logout` (sin sesión activa).

<img width="1600" height="400" alt="image" src="https://github.com/user-attachments/assets/a8c10440-9162-40df-9615-daface2bf458" />

<img width="1600" height="434" alt="image" src="https://github.com/user-attachments/assets/3b709809-ec5d-4e04-8298-a1f53654dac8" />


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

<img width="1568" height="98" alt="image" src="https://github.com/user-attachments/assets/c1cdee5a-5e49-4515-8668-3d0bfc4be57a" />

