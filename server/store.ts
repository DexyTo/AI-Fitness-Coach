import { AsyncLocalStorage } from 'node:async_hooks';
import Sqlite from 'better-sqlite3';
import pg from 'pg';

type Transaction = { savepoint: number; query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; changes: number }> };
type Statement = {
  get: (...values: unknown[]) => Promise<unknown>;
  all: (...values: unknown[]) => Promise<unknown[]>;
  run: (...values: unknown[]) => Promise<{ changes: number }>;
};
const transactions = new AsyncLocalStorage<{ database: Database; transaction: Transaction }>();
// Different SQLite connections to the same file must not block each other's event loop.
const sqliteQueues = new Map<string, Promise<unknown>>();
const LOCK_ID = 746190321;

// The application uses a small, shared SQL subset. Bind markers are converted
// outside quoted SQL strings; values always travel separately through the driver.
export function postgresParameters(sql: string) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? `$${++index}` : token);
}

export class Database {
  private readonly pool?: pg.Pool;
  private readonly sqlite?: Sqlite.Database;
  private closing?: Promise<void>;
  readonly dialect: 'sqlite' | 'postgres';
  constructor(connection: Sqlite.Database | pg.Pool) {
    this.dialect = connection instanceof Sqlite ? 'sqlite' : 'postgres';
    if (connection instanceof Sqlite) this.sqlite = connection;
    else this.pool = connection;
  }
  get inTransaction() { return transactions.getStore()?.database === this; }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const key = this.sqlite!.name;
    const previous = sqliteQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    sqliteQueues.set(key, next);
    try { return await next; }
    finally { if (sqliteQueues.get(key) === next) sqliteQueues.delete(key); }
  }
  private async query(sql: string, values: unknown[] = []) {
    const context = transactions.getStore();
    if (context?.database === this) return context.transaction.query(sql, values);
    if (this.pool) {
      const result = await this.pool.query(postgresParameters(sql), values);
      return { rows: result.rows as unknown[], changes: result.rowCount ?? 0 };
    }
    return this.exclusive(async () => this.sqliteQuery(sql, values));
  }
  private sqliteQuery(sql: string, values: unknown[]) {
    const statement = this.sqlite!.prepare(sql);
    if (statement.reader) return { rows: statement.all(...values), changes: 0 };
    return { rows: [], changes: statement.run(...values).changes };
  }
  prepare(sql: string): Statement {
    return {
      get: async (...values) => (await this.query(sql, values)).rows[0],
      all: async (...values) => (await this.query(sql, values)).rows,
      run: async (...values) => ({ changes: (await this.query(sql, values)).changes }),
    };
  }
  async exec(sql: string) {
    const context = transactions.getStore();
    if (context?.database === this) { await context.transaction.query(sql); return; }
    if (this.pool) { await this.pool.query(sql); return; }
    await this.exclusive(async () => { this.sqlite!.exec(sql); });
  }
  // Only used by local SQLite diagnostics/tests, never by application queries.
  pragma(source: string, options?: { simple?: boolean }) {
    if (!this.sqlite) throw new Error('PRAGMA is available only with SQLite');
    return this.sqlite.pragma(source, options);
  }
  transaction<T>(work: () => T | Promise<T>) {
    const execute = async (): Promise<T> => {
      const context = transactions.getStore();
      if (context?.database === this) {
        const name = `nested_${++context.transaction.savepoint}`;
        await context.transaction.query(`SAVEPOINT ${name}`);
        try {
          const value = await work();
          await context.transaction.query(`RELEASE SAVEPOINT ${name}`);
          return value;
        } catch (error) {
          await context.transaction.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await context.transaction.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      }
      const run = async (): Promise<T> => {
        const client = this.pool ? await this.pool.connect() : undefined;
        const query: Transaction['query'] = async (sql, values = []) => {
          if (client) {
            const result = await client.query(postgresParameters(sql), values);
            return { rows: result.rows, changes: result.rowCount ?? 0 };
          }
          // exec supports multi-statement migrations and SQLite trigger bodies.
          if (!values.length) { this.sqlite!.exec(sql); return { rows: [], changes: 0 }; }
          return this.sqliteQuery(sql, values);
        };
        try {
          await query(this.pool ? 'BEGIN' : 'BEGIN IMMEDIATE');
          // A single small teaching app: serialize accounting across processes,
          // including daily caps, idempotency, duel finalization and migrations.
          if (client) await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
          const value = await transactions.run({ database: this, transaction: { savepoint: 0, query: async (sql, values) => {
            if (this.sqlite && values !== undefined) return this.sqliteQuery(sql, values);
            return query(sql, values);
          } } }, work);
          await query('COMMIT');
          return value;
        } catch (error) {
          try { await query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
          throw error;
        } finally { client?.release(); }
      };
      return this.sqlite ? this.exclusive(run) : run();
    };
    return Object.assign(execute, { immediate: execute });
  }
  async close() {
    this.closing ??= this.pool ? this.pool.end() : this.exclusive(async () => { if (this.sqlite!.open) this.sqlite!.close(); });
    await this.closing;
  }
}

export function postgresDatabase(url: string) {
  // COUNT/SUM/RANK return int8. The platform only exposes safe integer counts.
  const types = new pg.TypeOverrides();
  types.setTypeParser(20, (value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range');
    return number;
  });
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000, types });
  pool.on('error', () => { console.error('Соединение с PostgreSQL прервано; следующий запрос создаст новое.'); });
  return new Database(pool);
}
