# --- Etapa 1: build de la SPA con Vite ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# Vite "hornea" las variables VITE_* en el bundle en tiempo de build, no en
# runtime. Como el navegador (fuera de Docker) es quien hace los fetch a la
# API, por defecto apunta al puerto de backend publicado en localhost.
ARG VITE_API_URL=http://localhost:4000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- Etapa 2: servir los estaticos con nginx ---
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
