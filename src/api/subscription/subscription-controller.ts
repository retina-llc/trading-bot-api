import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { SubscriptionService } from './subscription-service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('simulate-transaction')
  async simulateTransaction(
    @Body('from') from: string,
    @Body('to') to: string,
    @Body('value') value: string,
  ): Promise<any> {
    try {
      const simulatedValue = BigInt(value); // Convert value to BigInt
      await this.subscriptionService['grantSubscription'](from); // Simulate granting subscription
      return { message: 'Simulated transaction processed' };
    } catch (error) {
      throw new HttpException(
        `Error processing simulated transaction: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
