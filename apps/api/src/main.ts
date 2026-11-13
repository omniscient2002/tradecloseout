import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ProblemJsonExceptionFilter } from './common/filters/problem-json.filter';
import { securityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { requestCorrelationMiddleware } from './common/middleware/request-correlation.middleware';
import { VisibilityProjectionInterceptor } from './common/interceptors/visibility-projection.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(requestCorrelationMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemJsonExceptionFilter());
  app.enableCors({
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true,
  });

  const port = process.env.API_PORT || process.env.PORT || 3001;
  await app.listen(port);
  console.log(`TradeCloseout API is running on http://localhost:${port}`);
}

bootstrap();
