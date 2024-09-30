import { Controller, Get, Post, HttpException, HttpStatus, Query, Body } from '@nestjs/common';
import { TradingService } from './trading.service'; // Import TradingService
import AIService from '../ai/ai.service';
import { fetchTicker, getAIPredictions, getAIRecommendation, getOrderBook, getTicker } from './api';
import { LogService } from './log.service';
import { getMostVolatileCoin, getPumpedCoins, getTopGainers, getTopTrendingCoins, getTopTrendingCoinsForTheDay } from './gainer';

@Controller('trading')
export class TradingController {
  constructor(
    private readonly aiService: AIService,
    private readonly tradingService: TradingService, // Inject TradingService
    private readonly logService: LogService, // Inject LogService
  ) {}

  @Get('ticker')
  async getTicker(@Query('symbol') symbol: string): Promise<any> {
    console.log('Received request for ticker with symbol:', symbol);
    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new Error('Symbol query parameter is required');
    }
    try {
      const ticker = await getTicker(symbol);
      console.log('Ticker data:', ticker);
      return ticker;
    } catch (error) {
      console.error('Error fetching ticker:', error);
      throw error;
    }
  }

  @Get('order-book')
  async getOrderBook(@Query('symbol') symbol: string): Promise<any> {
    console.log('Received request for order book with symbol:', symbol);
    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new Error('Symbol query parameter is required');
    }
    try {
      const orderBook = await getOrderBook(symbol);
      console.log('Order book data:', orderBook);
      return orderBook;
    } catch (error) {
      console.error('Error fetching order book:', error);
      throw error;
    }
  }

  @Get('ai-predictions')
  async getAIPredictions(@Query('symbol') symbol: string): Promise<any> {
    console.log('Received request for AI predictions with symbol:', symbol);
    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new Error('Symbol query parameter is required');
    }
    try {
      const aiPredictions = await getAIPredictions(symbol);
      console.log('AI predictions data:', aiPredictions);
      return aiPredictions;
    } catch (error) {
      console.error('Error fetching AI predictions:', error);
      throw error;
    }
  }

  @Get('ai-recommendation')
  async getAIRecommendation(@Query('symbol') symbol: string): Promise<any> {
    console.log('Received request for AI recommendation with symbol:', symbol);
    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new Error('Symbol query parameter is required');
    }
    try {
      const aiRecommendation = await getAIRecommendation(symbol);
      console.log('AI recommendation data:', aiRecommendation);
      return aiRecommendation;
    } catch (error) {
      console.error('Error fetching AI recommendation:', error);
      throw error;
    }
  }

  @Get('balance')
  async getBalance(): Promise<any> {
    console.log('Received request for user balance');
    try {
      const balance = await this.tradingService.getUserBalance();
      console.log('User balance data:', balance);
      return { balance };
    } catch (error) {
      console.error('Error fetching user balance:', error);
      throw error;
    }
  }

  @Get('top-gainer')
  async getTopGainer(@Query('symbols') symbols: string): Promise<any> {
    console.log('Received request for top gainer with symbols:', symbols);
    if (!symbols) {
      console.error('Error: Symbols query parameter is required');
      throw new Error('Symbols query parameter is required');
    }

    const symbolArray = symbols.split(',');
    console.log('Determining top gainer among symbols:', symbolArray);

    try {
      let topGainer = null;
      let maxGain = -Infinity;

      for (const symbol of symbolArray) {
        console.log('Processing symbol:', symbol);
        try {
          const tickerData = await getTicker(symbol);
          console.log('Ticker data for symbol', symbol, ':', tickerData);

          if (tickerData && tickerData.data && tickerData.data.tickers.length > 0) {
            const ticker = tickerData.data.tickers[0];
            const openPrice = parseFloat(ticker.open_24h);
            const closePrice = parseFloat(ticker.close_24h);
            const gain = closePrice - openPrice;

            if (gain > maxGain) {
              maxGain = gain;
              topGainer = { symbol, gain };
            }
          }
        } catch (symbolError) {
          console.error('Error fetching ticker data for symbol', symbol, ':', symbolError);
        }
      }

      if (topGainer) {
        console.log('Top gainer determined:', topGainer);
        return { topGainer };
      } else {
        console.log('No valid symbols processed.');
        throw new Error('No valid symbols processed.');
      }
    } catch (error) {
      console.error('Error determining top gainer:', error);
      throw error;
    }
  }

  @Post('start-trade')
  async startTrade(
    @Body() tradeRequest: {
      symbol: string,
      amount: number,
      rebuyPercentage: number,
      profitTarget: number,
    },
  ): Promise<any> {
    const { symbol, amount, rebuyPercentage, profitTarget } = tradeRequest;

    console.log('Received request to start trade with symbol:', symbol, 'amount:', amount, 'rebuyPercentage:', rebuyPercentage, 'profitTarget:', profitTarget);

    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new HttpException('Symbol query parameter is required', HttpStatus.BAD_REQUEST);
    }
    if (amount < 4) {
      console.error('Error: Investment amount must be greater than 4');
      throw new HttpException('Investment amount must be greater than 4', HttpStatus.BAD_REQUEST);
    }
    if (rebuyPercentage <= 0 || rebuyPercentage > 100) {
      console.error('Error: Rebuy percentage must be between 1 and 100');
      throw new HttpException('Rebuy percentage must be between 1 and 100', HttpStatus.BAD_REQUEST);
    }
    if (profitTarget <= 0) {
      console.error('Error: Profit target must be greater than 0');
      throw new HttpException('Profit target must be greater than 0', HttpStatus.BAD_REQUEST);
    }

    try {
      // Start trade using TradingService
      const tradeResult = await this.tradingService.startTrade(symbol, amount, rebuyPercentage, profitTarget);
      return { message: 'Trade started successfully', ...tradeResult };
    } catch (error) {
      console.error('Error executing trade:', error);
      throw new HttpException('Failed to start trade', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // @Get('trade-started')
  // async tradeStarted(
  //   @Query('symbol') symbol: string,
  //   @Query('profitTarget') profitTarget: number,
  //   @Query('rebuyPercentage') rebuyPercentage: number,
  // ): Promise<any> {
  //   console.log('Received request to mark trade as started with symbol:', symbol, 'profitTarget:', profitTarget, 'rebuyPercentage:', rebuyPercentage);
  //   if (!symbol) {
  //     console.error('Error: Symbol query parameter is required');
  //     throw new HttpException('Symbol query parameter is required', HttpStatus.BAD_REQUEST);
  //   }
  //   if (profitTarget <= 0) {
  //     console.error('Error: Profit target must be greater than 0');
  //     throw new HttpException('Profit target must be greater than 0', HttpStatus.BAD_REQUEST);
  //   }
  //   if (rebuyPercentage <= 0 || rebuyPercentage > 100) {
  //     console.error('Error: Rebuy percentage must be between 1 and 100');
  //     throw new HttpException('Rebuy percentage must be between 1 and 100', HttpStatus.BAD_REQUEST);
  //   }

  //   try {
  //     // Start trade using TradingService
  //     const tradeResult = await this.tradingService.tradeStarted(symbol, profitTarget, rebuyPercentage);
  //     return { message: 'Trade marked as started successfully', ...tradeResult };
  //   } catch (error) {
  //     console.error('Error marking trade as started:', error);
  //     throw new HttpException('Failed to mark trade as started', HttpStatus.INTERNAL_SERVER_ERROR);
  //   }
  // }

  @Get('stop-trade')
  async stopTrade(): Promise<any> {
    console.log('Received request to stop trading');
    try {
      this.tradingService.stopTrade();
      return { message: 'Trading stopped successfully' };
    } catch (error) {
      console.error('Error stopping trade:', error);
      throw error;
    }
  }

  @Post('place-order')
  async placeOrder(
    @Body('symbol') symbol: string,
    @Body('side') side: 'buy' | 'sell',
    @Body('quantity') quantity?: number,
    @Body('price') price?: number,
  ): Promise<any> {
    console.log('Received request to place order with symbol:', symbol, 'side:', side, 'quantity:', quantity, 'price:', price);

    // Validate required parameters
    if (!symbol || !side) {
      console.error('Error: All parameters (symbol, side) are required');
      throw new HttpException('All parameters (symbol, side) are required', HttpStatus.BAD_REQUEST);
    }

    if (side === 'buy' && quantity === undefined) {
      console.error('Error: Quantity is required for buy orders');
      throw new HttpException('Quantity is required for buy orders', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.tradingService.placeOrder(symbol, side, quantity, price);
      return { message: `Order ${side} placed for ${symbol}, quantity: ${quantity}` };
    } catch (error) {
      console.error('Error placing order:', error);
      throw new HttpException('Failed to place order', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('fetch-ticker')
  async fetchTicker(@Query('symbol') symbol: string): Promise<number> {
    console.log('Received request to fetch ticker with symbol:', symbol);
    if (!symbol) {
      console.error('Error: Symbol query parameter is required');
      throw new HttpException('Symbol query parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const lastPrice = await fetchTicker(symbol);
      console.log('Fetched ticker last price:', lastPrice);
      return lastPrice;
    } catch (error) {
      console.error('Error fetching ticker:', error);
      throw new HttpException('Failed to fetch ticker data', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('accumulated-profit')
  async getAccumulatedProfit(): Promise<any> {
    console.log('Received request to retrieve accumulated profit');
    try {
      const accumulatedProfit = this.tradingService.getAccumulatedProfit();
      console.log('Accumulated Profit:', accumulatedProfit);
      return { accumulatedProfit };
    } catch (error) {
      console.error('Error retrieving accumulated profit:', error);
      throw new HttpException('Failed to retrieve accumulated profit', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('profit-target')
  async getProfitTarget(): Promise<any> {
    console.log('Received request to retrieve profit target');
    try {
      const profitTarget = this.tradingService.getProfitTarget();
      console.log('Current Profit Target:', profitTarget);
      return { profitTarget };
    } catch (error) {
      console.error('Error retrieving profit target:', error);
      throw new HttpException('Failed to retrieve profit target', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('status')
  getStatus() {
    return this.tradingService.getTradeStatus();
  }

  @Get('logs')
  async getLogs(): Promise<string> {
    console.log('Received request for logs');
    try {
      const logs = await this.logService.getLogs();
      return logs;
    } catch (error) {
      console.error('Error fetching logs:', error);
      throw new HttpException('Failed to fetch logs', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('delete-logs')
  async deleteLogs(): Promise<any> {
    console.log('Received request to delete logs');
    try {
      await this.logService.deleteAllLogs();
      return { message: 'Logs deleted successfully' };
    } catch (error) {
      console.error('Error deleting logs:', error);
      throw new HttpException('Failed to delete logs', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  @Get('top-gainers')
  async getTopGainers(): Promise<any> {
    console.log('Received request for top gainers');
    try {
      const topGainers = await getTopGainers();
      console.log('Top 5 Gainers in the last 3 minutes:', topGainers);
      return topGainers;
    } catch (error) {
      console.error('Error fetching top gainers:', error);
      throw new HttpException('Failed to fetch top gainers', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  @Get('most-volatile-coin')
  async getMostVolatileCoin(): Promise<any> {
    console.log('Received request for most volatile coin');
    try {
      const mostVolatileCoin = await getMostVolatileCoin();
      console.log('Most volatile coin data:', mostVolatileCoin);
      return { mostVolatileCoin };
    } catch (error) {
      console.error('Error fetching most volatile coin:', error);
      throw error;
    }
  }
    @Get('top-trending-coins')
    async getTopTrendingCoins(): Promise<any> {
      console.log('Received request for top trending coins');
      try {
        const trendingCoins = getTopTrendingCoins();
        console.log('Top trending coins:', trendingCoins);
        return trendingCoins;
      } catch (error) {
        console.error('Error fetching top trending coins:', error);
        throw new HttpException('Failed to fetch top trending coins', HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
    @Get('top-trending-coins-for-the-day')
  async getTopTrendingCoinsForTheDay(): Promise<any> {
    console.log('Received request for top trending coins for the day');
    try {
      const trendingCoinsForTheDay = getTopTrendingCoinsForTheDay();
      console.log('Top trending coins for the day:', trendingCoinsForTheDay);
      return { trendingCoinsForTheDay };
    } catch (error) {
      console.error('Error fetching top trending coins for the day:', error);
      throw new HttpException('Failed to fetch top trending coins for the day', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

@Get('pumped-coins')
async getPumpedCoins(@Query('limit') limit: number): Promise<any> {
  console.log('Received request for pumped coins');
  
  try {
    const pumpedCoins = getPumpedCoins();

    // Convert object to array and sort by the percentage increase
    const pumpedCoinsArray = Object.keys(pumpedCoins).map(symbol => ({
      symbol,
      percentageIncrease: pumpedCoins[symbol].percentageIncrease,
    }));

    // Sort pumped coins by percentage increase in descending order
    pumpedCoinsArray.sort((a, b) => b.percentageIncrease - a.percentageIncrease);

    // Limit the number of results returned (default to 100 if not specified)
    const resultLimit = limit && limit > 0 ? Math.min(limit, 100) : 100;
    const limitedPumpedCoins = pumpedCoinsArray.slice(0, resultLimit);

    console.log('Pumped coins data:', limitedPumpedCoins);
    return limitedPumpedCoins;
  } catch (error) {
    console.error('Error fetching pumped coins:', error);
    throw new HttpException('Failed to fetch pumped coins', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
}