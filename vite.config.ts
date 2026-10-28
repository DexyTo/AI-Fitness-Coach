import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readConfig } from './server/config';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  // Vite sets NODE_ENV=production during build; proxy only needs local API settings.
  const config = readConfig({ API_PORT: env.API_PORT, DATABASE_PATH: env.DATABASE_PATH });
  const proxy = { '/api': { target: `http://${config.host}:${config.port}` } };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    build: { rollupOptions: { input: { app: 'index.html', validation: 'validation.html' } } },
  };
});
