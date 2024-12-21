import { Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import * as ccxt from 'ccxt';
import logger from './logger';
import { getTopTrendingCoinsForTheDay } from './gainer';
import { UserRepository } from './user/user-repository';

const BITMART_API_URL = 'https://api-cloud.bitmart.com';

@Injectable()
export class TradingService {
  private purchasePrices: Record<string, { price: number; timestamp: number }> = {};
  private monitorIntervals: Record<string, NodeJS.Timeout> = {};
  private profitTarget: number = 0;
  private accumulatedProfit: number = 0;
  private startDayTimestamp: number = 0;
  private skyrocketProfitMode: boolean = false;
  private skyrocketProfitTarget: number = 0;

  constructor(private readonly userRepository: UserRepository) {}

  // Load user API keys dynamically
  private async getUserApiKeys(userId: number): Promise<{
    bitmartApiKey: string;
    bitmartApiSecret: string;
    bitmartApiMemo: string;
    monitoringApiKey: string;
    monitoringApiSecret: string;
    monitoringApiMemo: string;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.apiKeys) {
      throw new UnauthorizedException('API keys not found for this user');
    }
    const {
      bitmartApiKey,
      bitmartApiSecret,
      bitmartApiMemo,
      monitoringApiKey,
      monitoringApiSecret,
      monitoringApiMemo,
    } = user.apiKeys;

    if (
      !bitmartApiKey ||
      !bitmartApiSecret ||
      !bitmartApiMemo ||
      !monitoringApiKey ||
      !monitoringApiSecret ||
      !monitoringApiMemo
    ) {
      throw new UnauthorizedException('Incomplete API keys for this user');
    }

    return {
      bitmartApiKey,
      bitmartApiSecret,
      bitmartApiMemo,
      monitoringApiKey,
      monitoringApiSecret,
      monitoringApiMemo,
    };
  }

  // Dynamically initialize the CCXT exchanges
  private async initializeExchanges(userId: number): Promise<{
    exchange: ccxt.bitmart;
    monitoringExchange: ccxt.bitmart;
  }> {
    const {
      bitmartApiKey,
      bitmartApiSecret,
      bitmartApiMemo,
      monitoringApiKey,
      monitoringApiSecret,
      monitoringApiMemo,
    } = await this.getUserApiKeys(userId);

    const exchange = new ccxt.bitmart({
      apiKey: bitmartApiKey,
      secret: bitmartApiSecret,
      uid: bitmartApiMemo,
    });

    const monitoringExchange = new ccxt.bitmart({
      apiKey: monitoringApiKey,
      secret: monitoringApiSecret,
      uid: monitoringApiMemo,
    });

    return { exchange, monitoringExchange };
  }

  private generateSignature(
    httpMethod: string,
    url: string,
    timestamp: string,
    queryString: string,
    body: any,
    secretKey: string,
    memo: string
  ): string {
    const bodyString = body && Object.keys(body).length > 0 ? JSON.stringify(body) : '';
    const preHashString = `${timestamp}#${memo}#${httpMethod}#${url}${queryString ? '?' + queryString : ''}${bodyString}`;
    return crypto.createHmac('sha256', secretKey).update(preHashString).digest('hex');
  }

  private async getAuthHeaders(
    userId: number,
    endpoint: string,
    method: string,
    queryString: string,
    body: any
  ): Promise<any> {
    const { bitmartApiKey, bitmartApiSecret, bitmartApiMemo } = await this.getUserApiKeys(userId);
    const timestamp = Date.now().toString();
    const urlPath = endpoint.replace(BITMART_API_URL, '');
    const signature = this.generateSignature(method, urlPath, timestamp, queryString, body, bitmartApiSecret, bitmartApiMemo);

    return {
      'X-BM-KEY': bitmartApiKey,
      'X-BM-SIGN': signature,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-MEMO': bitmartApiMemo,
      'Content-Type': 'application/json',
    };
  }

  private async getMonitoringAuthHeaders(
    userId: number,
    endpoint: string,
    method: string,
    queryString: string,
    body: any
  ): Promise<any> {
    const { monitoringApiKey, monitoringApiSecret, monitoringApiMemo } = await this.getUserApiKeys(userId);
    const timestamp = Date.now().toString();
    const urlPath = endpoint.replace(BITMART_API_URL, '');
    const signature = this.generateSignature(method, urlPath, timestamp, queryString, body, monitoringApiSecret, monitoringApiMemo);

    return {
      'X-BM-KEY': monitoringApiKey,
      'X-BM-SIGN': signature,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-MEMO': monitoringApiMemo,
      'Content-Type': 'application/json',
    };
  }

  public getAccumulatedProfit(): number {
    return this.accumulatedProfit;
  }

  public async getUserBalance(userId: number): Promise<number> {
    const url = `${BITMART_API_URL}/account/v1/wallet`;
    const headers = await this.getAuthHeaders(userId, url, 'GET', '', {});
  
    try {
      logger.info('Fetching user balance');
      const response = await axios.get(url, { headers });
      const usdtBalance = response.data.data.wallet.find((b: any) => b.currency === 'USDT');
      return usdtBalance ? parseFloat(usdtBalance.available) : 0;
    } catch (error: unknown) {
      const err = error as any; // Type assertion
      logger.error('Error fetching user balance:', err.message || 'Unknown error');
      throw new Error('Failed to fetch user balance');
    }
  }
  
  private async fetchTicker(symbol: string): Promise<number> {
    const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${symbol}`;
    console.log(`Fetching ticker data for symbol: ${symbol} from URL: ${url}`);
    try {
      const response = await axios.get(url);
      console.log(`Response data for symbol ${symbol}:`, JSON.stringify(response.data, null, 2));
      
      const tickers = response.data.data.tickers;
      if (!tickers || tickers.length === 0) {
        console.error(`No ticker data available for symbol: ${symbol}`);
        throw new Error(`No ticker data available for symbol: ${symbol}`);
      }
  
      const lastPrice = parseFloat(tickers[0].last_price);
      if (isNaN(lastPrice)) {
        console.error(`Invalid last price value for symbol: ${symbol}`, tickers[0].last_price);
        throw new Error(`Invalid last price value for symbol: ${symbol}`);
      }
  
      console.log(`Last price for symbol ${symbol}: ${lastPrice}`);
      return lastPrice;
    } catch (error: any) {
      console.error(`Error fetching ticker data for ${symbol}:`, error.message, error.stack);
      throw new Error(`Failed to fetch ticker data for ${symbol}`);
    }
  }

  // Add this method to your TradingService class
  public async getAvailableQuantity(userId: number, symbol: string): Promise<number> {
    try {
      // Fetch user balance or account information
      const url = `${BITMART_API_URL}/account/v1/wallet`;
      const headers = await this.getAuthHeaders(userId, url, 'GET', '', {}); // Pass userId as the first argument
      const response = await axios.get(url, { headers });
  
      // Find the specific asset quantity
      const balances = response.data.data.wallet;
      const asset = balances.find((b: any) => b.currency === symbol.split('_')[0]); // Adjust based on symbol format
      return asset ? parseFloat(asset.available) : 0;
    } catch (error: unknown) {
      const err = error as any;
      console.error('Error fetching available quantity:', err.message || 'Unknown error');
      throw new Error('Failed to fetch available quantity');
    }
  }
  

  private async fetchBestMarketPrice(userId: number, symbol: string): Promise<number> {
    try {
      // Fetch user-specific API keys
      const { bitmartApiKey, bitmartApiSecret, bitmartApiMemo } = await this.getUserApiKeys(userId);
  
      // Initialize ccxt exchange dynamically with user keys
      const exchange = new ccxt.bitmart({
        apiKey: bitmartApiKey,
        secret: bitmartApiSecret,
        uid: bitmartApiMemo,
      });
  
      // Fetch the ticker data for the given symbol
      const ticker = await exchange.fetchTicker(symbol);
  
      if (ticker.bid === undefined) {
        throw new Error('Failed to fetch market price');
      }
  
      return ticker.bid; // Best bid price for sell orders
    } catch (error: unknown) {
      const err = error as any;
      console.error('Error fetching ticker data:', err.message || 'Unknown error');
      throw new Error('Failed to fetch market price');
    }
  }
  public async placeOrder(
    userId: number,
    symbol: string,
    side: 'buy' | 'sell',
    amount?: number // "amount" will mean notional for buy orders, quantity for sell orders
  ): Promise<void> {
    try {
      const { exchange } = await this.initializeExchanges(userId);
  
      if (side === 'buy') {
        // Ensure the total cost (amount) is defined
        if (!amount || amount <= 0) {
          const balance = await this.getUserBalance(userId);
          if (balance <= 0) throw new Error('Insufficient balance for buying.');
          amount = balance; // Default to available balance
        }
  
        console.log(`Placing BUY order: Symbol=${symbol}, Notional=${amount}`);
  
        // Set BitMart-specific behavior
        exchange.options['createMarketBuyOrderRequiresPrice'] = false;
  
        // Pass "amount" as the total cost (notional)
        const order = await exchange.createOrder(symbol, 'market', side, amount);
  
        logger.info(`Market BUY order placed successfully:`, order);
      } else if (side === 'sell') {
        // Ensure quantity is defined for sell orders
        if (!amount || amount <= 0) {
          amount = await this.getAvailableQuantity(userId, symbol);
          if (amount <= 0) throw new Error('No available quantity to sell.');
        }
  
        console.log(`Placing SELL order: Symbol=${symbol}, Quantity=${amount}`);
  
        // Pass "amount" as the quantity for sell orders
        const order = await exchange.createOrder(symbol, 'market', side, amount);
  
        logger.info(`Market SELL order placed successfully:`, order);
      }
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`Error placing ${side} order for ${symbol}:`, err.message);
      throw new Error(`Failed to place ${side} order for ${symbol}: ${err.message}`);
    }
  }
  
  
  public async startTrade(
    userId: number,  // Add userId parameter
    symbol: string,
    amount: number,
    rebuyPercentage: number,
    profitTarget: number
  ): Promise<any> {
    try {
      if (!symbol || amount <= 4) {
        throw new Error('Invalid symbol or amount.');
      }
  
      // Fetch user balance
      const balance = await this.getUserBalance(userId);
      if (amount > balance) {
        throw new Error('Insufficient balance.');
      }
  
      // Fetch the latest price of the symbol
      const lastPrice = await this.fetchTicker(symbol);
      const purchaseQuantity = amount / lastPrice;
  
      console.log(
        `Placing buy order for symbol: ${symbol}, amount: ${amount}, purchaseQuantity: ${purchaseQuantity}`
      );
  
      // Place a buy order
      await this.placeOrder(userId, symbol, 'buy', purchaseQuantity); // Pass userId
  
      console.log(
        `Buy order placed successfully for symbol: ${symbol}, purchaseQuantity: ${purchaseQuantity}`
      );
  
      // Save the purchase price and initialize monitoring
      this.purchasePrices[symbol] = { price: lastPrice, timestamp: Date.now() };
      this.profitTarget = profitTarget;
      this.accumulatedProfit = 0;
      this.startDayTimestamp = Date.now();
  
      // Start continuous monitoring
      this.startContinuousMonitoring(userId, symbol, purchaseQuantity, rebuyPercentage);
  
      return { symbol, amount, remainingBalance: balance - amount };
    } catch (error: unknown) {
      const err = error as Error; // Explicitly cast error to Error
      console.error('Error starting trade:', err.message);
      throw new Error(`Failed to start trade: ${err.message}`);
    }
  }
  

  private async calculateProfit(symbol: string, quantity: number, sellPrice: number): Promise<number> {
    const purchase = this.purchasePrices[symbol];
    if (!purchase) {
      throw new Error('Purchase price not found');
    }
    const purchasePrice = purchase.price;
    const profit = (sellPrice - purchasePrice) * quantity;
    return profit;
  }

  private async checkAndHandleProfit(
    userId: number, // Add userId parameter
    symbol: string,
    quantity: number,
    sellPrice: number
  ): Promise<void> {
    const profit = await this.calculateProfit(symbol, quantity, sellPrice);
    this.accumulatedProfit += profit;
    console.log(`Accumulated Profit: ${this.accumulatedProfit}`);
  
    if (this.accumulatedProfit >= this.profitTarget) {
      console.log(
        `Profit target of ${this.profitTarget} reached. Selling and stopping trade.`
      );
      await this.placeOrder(userId, symbol, 'sell', quantity); // Pass userId to placeOrder
      this.stopTrade();
    }
  }
  

  private isNewDay(): boolean {
    const oneDayInMillis = 24 * 60 * 60 * 1000;
    return (Date.now() - this.startDayTimestamp) >= oneDayInMillis;
  }

  private async startContinuousMonitoring(
    userId: number,
    symbol: string,
    quantity: number,
    rebuyPercentage: number
  ) {
    if (this.monitorIntervals[symbol]) {
      logger.info(`Clearing existing monitoring interval for ${symbol}.`);
      clearInterval(this.monitorIntervals[symbol]);
    }
  
    logger.info(`Starting continuous monitoring for ${symbol} with rebuyPercentage: ${rebuyPercentage}.`);
  
    this.monitorIntervals[symbol] = setInterval(async () => {
      try {
        if (this.isNewDay()) {
          logger.info('A new day has started. Resetting accumulated profit.');
          this.accumulatedProfit = 0;
          this.startDayTimestamp = Date.now();
        }
  
        const currentPrice = await this.fetchTicker(symbol);
        logger.info(`Current price for ${symbol}: ${currentPrice}`);
  
        const purchase = this.purchasePrices[symbol];
        if (!purchase) {
          logger.info(`Purchase price not found for symbol: ${symbol}`);
          return;
        }
  
        const purchasePrice = purchase.price;
        const priceDrop = (purchasePrice - currentPrice) / purchasePrice;
        const profit = (currentPrice - purchasePrice) / purchasePrice;
  
        logger.info(`Purchase price for ${symbol}: ${purchasePrice}`);
        logger.info(`Price drop for ${symbol}: ${priceDrop * 100}%`);
        logger.info(`Current profit for ${symbol}: ${profit * 100}%`);
  
        // Handle price drop condition
        if (priceDrop > 0.004) {
          logger.info(`Price dropped by more than 0.4% for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity); // Add userId and side
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice); // Add userId and currentPrice
          delete this.purchasePrices[symbol];
          logger.info(`Waiting for 3 minutes before starting monitorAfterSale for ${symbol}.`);
          setTimeout(() => {
            this.monitorAfterSale(userId, symbol, quantity, currentPrice, rebuyPercentage);
          }, 180000); // 3 minutes delay
        }
        // Handle profit condition
        else if (profit >= 0.02) {
          logger.info(`Profit of 2% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity); // Add userId and side
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice); // Add userId and currentPrice
          delete this.purchasePrices[symbol];
          logger.info(`Waiting for 3 minutes before starting monitorAfterSale for ${symbol}.`);
          setTimeout(() => {
            this.monitorAfterSale(userId, symbol, quantity, currentPrice, rebuyPercentage);
          }, 180000); // 3 minutes delay
        }
        // Handle profit target condition
        else if (this.accumulatedProfit >= this.profitTarget) {
          logger.info(`Accumulated profit target reached for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity); // Add userId and side
          this.stopTrade();
        }
        // Handle skyrocketing profit condition
        else if (Date.now() - purchase.timestamp <= 60000 && profit >= 0.05) {
          logger.info(`5% profit in 1 minute for ${symbol}. Waiting for further changes.`);
          await this.waitForSkyrocketingProfit(userId, symbol, quantity, rebuyPercentage);
        }
      } catch (error) {
        logger.error('Error checking price and selling: ' + (error as Error).message);
      }
    }, 10000); // Check every 10 seconds
  }
  
  private async waitForSkyrocketingProfit(
    userId: number,
    symbol: string,
    quantity: number,
    rebuyPercentage: number
  ) {
    logger.info(`Monitoring skyrocketing profit for ${symbol}.`);
  
    const checkSkyrocketingProfit = setInterval(async () => {
      try {
        const currentPrice = await this.fetchTicker(symbol);
        const purchasePrice = this.purchasePrices[symbol]?.price;
  
        if (!purchasePrice) {
          clearInterval(checkSkyrocketingProfit);
          return;
        }
  
        const profit = (currentPrice - purchasePrice) / purchasePrice;
  
        if (profit >= 0.1) { // Sell at 10% profit
          logger.info(`Skyrocketing profit of 10% reached for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          this.stopTrade();
          clearInterval(checkSkyrocketingProfit);
        }
      } catch (error) {
        logger.error(`Error in waitForSkyrocketingProfit: ${error}`);
      }
    }, 60000); // Check every 1 minute
  
    setTimeout(() => clearInterval(checkSkyrocketingProfit), 240000); // Stop after 4 minutes
  }
  
  private activeMonitoringIntervals: { [key: string]: NodeJS.Timeout } = {};

  private async monitorAfterSale(
    userId: number,
    symbol: string,
    quantity: number,
    sellPrice: number,
    rebuyPercentage: number
  ): Promise<void> {
    const startRebuyMonitoring = async (currentSymbol: string, quantity: number, rebuyPercentage: number) => {
      logger.info(
        `Starting rebuy monitoring for ${currentSymbol} with quantity: ${quantity}, sellPrice: ${sellPrice}, rebuyPercentage: ${rebuyPercentage}`
      );
  
      let initialPrice: number = await this.fetchTicker(currentSymbol);
      if (initialPrice === undefined || isNaN(initialPrice)) {
        logger.error(`Initial price for ${currentSymbol} is invalid or undefined.`);
        return;
      }
      logger.info(`Initial price for ${currentSymbol}: ${initialPrice}`);
  
      const checkRebuyInterval = setInterval(async () => {
        try {
          const currentPrice = await this.fetchTicker(currentSymbol);
          if (currentPrice === undefined || isNaN(currentPrice)) {
            logger.error(`Current price for ${currentSymbol} is invalid or undefined.`);
            return;
          }
          logger.info(`Current price for ${currentSymbol}: ${currentPrice}`);
  
          const priceIncrease = (currentPrice - initialPrice) / initialPrice;
          const priceDrop = (initialPrice - currentPrice) / initialPrice;
  
          logger.info(
            `Price change for ${currentSymbol}: Increase: ${(priceIncrease * 100).toFixed(2)}%, Drop: ${(priceDrop * 100).toFixed(2)}%`
          );
  
          if (priceIncrease >= 0.002) {
            logger.info(`Price increased by 0.2% or more for ${currentSymbol}.`);
  
            const availableBalance = await this.getUserBalance(userId);
            logger.info(`User balance: ${availableBalance}`);
  
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
            const rebuyQuantity = amountToRebuy / currentPrice;
  
            if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
              await this.placeOrder(userId, currentSymbol, 'buy', rebuyQuantity);
              logger.info(`Buy order placed for ${currentSymbol} with quantity: ${rebuyQuantity}`);
  
              this.purchasePrices[currentSymbol] = { price: currentPrice, timestamp: Date.now() };
              clearInterval(checkRebuyInterval);
              this.startContinuousMonitoring(userId, currentSymbol, rebuyQuantity, rebuyPercentage);
            }
          } else if (priceDrop >= 0.05) {
            logger.info(`Price dropped by 5% or more for ${currentSymbol}.`);
  
            const availableBalance = await this.getUserBalance(userId);
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
            const rebuyQuantity = amountToRebuy / currentPrice;
  
            if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
              await this.placeOrder(userId, currentSymbol, 'buy', rebuyQuantity);
              logger.info(`Buy order placed for ${currentSymbol} with quantity: ${rebuyQuantity}`);
  
              this.purchasePrices[currentSymbol] = { price: currentPrice, timestamp: Date.now() };
              clearInterval(checkRebuyInterval);
              this.startContinuousMonitoring(userId, currentSymbol, rebuyQuantity, rebuyPercentage);
            }
          }
  
          const timeElapsed = Date.now() - (this.purchasePrices[currentSymbol]?.timestamp || 0);
          if (timeElapsed >= 210000 && currentPrice !== undefined) {
            initialPrice = currentPrice; // Safely reassign to a valid currentPrice
          }
        } catch (error) {
          logger.error(`Error monitoring rebuy: ${(error as Error).message}`);
        }
      }, 20000);
  
      this.activeMonitoringIntervals[currentSymbol] = checkRebuyInterval;
  
      setTimeout(async () => {
        if (!this.purchasePrices[currentSymbol] || Date.now() - this.purchasePrices[currentSymbol].timestamp >= 3600000) {
          logger.info(`1 hour elapsed without rebuying ${currentSymbol}. Buying into the top trending coin for the day.`);
  
          const trendingCoins = await getTopTrendingCoinsForTheDay();
          if (trendingCoins.length > 0) {
            const topTrendingCoin = trendingCoins[0].symbol;
            const availableBalance = await this.getUserBalance(userId);
            const currentPrice = await this.fetchTicker(topTrendingCoin);
  
            if (currentPrice !== undefined && !isNaN(currentPrice)) {
              const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
              const rebuyQuantity = amountToRebuy / currentPrice;
  
              if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
                await this.placeOrder(userId, topTrendingCoin, 'buy', rebuyQuantity);
                this.purchasePrices[topTrendingCoin] = { price: currentPrice, timestamp: Date.now() };
                this.startContinuousMonitoring(userId, topTrendingCoin, rebuyQuantity, rebuyPercentage);
              }
            }
          }
          clearInterval(this.activeMonitoringIntervals[currentSymbol]);
          delete this.activeMonitoringIntervals[currentSymbol];
        }
      }, 3600000);
    };
  
    await startRebuyMonitoring(symbol, quantity, rebuyPercentage);
  }
  
public stopTrade(): void {
    Object.keys(this.activeMonitoringIntervals).forEach(symbol => {
        clearInterval(this.activeMonitoringIntervals[symbol]);
        delete this.activeMonitoringIntervals[symbol];
    });
    console.log('All trading activities stopped.');
}

public getProfitTarget(): number {
    return this.profitTarget;
}

public async verifySubscription(userEmail: string): Promise<void> {
  const user = await this.userRepository.findByEmail(userEmail);
  if (!user || !user.has_subscription) {
    throw new UnauthorizedException('You do not have an active subscription.');
  }
}
public getStatus(): Record<string, any> {
  return {
    activeTrades: Object.keys(this.purchasePrices),
    purchasePrices: this.purchasePrices,
    profitTarget: this.profitTarget,
    accumulatedProfit: this.accumulatedProfit,
    skyrocketProfitMode: this.skyrocketProfitMode,
    activeMonitoringIntervals: Object.keys(this.activeMonitoringIntervals),
    startDayTimestamp: new Date(this.startDayTimestamp).toISOString(),
  };
}
}