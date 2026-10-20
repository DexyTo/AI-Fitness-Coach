import { readConfig } from './config.js';
import { migrate, openDatabase } from './database.js';
import { seedChallenges } from './challengeSeed.js';

const db = openDatabase(readConfig().databasePath);
try {
  migrate(db);
  console.log(`Добавлено учебных испытаний: ${seedChallenges(db)}. Условия прежних участий и результаты сохранены.`);
} finally { db.close(); }
