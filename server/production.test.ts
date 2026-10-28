import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { readConfig } from './config.js';
import { postgresParameters } from './store.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe('production deployment', () => {
  const production = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:password@db.example/test?sslmode=verify-full', RENDER_EXTERNAL_URL: 'https://playfit.onrender.com' };
  it('uses Render PORT/origin and refuses ephemeral storage or insecure/malformed configuration', () => {
    expect(readConfig({ ...production, PORT: '10000', API_PORT: '3001' })).toMatchObject({ host: '0.0.0.0', port: 10000, production: true, publicOrigin: production.RENDER_EXTERNAL_URL });
    expect(readConfig({ ...production, PUBLIC_ORIGIN: 'https://fitness.example' }).publicOrigin).toBe('https://fitness.example');
    for (const databaseUrl of ['', 'file:./data.sqlite', 'https://db.example', 'postgresql://db.example/test', 'postgresql://db.example/test?sslmode=disable']) {
      expect(() => readConfig({ ...production, DATABASE_URL: databaseUrl })).toThrow('DATABASE_URL');
    }
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
    for (const origin of ['http://playfit.example', 'https://playfit.example/', 'https://playfit.example/path', 'https://user:secret@playfit.example']) expect(() => readConfig({ ...production, PUBLIC_ORIGIN: origin })).toThrow('PUBLIC_ORIGIN');
    expect(() => readConfig({ ...production, RENDER_EXTERNAL_URL: undefined })).toThrow('PUBLIC_ORIGIN');
    expect(() => readConfig({ ...production, PORT: 'not-a-port' })).toThrow();
    expect(readConfig({ DATABASE_URL: 'postgresql://localhost/local' }).production).toBe(false);
  });

  it('binds PostgreSQL values without rewriting question marks inside quoted strings/identifiers', () => {
    expect(postgresParameters(`SELECT '?' AS "?", 'it''s ?' WHERE a=? AND b=?`)).toBe(`SELECT '?' AS "?", 'it''s ?' WHERE a=$1 AND b=$2`);
  });

  it('serves SPA URLs, WASM/model/audio and cache headers while keeping API errors and private files outside the build root', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'playfit-static-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const root = join(directory, 'dist');
    for (const part of ['', 'assets', 'wasm', 'models', 'audio/ru']) mkdirSync(join(root, part), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>PlayFit</title><div id="root"></div>');
    writeFileSync(join(root, 'assets/app-ab123.js'), 'console.log("PlayFit")');
    writeFileSync(join(root, 'wasm/vision.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    writeFileSync(join(root, 'models/pose.task'), Buffer.from('model-test'));
    writeFileSync(join(root, 'audio/ru/test.wav'), Buffer.from('RIFFtestWAVE'));
    writeFileSync(join(directory, '.env'), 'DATABASE_URL=secret-do-not-serve');
    const db = await openDatabase(join(directory, 'test.sqlite')); await migrate(db);
    const app = buildApp(db, false, { staticRoot: root, production: true, publicOrigin: 'https://playfit.onrender.com' });
    cleanups.push(() => app.close());
    for (const path of ['/', '/overview', '/login', '/programs/squat-pushup', '/history/result-id']) {
      const response = await app.inject(path);
      expect(response.statusCode, path).toBe(200); expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-cache'); expect(response.body).toContain('PlayFit');
    }
    const asset = await app.inject('/assets/app-ab123.js');
    expect(asset.statusCode).toBe(200); expect(asset.headers['cache-control']).toContain('immutable');
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    const wasm = await app.inject('/wasm/vision.wasm'); expect(wasm.headers['content-type']).toBe('application/wasm'); expect(wasm.rawPayload).toHaveLength(8);
    for (const path of ['/models/pose.task', '/audio/ru/test.wav']) expect((await app.inject(path)).statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: '/overview' })).statusCode).toBe(200);
    expect((await app.inject('/api/health')).json()).toMatchObject({ database: 'ok', schemaVersion: 10 });
    for (const path of ['/api', '/api/missing', '/assets/missing.js', '/.env', '/test.sqlite', '/server/config.ts', '/%2e%2e/.env']) {
      const response = await app.inject(path); expect(response.statusCode, path).toBe(404); expect(response.body).not.toContain('secret-do-not-serve');
      expect(response.headers['content-type']).not.toContain('text/html');
    }
    expect((await app.inject('/api/missing')).json().error.code).toBe('NOT_FOUND');
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'x-playfit-request': '1', origin: 'https://playfit.onrender.com', 'x-forwarded-proto': 'https' }, payload: { login: 'teacher', password: 'Teacher-2026' } });
    expect(register.statusCode, register.body).toBe(201); expect(register.headers['set-cookie']).toContain('; Secure');
  });
});
