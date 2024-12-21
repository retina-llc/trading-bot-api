import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS with specific configurations
  app.enableCors({
    origin: 'http://localhost:5000', // Frontend origin
    credentials: true, // Allow cookies and authorization headers
  });

  // Use cookie-parser middleware
  app.use(cookieParser());

  // Use express-session middleware (only if required)
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'your_session_secret', // Replace with a strong secret
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Ensure cookies are secure in production
        maxAge: 1000 * 60 * 60, // 1 hour
        sameSite: 'none', // Allow cross-origin requests
      },
    }),
  );
  

  await app.listen(3000);
  console.log('Backend server is running on http://localhost:3000');
}
bootstrap();
