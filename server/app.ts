import Fastify, { type FastifyServerOptions } from 'fastify';
import type Database from 'better-sqlite3';
import { ApiError, registerAccounts } from './accounts.js';

export function buildApp(db: Database.Database, logger: FastifyServerOptions['logger'] = false) {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.addHook('onClose', async () => { db.close(); });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'API request failed');
    const code = status === 400 ? 'INVALID_REQUEST' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    const message = status === 400 ? 'Некорректный запрос.' : status === 413 ? 'Слишком большой запрос.' : status === 415 ? 'Неподдерживаемый формат запроса.' : status >= 500 ? 'Внутренняя ошибка сервера.' : 'Запрос отклонён.';
    void reply.status(status).send({ error: { code: error instanceof ApiError ? error.code : code, message: error instanceof ApiError ? error.message : message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Маршрут API не найден.', requestId: request.id } });
  });
  app.get('/api/health', {
    schema: {
      querystring: { type: 'object', properties: {}, additionalProperties: false },
      response: { 200: {
        type: 'object', required: ['status', 'database', 'schemaVersion'], additionalProperties: false,
        properties: { status: { const: 'ok' }, database: { const: 'ok' }, schemaVersion: { type: 'integer' } },
      } },
    },
  }, async () => {
    const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
    return { status: 'ok', database: 'ok', schemaVersion: row.version };
  });
  registerAccounts(app, db);
  return app;
}
