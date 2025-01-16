import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Use CORS with credentials disabled (to mimic incognito behavior)
  const corsOptions = {
    origin: 'https://tradingbot.ascarinet.com', // Your frontend's origin
    credentials: false, // Disable sending credentials like cookies
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  };
  app.enableCors(corsOptions);
  console.log('CORS Configuration:', corsOptions);

  // Disable caching for every response
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // (Optional) Remove cookie-parser/session middleware if not required
  // If your service does not depend on session cookies, you can remove these
  // Otherwise, if you need sessions for authentication, you might consider:
  /*
  app.use(cookieParser());
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60, // 1 hour
      sameSite: 'none',
    },
  };
  app.use(session(sessionConfig));
  console.log('Session Configuration:', sessionConfig);
  */

  await app.listen(3000);
  console.log(
    `Backend server is running on ${
      process.env.NODE_ENV === 'production' ? 'https://api.ascarinet.com' : 'http://localhost:3000'
    }`
  );
}

bootstrap();
