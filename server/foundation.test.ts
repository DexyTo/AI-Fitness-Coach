import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { buildApp } from './app.js';
import { projectRoot, readConfig } from './config.js';
import { migrate, openDatabase } from './database.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'playfit-foundation-'));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function database() {
  const path = join(temporaryDirectory(), 'nested', 'test.sqlite');
  const db = openDatabase(path);
  cleanups.push(() => db.close());
  return { path, db };
}

describe('local configuration', () => {
  it('uses stable project-relative defaults and accepts explicit configuration', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 3001, databasePath: join(projectRoot, 'data/playfit.sqlite') });
    expect(readConfig({ API_PORT: '4100', DATABASE_PATH: 'data/other.sqlite' }).port).toBe(4100);
    expect(isAbsolute(readConfig({}).databasePath)).toBe(true);
  });
  it.each(['', '0', '-1', '65536', '3.5', '3001abc', ' 3001', 'Infinity'])('rejects invalid port %s', port => {
    expect(() => readConfig({ API_PORT: port })).toThrow('API_PORT');
  });
  it.each(['', ' ', ':memory:', 'bad\0path'])('rejects invalid database path', path => {
    expect(() => readConfig({ DATABASE_PATH: path })).toThrow('DATABASE_PATH');
  });
});

describe('SQLite migrations', () => {
  it('creates a clean database, enables FK/WAL and preserves data after reopen and rerun', () => {
    const { path, db } = database();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(migrate(db)).toEqual(['001_foundation.sql', '002_accounts.sql', '003_programs.sql', '004_builder.sql', '005_progression.sql']);
    db.prepare('INSERT INTO platform_metadata (key, value) VALUES (?, ?)').run('user-data', 'keep');
    const applied = db.prepare('SELECT * FROM schema_migrations').all();
    db.close();
    const reopened = openDatabase(path);
    cleanups.push(() => reopened.close());
    expect(migrate(reopened)).toEqual([]);
    expect(reopened.prepare('SELECT value FROM platform_metadata WHERE key = ?').get('user-data')).toEqual({ value: 'keep' });
    expect(reopened.prepare('SELECT * FROM schema_migrations').all()).toEqual(applied);
    reopened.exec('CREATE TABLE child (parent TEXT REFERENCES platform_metadata(key))');
    expect(() => reopened.prepare('INSERT INTO child VALUES (?)').run('absent')).toThrow(/FOREIGN KEY/);
  });
  it('rolls back pending DDL/data and ledger changes on failure without touching existing data', () => {
    const { db } = database();
    migrate(db);
    const directory = join(temporaryDirectory(), 'migrations');
    mkdirSync(directory);
    const first = readFileSync(join(projectRoot, 'server/migrations/001_foundation.sql'), 'utf8');
    for (const name of readdirSync(join(projectRoot,'server/migrations'))) writeFileSync(join(directory,name), readFileSync(join(projectRoot,'server/migrations',name)));
    writeFileSync(join(directory, '001_foundation.sql'), first);
    writeFileSync(join(directory, '006_pending.sql'), "CREATE TABLE pending (id INTEGER); INSERT INTO platform_metadata VALUES ('pending', 'no');");
    writeFileSync(join(directory, '007_broken.sql'), 'THIS IS NOT SQL;');
    expect(() => migrate(db, directory)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'pending'").get()).toBeUndefined();
    expect(db.prepare("SELECT value FROM platform_metadata WHERE key = 'pending'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, {version:3}, {version:4}, {version:5}]);
    expect(db.prepare("SELECT value FROM platform_metadata WHERE key = 'schema'").get()).toEqual({ value: 'foundation-v1' });
    writeFileSync(join(directory, '007_broken.sql'), 'CREATE TABLE another (id INTEGER);');
    expect(migrate(db, directory)).toEqual(['006_pending.sql', '007_broken.sql']);
    writeFileSync(join(directory, '001_foundation.sql'), first + '\n-- changed');
    expect(() => migrate(db, directory)).toThrow(/изменена/);
  });
  it('rejects duplicate migration versions without leaving a ledger behind', () => {
    const { db } = database();
    const directory = temporaryDirectory();
    writeFileSync(join(directory, '001_one.sql'), 'SELECT 1;');
    writeFileSync(join(directory, '001_two.sql'), 'SELECT 2;');
    expect(() => migrate(db, directory)).toThrow(/повторяется/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined();
  });
});

describe('API contract', () => {
  async function api() {
    const { db } = database();
    migrate(db);
    const app = buildApp(db);
    cleanups.push(() => app.close());
    return app;
  }
  it('checks the real database, validates query parameters and returns structured 404', async () => {
    const app = await api();
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok', database: 'ok', schemaVersion: 5 });
    const invalid = await app.inject('/api/health?password=do-not-echo');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toEqual({ code: 'INVALID_REQUEST', message: 'Некорректный запрос.', requestId: expect.any(String) });
    expect(invalid.body).not.toContain('do-not-echo');
    const missing = await app.inject('/api/unknown');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });
  it('sanitizes validation, malformed JSON, unexpected errors and oversized requests', async () => {
    const app = await api();
    app.post('/api/probe', { schema: { body: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 } }, additionalProperties: false } } }, async () => ({ ok: true }));
    app.get('/api/failure', async () => { throw new Error('password=private; Cookie=secret; stack details'); });
    for (const payload of [{ count: '1' }, { count: 0 }, { count: 1, password: 'private' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/probe', headers: { 'x-playfit-request':'1' }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private');
    }
    expect((await app.inject({ method: 'POST', url: '/api/probe', headers: { 'x-playfit-request':'1' }, payload: { count: 1 } })).statusCode).toBe(200);
    const malformed = await app.inject({ method: 'POST', url: '/api/probe', headers: { 'x-playfit-request':'1', 'content-type': 'application/json' }, payload: '{"password":private}' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('private');
    const failure = await app.inject('/api/failure');
    expect(failure.statusCode).toBe(500);
    expect(failure.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.', requestId: expect.any(String) });
    expect(failure.body).not.toMatch(/password|Cookie|stack|private/);
    const large = await app.inject({ method: 'POST', url: '/api/probe', headers: { 'x-playfit-request':'1' }, payload: { count: 1, data: 'x'.repeat(70_000) } });
    expect(large.statusCode).toBe(413);
    expect(large.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('does not report a healthy database when the query fails', async () => {
    const { db } = database();
    const app = buildApp(db);
    cleanups.push(() => app.close());
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/SQL|table|stack/);
  });
});
