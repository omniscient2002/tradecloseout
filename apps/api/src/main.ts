import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ProblemJsonExceptionFilter } from './common/filters/problem-json.filter';
import { VisibilityProjectionInterceptor } from './common/interceptors/visibility-projection.interceptor';
import { validateAuthenticationConfig } from './modules/identity/auth-security';

async function bootstrap() {
  validateAuthenticationConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(cookieParser());
  app.use(['/api/v1/auth', '/api/v1/guest'], (_req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
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
