import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import AIService from '../ai/ai.service';
import { RateLimiterService } from './rate.limiter';
import { TradingController } from './controllers';
import { ScheduledTaskService } from '../background-job/scheduled.change';
import { LogService } from './log.service';

@Module({
  controllers: [TradingController],
  providers: [TradingService, AIService, RateLimiterService, ScheduledTaskService, LogService],
  exports: [TradingService, LogService], // Export TradingService and LogService
})
export class TradingModule {}
