import { Controller, Post, Body, HttpException, HttpStatus, Get } from '@nestjs/common';
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
    @Get('asc-price')
    async getAscPrice(): Promise<{ price: number }> {
      // Call the service method with ascAmount = 1 to get 1 ASC price in USD
      const oneAscInUsd = await this.subscriptionService.getAscValueInUSD(1);
      return { price: oneAscInUsd };
    }
  }
  
  
