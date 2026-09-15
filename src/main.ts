import { setDefaultResultOrder } from 'dns';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Some networks resolve Supabase's pooler hostname to an IPv6 address that
// isn't actually reachable, and Node can hang on that before ever trying the
// (working) IPv4 address, causing Prisma connection timeouts even though the
// database is reachable. Preferring IPv4 first avoids that race.
setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.get<string>('PORT') ?? 3001;
  await app.listen(port);
}

bootstrap();
