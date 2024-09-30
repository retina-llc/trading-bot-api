import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TradingService } from '../api/trading.service';

@Injectable()
export class ScheduledTaskService {
  constructor(private readonly tradingService: TradingService) {}

  @Cron('*/30 * * * * *') // Run every 30 seconds
  async handleCron() {
    try {
      console.log('Running background job...');

      // Example symbols and amount
      const symbol = 'BTC_USDT'; // Replace with the actual symbol you want to trade
      const amount = 100; // Replace with the amount to invest in the trade
      const rebuyPercentage = 20; // Replace with the desired rebuy percentage
      const profitTarget = 20; // Replace with the desired daily profit target in USD

      // Start trading with the specified symbol, amount, rebuy percentage, and profit target
      await this.tradingService.startTrade(symbol, amount, rebuyPercentage, profitTarget);
    } catch (error) {
      console.error('Error running background job:', error);
    }
  }
}
