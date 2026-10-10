# ---- Etapa 1: instalar dependencias (capa cacheable) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- Etapa: tests (con devDependencies, no se usa en runtime) ----
FROM node:20-alpine AS test
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ENTRYPOINT ["npm", "run", "test:coverage"]

# ---- Etapa 2: runtime (imagen final, sin restos de la instalacion) ----
FROM node:20-alpine AS final
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chmod +x entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["./entrypoint.sh"]