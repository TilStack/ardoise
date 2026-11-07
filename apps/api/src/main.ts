import 'reflect-metadata';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config';

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  // rawBody : indispensable pour vérifier la signature HMAC des webhooks sur le corps exact reçu.
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  app.enableCors();
  const cfg = app.get<AppConfig>(APP_CONFIG);
  await app.listen(cfg.port);
  Logger.log(`API L'Ardoise sur :${cfg.port} (paiement : ${cfg.paymentProvider})`, 'Bootstrap');
}

if (require.main === module) {
  void bootstrap();
}
