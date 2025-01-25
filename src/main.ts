import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Define CORS options for the specific frontend origin
  const corsOptions = {
    origin: "https://tradingbot.ascarinet.com", // Allow only this origin
    credentials: false, // Disable credentials to mimic incognito behavior
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"], // Allowed HTTP methods
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ], // Allowed headers
  };

  // Enable CORS globally with the specified options
  app.enableCors(corsOptions);
  console.log("CORS Configuration:", corsOptions);

  // Disable caching for all responses
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  // Use cookie-parser middleware
  app.use(cookieParser());

  // Avoid using sessions unless absolutely necessary, as they involve cookies
  /*
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Ensure cookies are sent over HTTPS in production
      maxAge: 1000 * 60 * 60, // 1 hour
      sameSite: 'none', // Explicitly set SameSite to 'none'
    },
  };
  app.use(session(sessionConfig));
  console.log('Session Configuration:', sessionConfig);
  */

  // Log all requests to ensure clean handling and troubleshooting
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[Request] ${req.method} ${req.originalUrl}`);
    next();
  });

  // Start the server
  await app.listen(3000);
  console.log(
    `Backend server is running on ${
      process.env.NODE_ENV === "production"
        ? "https://api.ascarinet.com"
        : "http://localhost:3000"
    }`,
  );
}

bootstrap();
