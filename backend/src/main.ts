import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { join } from 'path';
import { mkdirSync } from 'fs';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? false : '*',
  });

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const expressApp = app.getHttpAdapter().getInstance() as express.Application;
  // Serve admin panel at /admin (unaffected by global prefix)
  expressApp.use('/admin', express.static(join(__dirname, '..', 'admin-panel')));
  // Serve uploaded files at /uploads
  expressApp.use('/uploads', express.static(uploadsDir));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Yala Nsafr API running on http://localhost:${port}/api/v1`);
  console.log(`Admin panel at http://localhost:${port}/admin`);
}

bootstrap();
