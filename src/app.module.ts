import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import AIService from './ai/ai.service';
import { GeminiAIClient } from './ai/gemini.ai';
import { TradingModule } from './api/trading.module';
import { TradingController } from './api/controllers';
import { LogService } from './api/log.service';
@Module({
  imports: [
    TradingModule,
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
  controllers: [TradingController, ], // Register controllers here
  providers: [AIService, GeminiAIClient, LogService], // Register providers here
})
export class AppModule {}
