import { readConfig } from './config.js';
import { migrate, configuredDatabase } from './database.js';
import { seedDemo } from './demoSeed.js';
const db = (await configuredDatabase(readConfig()));
try {
    (await migrate(db));
    console.log(await seedDemo(db)
        ? 'Учебные данные обновлены. Войди как demo_01 и открой «Мой прогресс».'
        : 'Учебная история и соревнования уже заполнены. Данные и награды сохранены.');
}
finally {
    (await db.close());
}
