import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Import ConfigModule and ConfigService
import { JwtModule } from '@nestjs/jwt'; // Import JwtModule
import AIService from './ai/ai.service';
import { GeminiAIClient } from './ai/gemini.ai';
import { TradingModule } from './api/trading.module';
import { TradingController } from './api/controllers';
import { LogService } from './api/log.service';
import { UserModule } from './api/user/user-module';
import { SubscriptionService } from './api/subscription/subscription-service';
import { User } from './api/user/user-entity';
import { ApiModule } from './api/api-module';
import { EmailModule } from './api/email/email-module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionController } from './api/subscription/subscription-controller';
import { ContactUsController } from './api/email/contact-us';
import { LoggerModule } from './api/logger.module';

@Module({
  imports: [
    // 1. Configure ConfigModule Globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Configure TypeOrmModule with ConfigService
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: parseInt(configService.get<string>('DB_PORT') || '5432', 10),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD')?.trim(),
        database: configService.get<string>('DB_NAME'),
        entities: [User],
        autoLoadEntities: true,
        synchronize: true,
        logging: true,
      }),
    }),

    // 3. Register User Entity
    TypeOrmModule.forFeature([User]),

    // 4. Import Other Modules
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your_secret_key', // Ensure this matches your JWT secret
      signOptions: { expiresIn: '1h' }, // Optional: Token expiration time
    }),
    TradingModule,
    UserModule,
    ApiModule,
    EmailModule,
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    AuthModule,
    LoggerModule,
  ],
  controllers: [TradingController, SubscriptionController, ContactUsController],
  providers: [AIService, GeminiAIClient, SubscriptionService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  async onModuleInit(): Promise<void> {
    console.log('AppModule: Initializing...');
    try {
      await this.subscriptionService.startListening();
      console.log('Subscription service started successfully.');
    } catch (error) {
      console.error('Error starting subscription service:', (error as Error).message);
    }
  }
}
