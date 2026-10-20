import { readConfig } from './config.js';
import { migrate, openDatabase } from './database.js';
import { seedDemo } from './demoSeed.js';

const db = openDatabase(readConfig().databasePath);
try {
  migrate(db);
  console.log(seedDemo(db) ? 'Добавлены 12 вымышленных участников и учебные события. Открой /leaderboard?mode=demo.' : 'Эта учебная неделя уже наполнена. Данные и награды сохранены.');
} finally { db.close(); }
