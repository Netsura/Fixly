import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { env } from '@fixly/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    bodyParser: false,
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: env.NODE_ENV === 'production',
  }));
  app.use(json({ limit: '1mb', verify: (req, _res, buf) => {
    (req as { rawBody?: Buffer }).rawBody = buf;
  } }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = env.PORT;
  await app.listen(port);
  Logger.log(`API listening on ${port}`, 'Bootstrap');
}
bootstrap();
