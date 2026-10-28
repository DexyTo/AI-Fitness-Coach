import { readConfig } from './config.js';
import { migrate, configuredDatabase } from './database.js';
try {
    const db = (await configuredDatabase(readConfig()));
    try {
        const applied = (await migrate(db));
        console.log(applied.length ? `Применены миграции: ${applied.join(', ')}` : 'Все миграции уже применены.');
    }
    finally {
        (await db.close());
    }
}
catch {
    console.error('Не удалось применить миграции. Проверьте конфигурацию, файлы миграций и доступ к БД.');
    process.exitCode = 1;
}
