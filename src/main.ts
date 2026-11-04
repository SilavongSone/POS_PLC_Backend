import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Body parsers are registered in configureApp with explicit size limits.
    bodyParser: false,
    // Webhooks verify signatures over the exact bytes received (req.rawBody).
    rawBody: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}
await bootstrap();
