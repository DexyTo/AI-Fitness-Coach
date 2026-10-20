import { readConfig } from './config.js';
import { migrate, openDatabase } from './database.js';

try {
  const db = openDatabase(readConfig().databasePath);
  try {
    const applied = migrate(db);
    console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Все миграции уже применены.');
  } finally { db.close(); }
} catch {
  console.error('Не удалось применить миграции. Проверьте конфигурацию, файлы миграций и доступ к БД.');
  process.exitCode = 1;
}
