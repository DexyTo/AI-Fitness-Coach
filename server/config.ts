import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const projectRoot = fileURLToPath(new URL(import.meta.url.includes('/.server-build/') ? '../../' : '../', import.meta.url));

export function readConfig(env: Record<string, string | undefined> = process.env) {
  const port = env.API_PORT ?? '3001';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('API_PORT должен быть целым числом от 1 до 65535.');
  }
  const databasePath = env.DATABASE_PATH ?? 'data/playfit.sqlite';
  if (!databasePath.trim() || databasePath.includes('\0') || databasePath === ':memory:') {
    throw new Error('DATABASE_PATH должен указывать на файл SQLite.');
  }
  return { host: '127.0.0.1', port: Number(port), databasePath: resolve(projectRoot, databasePath) };
}
