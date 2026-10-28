import { goalSchemaDefinition, workoutSchemaDefinition } from './workoutSchema.js';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Database } from './database.js';
import { ApiError, registerAccounts } from './accounts.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { projectRoot } from './config.js';

export interface AppOptions { production?: boolean; publicOrigin?: string; staticRoot?: string }
export function buildApp(db: Database, logger: FastifyServerOptions['logger'] = false, options: AppOptions = {}) {
    const app = Fastify({
        logger,
        trustProxy: options.production ? (_address: string, hop: number) => hop === 0 : false,
        bodyLimit: 64 * 1024,
        ajv: { customOptions: { removeAdditional: false, coerceTypes: false, inlineRefs: false } },
    });
    app.addSchema(goalSchemaDefinition);
    app.addSchema(workoutSchemaDefinition);
    app.addHook('onClose', async () => { (await db.close()); });
    app.setErrorHandler((error, request, reply) => {
        const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
        const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
        if (status >= 500)
            request.log.error({ err: error }, 'API request failed');
        const code = status === 400 ? 'INVALID_REQUEST' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
        const message = status === 400 ? 'Некорректный запрос.' : status === 413 ? 'Слишком большой запрос.' : status === 415 ? 'Неподдерживаемый формат запроса.' : status >= 500 ? 'Внутренняя ошибка сервера.' : 'Запрос отклонён.';
        void reply.status(status).send({ error: { code: error instanceof ApiError ? error.code : code, message: error instanceof ApiError ? error.message : message, requestId: request.id } });
    });
    app.setNotFoundHandler((request, reply) => {
        const path = request.url.split('?')[0];
        if (options.staticRoot && ['GET', 'HEAD'].includes(request.method) && path !== '/api' && !path.startsWith('/api/') && !extname(path) && !path.split('/').some(segment => segment.startsWith('.'))) {
            return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
        }
        void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Маршрут API не найден.', requestId: request.id } });
    });
    if (options.staticRoot) {
        if (!existsSync(join(options.staticRoot, 'index.html'))) throw new Error('Сначала выполните npm run build.');
        app.register(fastifyStatic, {
            root: options.staticRoot,
            cacheControl: false,
            // Root is always an explicit build directory, never the repository.
            setHeaders(response, path) {
                response.header('X-Content-Type-Options', 'nosniff');
                response.header('Cache-Control', path.startsWith(join(options.staticRoot!, 'assets') + '/') || path.startsWith(join(options.staticRoot!, 'assets') + '\\') ? 'public, max-age=31536000, immutable' : path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
            },
        });
    }
    app.get('/api/health', {
        schema: {
            querystring: { type: 'object', properties: {}, additionalProperties: false },
            response: { 200: {
                    type: 'object', required: ['status', 'database', 'schemaVersion'], additionalProperties: false,
                    properties: { status: { const: 'ok' }, database: { const: 'ok' }, schemaVersion: { type: 'integer' } },
                } },
        },
    }, async () => {
        const row = (await db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()) as {
            version: number;
        };
        return { status: 'ok', database: 'ok', schemaVersion: row.version };
    });
    registerAccounts(app, db, options);
    return app;
}

export const clientBuildRoot = join(projectRoot, 'dist');
