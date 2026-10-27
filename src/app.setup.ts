import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { RequestContext } from './common/request-context.js';
import type { Env } from './config/env.js';

/**
 * HTTP-level setup shared by main.ts and the e2e tests, so tests run against the same
 * headers, limits and prefixes as production.
 */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Client IPs (rate limits, logs) come from X-Forwarded-For only behind known proxies.
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');

  // Every request runs in its own context (tenant, language, request id); see
  // common/request-context.ts. A client-supplied X-Request-Id is kept if it looks sane.
  app.use((req: Request, res: Response, next: () => void) => {
    const given = req.headers['x-request-id'];
    const requestId =
      typeof given === 'string' && /^[\w.:-]{8,64}$/.test(given)
        ? given
        : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    RequestContext.run({ requestId }, next);
  });

  app.use(
    helmet({
      // JSON API: no HTML of its own except Swagger UI, which needs inline scripts.
      contentSecurityPolicy: false,
      // Product images are loaded by the frontend from another origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression({ threshold: 1024 }));
  app.useBodyParser('json', {
    limit: config.get('BODY_LIMIT', { infer: true }),
  });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });

  const origins = config.get('CORS_ORIGINS', { infer: true }) ?? [
    config.get('CORS_ORIGIN', { infer: true }),
  ];
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept-Language',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  app.useStaticAssets(path.resolve(config.get('UPLOAD_DIR', { infer: true })), {
    prefix: '/api/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    immutable: true,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  const swagger = config.get('SWAGGER_ENABLED', { infer: true });
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  if (swagger === 'true' || (swagger === undefined && !isProduction)) {
    const doc = new DocumentBuilder()
      .setTitle('PLC POS API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () =>
      SwaggerModule.createDocument(app, doc),
    );
  }
}
