# USAMOS LA VERSIÓN ESTÁNDAR (Más compatible que Alpine)
FROM node:18 as build-stage

WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos (ahora sí debería funcionar sin errores raros)
RUN npm install

# Copiamos el resto del código
COPY . .

# Variables requeridas por Vite en tiempo de build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Compilamos la app
RUN npm run build

# --- Etapa 2: Nginx ---
FROM nginx:alpine as production-stage
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
