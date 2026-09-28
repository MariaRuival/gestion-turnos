import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv (a diferencia de import.meta.env) tambien lee el .env desde este
  // archivo de config, que corre en Node antes de que exista el cliente.
  const env = loadEnv(mode, process.cwd(), '');

  // Fuera de Docker (npm run dev / npm run preview) no hay nginx haciendo de
  // proxy, asi que armamos el mismo /api -> backend aca a nivel de Vite, para
  // que el cliente HTTP pueda seguir usando la URL relativa /api en todos los
  // modos de ejecucion.
  const proxyApi = {
    '/api': {
      target: env.VITE_BACKEND_URL || 'http://localhost:4000',
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: proxyApi,
    },
    preview: {
      host: true,
      port: 4173,
      proxy: proxyApi,
    },
  };
});
