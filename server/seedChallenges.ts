import { readConfig } from './config.js';
import { migrate, configuredDatabase } from './database.js';
import { seedChallenges } from './challengeSeed.js';
const db = (await configuredDatabase(readConfig()));
try {
    (await migrate(db));
    console.log(`Добавлено учебных испытаний: ${(await seedChallenges(db))}. Условия прежних участий и результаты сохранены.`);
}
finally {
    (await db.close());
}
