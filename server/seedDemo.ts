import { readConfig } from './config.js';
import { migrate, configuredDatabase } from './database.js';
import { seedDemo } from './demoSeed.js';
const db = (await configuredDatabase(readConfig()));
try {
    (await migrate(db));
    console.log((await seedDemo(db)) ? 'Добавлены 12 вымышленных участников и учебные события. Открой /leaderboard?mode=demo.' : 'Эта учебная неделя уже наполнена. Данные и награды сохранены.');
}
finally {
    (await db.close());
}
