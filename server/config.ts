import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const projectRoot = fileURLToPath(new URL(import.meta.url.includes('/.server-build/') ? '../../' : '../', import.meta.url));

export function readConfig(env: Record<string, string | undefined> = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = env.PORT ?? env.API_PORT ?? '3001';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('API_PORT должен быть целым числом от 1 до 65535.');
  }
  const databasePath = env.DATABASE_PATH ?? 'data/playfit.sqlite';
  if (!databasePath.trim() || databasePath.includes('\0') || databasePath === ':memory:') {
    throw new Error('DATABASE_PATH должен указывать на файл SQLite.');
  }
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl !== undefined) {
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
      if (production && !['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) throw new Error();
    } catch { throw new Error('DATABASE_URL должен быть PostgreSQL URL; в production требуется sslmode=require или verify-full.'); }
  }
  if (production && !databaseUrl) throw new Error('Для production требуется DATABASE_URL: локальная SQLite не сохраняется на Render Free.');
  let publicOrigin: string | undefined;
  const origin = env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL;
  if (origin !== undefined) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || (production ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) throw new Error();
      publicOrigin = url.origin;
    } catch { throw new Error('PUBLIC_ORIGIN должен содержать адрес приложения без пути; в production требуется HTTPS.'); }
  }
  if (production && !publicOrigin) throw new Error('Для production требуется PUBLIC_ORIGIN — HTTPS-адрес приложения.');
  return { host: production ? '0.0.0.0' : '127.0.0.1', port: Number(port), databasePath: resolve(projectRoot, databasePath), databaseUrl, production, publicOrigin };
}

export type AppConfig = ReturnType<typeof readConfig>;
