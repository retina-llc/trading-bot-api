// app.module.ts
import { Module, OnModuleInit } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bull";
import { ConfigModule, ConfigService } from "@nestjs/config"; // Import ConfigModule and ConfigService
import { JwtModule } from "@nestjs/jwt"; // Import JwtModule
import AIService from "./ai/ai.service";
import { GeminiAIClient } from "./ai/gemini.ai";
import { TradingModule } from "./api/trading.module";
import { TradingController } from "./api/controllers";
import { LogService } from "./api/log.service";
import { UserModule } from "./api/user/user-module";
import { SubscriptionService } from "./api/subscription/subscription-service";
import { User } from "./api/user/user-entity";
import { ApiModule } from "./api/api-module";
import { EmailModule } from "./api/email/email-module";
import { AuthModule } from "./auth/auth.module";
import { SubscriptionController } from "./api/subscription/subscription-controller";
import { ContactUsController } from "./api/email/contact-us";
import { LoggerModule } from "./api/logger.module";
import * as fs from "fs";
import * as path from "path";
import { HealthModule } from "./api/health.module";

// Import the HealthModule. Ensure that you have created it under src/health/health.module.ts.

@Module({
  imports: [
    // 1. Configure ConfigModule Globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),

    // 2. Configure TypeOrmModule with SSL Settings
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        // Retrieve SSL configuration from environment variables
        const sslMode = configService.get<string>("DB_SSLMODE");
        const sslCertPath =
          configService.get<string>("DB_SSLROOTCERT") ||
          process.env.SSL_CERT_PATH ||
          path.resolve(__dirname, "../certs/us-east-1-bundle.pem");

        let sslOptions: boolean | { rejectUnauthorized: boolean; ca: string } =
          false;

        if (sslMode === "verify-full") {
          if (fs.existsSync(sslCertPath)) {
            const ca = fs.readFileSync(sslCertPath).toString();
            sslOptions = {
              rejectUnauthorized: true, // Ensures the server certificate is verified
              ca: ca,
            };
            console.log(
              "TypeOrmModule SSL is enabled with the provided certificate.",
            );
          } else {
            console.error(
              `TypeOrmModule SSL certificate not found at path: ${sslCertPath}`,
            );
            throw new Error(
              `SSL certificate not found at path: ${sslCertPath}`,
            );
          }
        } else {
          console.warn(
            "TypeOrmModule SSL is not enabled. It is recommended to use SSL for database connections.",
          );
        }

        // Log the connection configuration (excluding sensitive information)
        console.log("TypeOrmModule Connection Configuration:");
        console.log({
          type: "postgres",
          host: configService.get<string>("DB_HOST"),
          port: configService.get<string>("DB_PORT"),
          username: configService.get<string>("DB_USER"),
          database: configService.get<string>("DB_NAME"),
          ssl: sslOptions,
        });

        return {
          type: "postgres",
          host: configService.get<string>("DB_HOST") || "localhost",
          port: parseInt(configService.get<string>("DB_PORT") || "5432", 10),
          username: configService.get<string>("DB_USER") || "postgres",
          password: configService.get<string>("DB_PASSWORD") || "password",
          database: configService.get<string>("DB_NAME") || "postgres",
          synchronize: false, // Always false in production
          logging: ["error", "warn", "info", "query"], // Enable detailed logging
          entities: [User],
          autoLoadEntities: true,
          migrations: ["./src/migrations/*.ts"],
          subscribers: [],
          extra: {
            ssl: sslOptions, // Correctly nested within 'extra'
          },
        };
      },
    }),

    // 3. Register User Entity
    TypeOrmModule.forFeature([User]),

    // 4. Import Other Modules
    JwtModule.register({
      secret: process.env.JWT_SECRET || "your_secret_key", // Ensure this matches your JWT secret
      signOptions: { expiresIn: "1h" }, // Optional: Token expiration time
    }),
    TradingModule,
    UserModule,
    ApiModule,
    EmailModule,
    BullModule.forRoot({
      redis: {
        host: "localhost",
        port: 6379,
      },
    }),
    AuthModule,
    LoggerModule,

    // 5. Import the HealthModule for the /health endpoint
    HealthModule,
  ],
  controllers: [TradingController, SubscriptionController, ContactUsController],
  providers: [AIService, GeminiAIClient, SubscriptionService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  async onModuleInit(): Promise<void> {
    console.log("AppModule: Initializing...");
    try {
      await this.subscriptionService.startListening();
      console.log("Subscription service started successfully.");
    } catch (error) {
      console.error(
        "Error starting subscription service:",
        (error as Error).message,
      );
    }
  }
}
