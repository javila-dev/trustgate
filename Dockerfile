# USAMOS LA VERSIÓN ESTÁNDAR (Más compatible que Alpine)
FROM node:18 as build-stage

WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos (ahora sí debería funcionar sin errores raros)
RUN npm install

# Copiamos el resto del código
COPY . .

# Compilamos la app
RUN npm run build

# --- Etapa 2: Nginx ---
FROM nginx:alpine as production-stage
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
