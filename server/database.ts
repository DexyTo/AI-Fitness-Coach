import Sqlite from 'better-sqlite3';
import { Database, postgresDatabase } from './store.js';
export { Database } from './store.js';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot, type AppConfig } from './config.js';
export async function openDatabase(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Sqlite(path);
    try {
        db.pragma('foreign_keys = ON');
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        return new Database(db);
    }
    catch (error) {
        (await db.close());
        throw error;
    }
}
export async function configuredDatabase(config: AppConfig) {
    return config.databaseUrl ? postgresDatabase(config.databaseUrl) : (await openDatabase(config.databasePath));
}
// All pending migrations and their ledger entries commit together, or roll back.
export async function migrate(db: Database, directory = join(projectRoot, db.dialect === 'postgres' ? 'server/migrations/postgres' : 'server/migrations')) {
    return (await db.transaction(async () => {
        (await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`));
        const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
        const migrations = files.map(name => {
            if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name))
                throw new Error(`Некорректное имя миграции: ${name}`);
            const sql = readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n');
            return { version: Number(name.slice(0, 3)), name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
        });
        if (new Set(migrations.map(item => item.version)).size !== migrations.length)
            throw new Error('Номер миграции повторяется.');
        const applied = (await db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all()) as {
            version: number;
            name: string;
            checksum: string;
        }[];
        for (const previous of applied) {
            const source = migrations.find(item => item.version === previous.version);
            if (!source || source.name !== previous.name || source.checksum !== previous.checksum) {
                throw new Error(`Применённая миграция ${previous.version} изменена или отсутствует.`);
            }
        }
        const pending = migrations.filter(item => !applied.some(previous => previous.version === item.version));
        const lastVersion = applied.at(-1)?.version ?? 0;
        if (pending.some(item => item.version <= lastVersion))
            throw new Error('Новая миграция должна идти после применённых версий.');
        const insert = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
        for (const item of pending) {
            (await db.exec(item.sql));
            (await insert.run(item.version, item.name, item.checksum, new Date().toISOString()));
        }
        return pending.map(item => item.name);
    }).immediate());
}
