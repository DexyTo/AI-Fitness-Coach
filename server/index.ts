import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { migrate, openDatabase } from './database.js';

async function main() {
  const config = readConfig();
  const db = openDatabase(config.databasePath);
  try { migrate(db); } catch (error) { db.close(); throw error; }
  const app = buildApp(db, {
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try { await app.listen({ port: config.port, host: config.host }); }
  catch (error) { await app.close(); throw error; }
}

main().catch(() => {
  console.error('Не удалось запустить API. Проверьте API_PORT, DATABASE_PATH, доступ к БД и миграции.');
  process.exitCode = 1;
});
