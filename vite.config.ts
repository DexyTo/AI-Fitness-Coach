import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readConfig } from './server/config';
export default defineConfig(({ mode }) => {
  const config = readConfig({ ...loadEnv(mode, process.cwd(), ''), ...process.env });
  const proxy = { '/api': { target: `http://${config.host}:${config.port}` } };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    build: { rollupOptions: { input: { app: 'index.html', validation: 'validation.html' } } },
  };
});
