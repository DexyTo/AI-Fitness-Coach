import { buildApp, clientBuildRoot } from './app.js';
import { readConfig } from './config.js';
import { migrate, configuredDatabase } from './database.js';
async function main() {
    const config = readConfig();
    const db = await configuredDatabase(config);
    try {
        (await migrate(db));
    }
    catch (error) {
        (await db.close());
        throw error;
    }
    const app = buildApp(db, {
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    }, { production: config.production, publicOrigin: config.publicOrigin, staticRoot: config.production || process.argv.includes('--serve-client') ? clientBuildRoot : undefined });
    let closing = false;
    const close = async () => {
        if (closing)
            return;
        closing = true;
        try {
            await app.close();
        }
        catch {
            process.exitCode = 1;
        }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    try {
        await app.listen({ port: config.port, host: config.host });
    }
    catch (error) {
        await app.close();
        throw error;
    }
}
main().catch(() => {
    console.error('Не удалось запустить приложение. Проверьте PORT/API_PORT, DATABASE_URL или DATABASE_PATH, PUBLIC_ORIGIN, сборку и доступ к БД.');
    process.exitCode = 1;
});
