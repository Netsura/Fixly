import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from '@fixly/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    bodyParser: false,
  });

  configureApp(app);

  const port = env.PORT;
  await app.listen(port);
  Logger.log(`API listening on ${port}`, 'Bootstrap');
}
bootstrap();
