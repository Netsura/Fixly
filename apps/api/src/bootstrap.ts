import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { env } from '@fixly/config';
import { CSRF_HEADER } from './common/csrf';

/**
 * Middleware, CORS, and validation setup shared by the server entrypoint and
 * the integration tests, so tests exercise the same request pipeline that
 * production runs.
 */
export function configureApp(app: INestApplication) {
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', CSRF_HEADER],
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
  return app;
}
