import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Permite conexiones externas (útil para Docker/WSL)
    port: 5173,
    watch: {
      usePolling: true, // Necesario para Docker y algunos sistemas de archivos
    },
    hmr: {
      overlay: true, // Muestra errores en el navegador
    }
  }
})