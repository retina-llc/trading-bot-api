// src/trading/trading.service.ts

import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import * as ccxt from 'ccxt';
import { getUserLogger } from './logger'; // Import the logger factory
import { getTopTrendingCoinsForTheDay } from './gainer';
import { UserRepository } from './user/user-repository';
import { SymbolHelper } from './utils/symbol.helper'; // Ensure correct path

const BITMART_API_URL = 'https://api-cloud.bitmart.com';
interface UserTradeState {
  purchasePrices: Record<string, { price: number; timestamp: number; quantity: number; sold?: boolean }>;
  profitTarget: number;
  accumulatedProfit: number;
  startDayTimestamp: number;
  payloadLogs: Record<string, any[]>;
  monitorIntervals: Record<string, NodeJS.Timeout>;
  activeMonitoringIntervals: Record<string, NodeJS.Timeout>;
}
@Injectable()
export class TradingService {
  private payloadLogs: Record<string, any[]> = {};
  private purchasePrices: Record<string, { price: number; timestamp: number; quantity: number; sold?: boolean }> = {};
  private monitorIntervals: Record<string, NodeJS.Timeout> = {};
  private profitTarget: number = 0;
  private accumulatedProfit: number = 0;
  private startDayTimestamp: number = 0;
  private skyrocketProfitMode: boolean = false;
  private skyrocketProfitTarget: number = 0;
  private activeMonitoringIntervals: Record<string, NodeJS.Timeout> = {};
  private userTrades = new Map<number, UserTradeState>();

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
      verbose: true, // Enable verbose logging for debugging
      options: {
        createMarketBuyOrderRequiresPrice: false, // Disable price requirement
      },
    });

    await exchange.loadMarkets(); // Load markets

    const monitoringExchange = new ccxt.bitmart({
      apiKey: monitoringApiKey,
      secret: monitoringApiSecret,
      uid: monitoringApiMemo,
      verbose: true, // Enable verbose logging for debugging
      options: {
        createMarketBuyOrderRequiresPrice: false, // Disable price requirement
      },
    });

    await monitoringExchange.loadMarkets(); // Load markets for monitoring exchange

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
  private getUserTradeState(userId: number): UserTradeState {
    let state = this.userTrades.get(userId);
    if (!state) {
      state = {
        purchasePrices: {},
        profitTarget: 0,
        accumulatedProfit: 0,
        startDayTimestamp: Date.now(),
        payloadLogs: {},
        monitorIntervals: {},
        activeMonitoringIntervals: {},
      };
      this.userTrades.set(userId, state);
    }
    return state;
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
  
// Add this helper method inside your TradingService class
private async ensureSellCompleted(
  userId: number,
  symbol: string,
  expectedSoldQuantity: number
): Promise<void> {
  const logger = getUserLogger(userId);
  let retries = 0;
  const maxRetries = 3;
  const valueThreshold = 1.0; // The threshold value in USD
  
  // Wait a few seconds before checking after the sell order.
  await new Promise((resolve) => setTimeout(resolve, 5000));

  while (retries < maxRetries) {
    try {
      // Check the available quantity of the asset for the given symbol.
      const remainingQuantity = await this.getAvailableQuantity(userId, symbol);
      // Get the current market price for the symbol
      const currentPrice = await this.fetchTicker(symbol);
      // Calculate the dollar value of the remaining asset
      const remainingValue = remainingQuantity * currentPrice;
  
      // If the remaining dollar value is less than $1.00, consider the sell complete.
      if (remainingValue < valueThreshold) {
        logger.info(`Sell confirmed for ${symbol}. Remaining value ($${remainingValue.toFixed(2)}) is below $${valueThreshold}.`);
        return;
      } else {
        logger.warn(
          `Sell order for ${symbol} not fully executed. Remaining value: $${remainingValue.toFixed(2)}. Reattempting sell...`
        );
        // Attempt to sell the remaining quantity
        await this.placeOrder(userId, symbol, 'sell', remainingQuantity);
      }
    } catch (error) {
      logger.error(
        `Error during sell confirmation for ${symbol}: ${(error as Error).message}`
      );
    }
    retries++;
    // Wait before the next retry
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  logger.error(
    `Failed to fully execute sell order for ${symbol} after ${maxRetries} attempts.`
  );
}

  public getAccumulatedProfit(): number {
    return this.accumulatedProfit;
  }

  /**
   * Retrieves the user's balance for a specific currency.
   * @param userId - The ID of the user.
   * @param currency - The currency symbol (default: 'USDT').
   * @returns The available balance.
   */
  public async getUserBalance(userId: number, currency: string = 'USDT'): Promise<number> {
    const logger = getUserLogger(userId); // Retrieve user-specific logger
    const url = `${BITMART_API_URL}/account/v1/wallet`;
    
    try {
      logger.info('Starting balance fetch process.');
      
      // Log the URL being accessed
      console.log(`[getUserBalance] URL: ${url}`);
      
      // Retrieve authentication headers
      const headers = await this.getAuthHeaders(userId, '/account/v1/wallet', 'GET', '', {});
      
      // Log the headers being used (excluding sensitive information)
      console.log(`[getUserBalance] Headers:`, {
        'X-BM-KEY': headers['X-BM-KEY'] ? '****' : null,
        'X-BM-TIMESTAMP': headers['X-BM-TIMESTAMP'],
        'X-BM-MEMO': headers['X-BM-MEMO'] ? '****' : null,
        'Content-Type': headers['Content-Type'],
      });
      
      logger.info('Fetching user balance from BitMart API.');
      
      // Make the API request to fetch the wallet information
      const response = await axios.get(url, { headers });
      
      // Log the full API response for debugging purposes
      console.log(`[getUserBalance] API Response:`, JSON.stringify(response.data, null, 2));
      
      // Ensure that the response structure is as expected
      if (
        !response.data ||
        !response.data.data ||
        !Array.isArray(response.data.data.wallet)
      ) {
        logger.error('Unexpected API response structure:', response.data);
        throw new Error('Unexpected API response structure');
      }
      
      // Find the balance entry for the specified currency
      const balanceEntry = response.data.data.wallet.find(
        (b: any) => b.currency.toUpperCase() === currency.toUpperCase()
      );
      
      // Log the found balance entry
      if (balanceEntry) {
        console.log(`[getUserBalance] Found ${currency} Balance:`, balanceEntry);
      } else {
        console.warn(`[getUserBalance] ${currency} balance not found in wallet data.`);
      }
      
      // Parse the available balance
      const availableBalance = balanceEntry ? parseFloat(balanceEntry.available) : 0;
      
      // Log the parsed available balance
      console.log(`[getUserBalance] Available ${currency} Balance: ${availableBalance}`);
      
      logger.info(`User balance retrieved successfully: ${availableBalance} ${currency}`);
      
      return availableBalance;
    } catch (error: unknown) {
      const err = error as any; // Type assertion
      
      // Log the error details
      console.error('[getUserBalance] Error fetching user balance:', {
        message: err.message || 'Unknown error',
        stack: err.stack || 'No stack trace available',
        response: err.response ? JSON.stringify(err.response.data, null, 2) : 'No response data',
      });
      
      logger.error('Error fetching user balance:', err.message || 'Unknown error');
      throw new Error('Failed to fetch user balance');
    }
  }

  /**
   * Fetches the latest ticker price for a given symbol.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @returns The last traded price.
   */
  private async fetchTicker(symbol: string): Promise<number> {
    const formattedSymbol = SymbolHelper.toCCXTSymbol(symbol); // Convert to "PWC/USDT"
    const apiSymbol = symbol; // Use original symbol for API URL

    const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${apiSymbol}`;
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

  /**
   * Retrieves the available quantity for selling.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @returns The available quantity.
   */
  public async getAvailableQuantity(userId: number, symbol: string): Promise<number> {
    try {
      const url = `${BITMART_API_URL}/account/v1/wallet`;
      const headers = await this.getAuthHeaders(userId, '/account/v1/wallet', 'GET', '', {});
      const response = await axios.get(url, { headers });

      const balances = response.data.data.wallet;
      const asset = balances.find((b: any) => b.currency.toUpperCase() === symbol.split('_')[0].toUpperCase());

      const available = asset ? parseFloat(asset.available) : 0;

      console.log(`[getAvailableQuantity] Available balance for ${symbol.split('_')[0]}: ${available}`);

      return available;
    } catch (error: unknown) {
      const err = error as any;
      console.error('Error fetching available quantity:', err.message || 'Unknown error');
      throw new Error('Failed to fetch available quantity');
    }
  }
  /**
   * Floors a number to a specified precision.
   * @param value - The number to floor.
   * @param precision - The number of decimal places.
   * @returns The floored number.
   */
  private floorToPrecision(value: number, precision: number): number {
    const factor = Math.pow(10, precision);
    return Math.floor(value * factor) / factor;
  }
  /**
   * Places a buy or sell order.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @param side - 'buy' or 'sell'.
   * @param amount - The amount to buy (notional) or sell (quantity).
   */
  public async placeOrder(
    userId: number,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number = 0 // Default value for `amount` is set to 0
  ): Promise<void> {
    try {
      const { exchange } = await this.initializeExchanges(userId);
      const logger = getUserLogger(userId);
  
      const formattedSymbol = SymbolHelper.toCCXTSymbol(symbol);
      const market = exchange.markets[formattedSymbol];
      if (!market) {
        throw new Error(`Market info not found for symbol: ${formattedSymbol}`);
      }
  
      let payload: Record<string, any> = {};
      const parsedAmount = Number(amount); // Ensure amount is a number
  
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error(`Invalid amount provided for ${side} order: ${amount}`);
      }
  
      if (side === 'buy') {
        const baseCurrency = market.quote; // e.g., "USDT"
        if (!baseCurrency) {
          throw new Error('Unable to determine base currency from symbol.');
        }
  
        // Use balance if `amount` is invalid
        if (parsedAmount <= 0) {
          const balance = await this.getUserBalance(userId, baseCurrency);
          if (!Number.isFinite(balance) || balance <= 0) {
            throw new Error('Insufficient balance for buying.');
          }
          amount = balance;
        }
  
        // Validate and round `amount`
        const precision = market.precision.price || 8; // Default to 8 if undefined
        const cost = parseFloat(parsedAmount.toFixed(precision));
        if (!Number.isFinite(cost) || cost <= 0) {
          throw new Error('Invalid cost calculated for buying.');
        }
  
        payload = {
          symbol: formattedSymbol,
          side: 'buy',
          amount: cost,
        };
  
        logger.info(`[placeOrder][BUY] Payload: ${JSON.stringify(payload)}`);
  
        // Place a market buy order
        const order = await exchange.createMarketBuyOrder(formattedSymbol, cost);
  
        // Log and validate the response
        logger.info(`Market BUY order placed successfully: ${JSON.stringify(order)}`);
        if (!order || typeof order !== 'object') {
          throw new Error('Invalid order response received from exchange.');
        }
      } else if (side === 'sell') {
        const baseCurrency = symbol.split('_')[0]; // Extract base currency
        const realTimeQuantity = await this.getAvailableQuantity(userId, baseCurrency);
  
        logger.info(`[placeOrder][SELL] Real-time available quantity for ${baseCurrency}: ${realTimeQuantity}`);
  
        if (realTimeQuantity <= 0) {
          throw new Error(`[placeOrder][SELL] No available balance for ${baseCurrency}.`);
        }
  
        const currentPrice = await this.fetchTicker(symbol);
        logger.info(`[placeOrder][SELL] Current price for ${symbol}: ${currentPrice}`);
  
        // Calculate sell value and validate
        const precisionAmount = market.precision.amount || 2; // Adjust based on market
        const precisionPrice = market.precision.price || 8; // Default precision if undefined
  
        // Floor the quantity to prevent exceeding available balance
        let roundedQuantity = this.floorToPrecision(realTimeQuantity, precisionAmount);
  
        // Additional check to ensure roundedQuantity does not exceed realTimeQuantity
        if (roundedQuantity > realTimeQuantity) {
          throw new Error(`Rounded quantity (${roundedQuantity}) exceeds available balance (${realTimeQuantity}).`);
        }
  
        const estimatedSellValue = parseFloat((roundedQuantity * currentPrice).toFixed(precisionPrice));
  
        logger.info(`[placeOrder][SELL] Calculated sell value for ${symbol}: $${estimatedSellValue}`);
        logger.info(`[placeOrder][SELL] Rounded quantity: ${roundedQuantity}`);
  
        if (estimatedSellValue < 5) { // Minimum sell value
          throw new Error(`Sell order value ($${estimatedSellValue.toFixed(2)}) is below the minimum requirement.`);
        }
  
        payload = {
          symbol: formattedSymbol,
          side: 'sell',
          amount: roundedQuantity,
        };
  
        logger.info(`[placeOrder][SELL] Payload: ${JSON.stringify(payload)}`);
  
        // Place a market sell order
        const order = await exchange.createMarketSellOrder(formattedSymbol, roundedQuantity);
  
        // Log and validate the response
        logger.info(`Market SELL order placed successfully: ${JSON.stringify(order)}`);
        if (!order || typeof order !== 'object') {
          throw new Error('Invalid order response received from exchange.');
        }
      }
  
      // Log payload for debugging
      if (!this.payloadLogs[symbol]) {
        this.payloadLogs[symbol] = [];
      }
      this.payloadLogs[symbol].push(payload);
    } catch (error: any) {
      const logger = getUserLogger(userId);
      logger.error(`Error placing ${side} order for ${symbol}: ${error.message}`, {
        stack: error.stack,
        symbol,
        side,
        amount,
      });
      throw new Error(`Failed to place ${side} order for ${symbol}: ${error.message}`);
    }
  }
  /**
   * Starts a trade by placing a buy order and initiating monitoring.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @param amount - The amount to invest.
   * @param rebuyPercentage - The percentage to rebuy on conditions.
   * @param profit   Target - The target profit to achieve before stopping.
   * @returns An object containing trade details.
   */
  public async startTrade(
    userId: number,
    symbol: string,
    amount: number,
    rebuyPercentage: number,
    profitTarget: number
  ): Promise<any> {
    try {
      if (!symbol || amount <= 4) {
        throw new Error('Invalid symbol or amount. Amount must be greater than 4.');
      }
  
      // Fetch user balance
      const balance = await this.getUserBalance(userId, 'USDT'); // Assuming USDT is the quote currency
      if (balance <= 0) {
        throw new Error('Insufficient USDT balance to start trade.');
      }
  
      if (amount > balance) {
        throw new Error(`Requested amount (${amount} USDT) exceeds available balance (${balance} USDT).`);
      }
  
      // Fetch the latest price of the symbol
      const lastPrice = await this.fetchTicker(symbol);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
        throw new Error(`Invalid last price fetched for symbol: ${symbol}.`);
      }
  
      // Calculate purchase quantity
      const purchaseQuantity = amount / lastPrice;
      if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) {
        throw new Error(`Invalid purchase quantity calculated for ${symbol}.`);
      }
  
      console.log(
        `Placing buy order for symbol: ${symbol}, amount: ${amount}, purchaseQuantity: ${purchaseQuantity}`
      );
  
      // Place a buy order with the correct cost
      await this.placeOrder(userId, symbol, 'buy', amount);
  
      console.log(`Buy order placed successfully for symbol: ${symbol}, purchaseQuantity: ${purchaseQuantity}`);
  
      // Save the purchase price and initialize monitoring
      this.purchasePrices[symbol] = { price: lastPrice, timestamp: Date.now(), quantity: purchaseQuantity };
      this.profitTarget = profitTarget;
      this.accumulatedProfit = 0;
      this.startDayTimestamp = Date.now();
  
      // Start continuous monitoring
      this.startContinuousMonitoring(userId, symbol, purchaseQuantity, rebuyPercentage);
  
      return { symbol, amount, remainingBalance: balance - amount };
    } catch (error: unknown) {
      const err = error as Error;
      console.error(`[startTrade] Error starting trade for ${symbol}: ${err.message}`);
      throw new Error(`Failed to start trade: ${err.message}`);
    }
  }
  
  
  /**
   * Calculates profit based on purchase price, quantity, and sell price.
   * @param symbol - The trading symbol.
   * @param quantity - The quantity bought.
   * @param sellPrice - The current sell price.
   * @returns The calculated profit.
   */
  private async calculateProfit(symbol: string, quantity: number, sellPrice: number): Promise<number> {
    const purchase = this.purchasePrices[symbol];
    if (!purchase) {
      throw new Error('Purchase price not found');
    }
    const purchasePrice = purchase.price;
    const profit = (sellPrice - purchasePrice) * quantity;
    return profit;
  }

  /**
   * Checks if accumulated profit has reached the target and handles selling if necessary.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol.
   * @param quantity - The quantity bought.
   * @param sellPrice - The current sell price.
   */
  private async checkAndHandleProfit(
    userId: number,
    symbol: string,
    quantity: number,
    sellPrice: number
  ): Promise<void> {
    const profit = await this.calculateProfit(symbol, quantity, sellPrice);
    this.accumulatedProfit += profit;
    console.log(`Accumulated Profit: ${this.accumulatedProfit}`);
  
    if (this.accumulatedProfit >= this.profitTarget) {
      console.log(`Profit target of ${this.profitTarget} reached. Selling and stopping trade.`);
      await this.placeOrder(userId, symbol, 'sell', quantity);
      
      // Ensure the sell actually went through (if not, reattempt the sell)
      await this.ensureSellCompleted(userId, symbol, quantity);
  
      // Mark trade as sold once the sell is confirmed
      this.purchasePrices[symbol] = {
        ...this.purchasePrices[symbol],
        sold: true,
        quantity: 0,
      };
      this.stopTrade();
    }
  }
  
  private isNewDay(): boolean {
    const oneDayInMillis = 24 * 60 * 60 * 1000;
    return (Date.now() - this.startDayTimestamp) >= oneDayInMillis;
  }

  /**
   * Starts continuous monitoring of the market for price changes.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format.
   * @param quantity - The quantity bought.
   * @param rebuyPercentage - The percentage to rebuy on conditions.
   */
  private async startContinuousMonitoring(
    userId: number,
    symbol: string,
    quantity: number,
    rebuyPercentage: number
  ) {
    const logger = getUserLogger(userId);
    
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
    
        // Check residual value threshold before proceeding
        // For example, if the current position value is less than $1, mark as sold.
        const residualValue = purchase.quantity * currentPrice;
        const minimumTradeValue = 1.0; // $1.00 threshold
        if (residualValue < minimumTradeValue) {
          logger.info(`Residual value (${residualValue.toFixed(2)} USDT) is below threshold. Marking ${symbol} as closed.`);
          purchase.quantity = 0;
          purchase.sold = true;
          clearInterval(this.monitorIntervals[symbol]);
          return;
        }
    
        const purchasePrice = purchase.price;
        const priceDrop = (purchasePrice - currentPrice) / purchasePrice;
        const profit = (currentPrice - purchasePrice) / purchasePrice;
    
        logger.info(`Purchase price for ${symbol}: ${purchasePrice}`);
        logger.info(`Price drop for ${symbol}: ${(priceDrop * 100).toFixed(2)}%`);
        logger.info(`Current profit for ${symbol}: ${(profit * 100).toFixed(2)}%`);
    
        if (priceDrop >= 0.08) {
          logger.info(`Price dropped by 8% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          await this.ensureSellCompleted(userId, symbol, quantity);
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
          this.purchasePrices[symbol] = {
            ...this.purchasePrices[symbol],
            price: currentPrice,
            quantity: 0,
            sold: true,
          };
        
          logger.info(`Waiting for 15 seconds before starting monitorAfterSale for ${symbol}.`);
          setTimeout(() => {
            this.monitorAfterSale(userId, symbol, quantity, currentPrice, rebuyPercentage);
          }, 15000);
        } else if (profit >= 0.065) {
          logger.info(`Profit of 6.5% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          await this.ensureSellCompleted(userId, symbol, quantity);
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
          this.purchasePrices[symbol] = {
            ...this.purchasePrices[symbol],
            sold: true,
          };
          logger.info(`Waiting for 15 seconds before starting monitorAfterSale for ${symbol}.`);
          setTimeout(() => {
            this.monitorAfterSale(userId, symbol, quantity, currentPrice, rebuyPercentage);
          }, 15000);
        } else if (profit >= 0.065) {
          logger.info(`Profit of 6.5% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
          this.purchasePrices[symbol] = {
            ...this.purchasePrices[symbol],
            sold: true,
          };
          logger.info(`Waiting for 15 seconds before starting monitorAfterSale for ${symbol}.`);
          setTimeout(() => {
            this.monitorAfterSale(userId, symbol, quantity, currentPrice, rebuyPercentage);
          }, 15000);
        } else if (this.accumulatedProfit >= this.profitTarget) {
          logger.info(`Accumulated profit target reached for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          this.stopTrade();
        } else if (Date.now() - purchase.timestamp <= 60000 && profit >= 0.05) {
          logger.info(`5% profit in 1 minute for ${symbol}. Waiting for further changes.`);
          await this.waitForSkyrocketingProfit(userId, symbol, quantity, rebuyPercentage);
        }
      } catch (error) {
        logger.error('Error checking price and selling: ' + (error as Error).message);
      }
    }, 10000);
  }
  

  /**
   * Waits for skyrocketing profit conditions and handles selling.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol.
   * @param quantity - The quantity bought.
   * @param rebuyPercentage - The percentage to rebuy on conditions.
   */
  private async waitForSkyrocketingProfit(
    userId: number,
    symbol: string,
    quantity: number,
    rebuyPercentage: number
  ) {
    const logger = getUserLogger(userId); // Retrieve user-specific logger

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

        if (profit >= 0.1) { // 10% profit
          logger.info(`Skyrocketing profit of 10% reached for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, 'sell', quantity);
          this.stopTrade();
          clearInterval(checkSkyrocketingProfit);
        }
      } catch (error) {
        logger.error(`Error in waitForSkyrocketingProfit: ${(error as Error).message}`);
      }
    }, 60000); // Check every 1 minute

    setTimeout(async () => clearInterval(checkSkyrocketingProfit), 240000); // Stop after 4 minutes
  }

  /**
   * Monitors after a sale to potentially rebuy based on market conditions.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol.
   * @param quantity - The quantity bought.
   * @param sellPrice - The price at which the asset was sold.
   * @param rebuyPercentage - The percentage to rebuy on conditions.
   */
  private async monitorAfterSale(
    userId: number,
    symbol: string,
    quantity: number,
    sellPrice: number,
    rebuyPercentage: number
  ): Promise<void> {
    const logger = getUserLogger(userId); // Retrieve user-specific logger
  
    // Mark trade as monitoring after sale
    if (!this.purchasePrices[symbol]) {
      this.purchasePrices[symbol] = { price: sellPrice, timestamp: Date.now(), quantity, sold: true };
    } else {
      this.purchasePrices[symbol].sold = true;
    }
  
    logger.info(`Monitoring after sale for ${symbol}.`);
  
    const startRebuyMonitoring = async (
      currentSymbol: string,
      quantity: number,
      rebuyPercentage: number
    ) => {
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
  
          if (priceIncrease >= 0.002) { // 0.2% increase
            logger.info(`Price increased by 0.2% or more for ${currentSymbol}.`);
  
            const availableBalance = await this.getUserBalance(userId);
            logger.info(`User balance: ${availableBalance}`);
  
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100; // e.g., 10 USDT
            const rebuyQuantity = amountToRebuy / currentPrice;
  
            if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
              // Pass 'amountToRebuy' as 'cost' to CCXT
              await this.placeOrder(userId, currentSymbol, 'buy', amountToRebuy);
              logger.info(`Buy order placed for ${currentSymbol} with cost: ${amountToRebuy} USDT`);
  
              this.purchasePrices[currentSymbol] = {
                price: currentPrice,
                timestamp: Date.now(),
                quantity: rebuyQuantity,
                sold: false, // Mark as active trade
              };
              clearInterval(checkRebuyInterval);
              this.startContinuousMonitoring(userId, currentSymbol, rebuyQuantity, rebuyPercentage);
            }
          } else if (priceDrop >= 0.05) { // 5% drop
            logger.info(`Price dropped by 5% or more for ${currentSymbol}.`);
  
            const availableBalance = await this.getUserBalance(userId);
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100; // e.g., 10 USDT
            const rebuyQuantity = amountToRebuy / currentPrice;
  
            if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
              // Pass 'amountToRebuy' as 'cost' to CCXT
              await this.placeOrder(userId, currentSymbol, 'buy', amountToRebuy);
              logger.info(`Buy order placed for ${currentSymbol} with cost: ${amountToRebuy} USDT`);
  
              this.purchasePrices[currentSymbol] = {
                price: currentPrice,
                timestamp: Date.now(),
                quantity: rebuyQuantity,
                sold: false, // Mark as active trade
              };
              clearInterval(checkRebuyInterval);
              this.startContinuousMonitoring(userId, currentSymbol, rebuyQuantity, rebuyPercentage);
            }
          }
  
          const timeElapsed = Date.now() - (this.purchasePrices[currentSymbol]?.timestamp || 0);
          if (timeElapsed >= 210000 && currentPrice !== undefined) { // 3.5 minutes
            initialPrice = currentPrice; // Safely reassign to a valid currentPrice
          }
        } catch (error) {
          logger.error(`Error in waitForSkyrocketingProfit: ${(error as Error).message}`);
        }
      }, 20000); // Check every 20 seconds
  
      this.activeMonitoringIntervals[currentSymbol] = checkRebuyInterval;
  
      setTimeout(async () => {
        if (
          !this.purchasePrices[currentSymbol] ||
          Date.now() - this.purchasePrices[currentSymbol].timestamp >= 3600000 // 1 hour
        ) {
          logger.info(`1 hour elapsed without rebuying ${currentSymbol}. Buying into the top trending coin for the day.`);
  
          const trendingCoins = await getTopTrendingCoinsForTheDay();
          if (trendingCoins.length > 0) {
            const topTrendingCoin = trendingCoins[0].symbol;
            const availableBalance = await this.getUserBalance(userId);
            const currentPrice = await this.fetchTicker(topTrendingCoin);
  
            if (currentPrice !== undefined && !isNaN(currentPrice)) {
              const amountToRebuy = (availableBalance * rebuyPercentage) / 100; // e.g., 10 USDT
              const rebuyQuantity = amountToRebuy / currentPrice;
  
              if (rebuyQuantity > 0 && rebuyQuantity * currentPrice <= availableBalance) {
                // Pass 'amountToRebuy' as 'cost' to CCXT
                await this.placeOrder(userId, topTrendingCoin, 'buy', amountToRebuy);
                this.purchasePrices[topTrendingCoin] = {
                  price: currentPrice,
                  timestamp: Date.now(),
                  quantity: rebuyQuantity,
                  sold: false, // Mark as active trade
                };
                this.startContinuousMonitoring(userId, topTrendingCoin, rebuyQuantity, rebuyPercentage);
              }
            }
          }
          clearInterval(this.activeMonitoringIntervals[currentSymbol]);
          delete this.activeMonitoringIntervals[currentSymbol];
        }
      }, 3600000); // Stop after 1 hour
    };
  
    // Start monitoring
    startRebuyMonitoring(symbol, quantity, rebuyPercentage);
  }
  
  /**
 * Stops all active trading activities.
 */
  public stopTrade(): void {
    // Clear monitorIntervals
    for (const symbol of Object.keys(this.monitorIntervals)) {
      const interval = this.monitorIntervals[symbol];
      if (interval) {
        clearInterval(interval);
        delete this.monitorIntervals[symbol];
        console.log(`Cleared monitorInterval for ${symbol}`);
      } else {
        console.warn(`No valid monitorInterval found for ${symbol}`);
      }
    }
  
    // Clear activeMonitoringIntervals
    for (const symbol of Object.keys(this.activeMonitoringIntervals)) {
      const interval = this.activeMonitoringIntervals[symbol];
      if (interval) {
        clearInterval(interval);
        delete this.activeMonitoringIntervals[symbol];
        console.log(`Cleared activeMonitoringInterval for ${symbol}`);
      } else {
        console.warn(`No valid activeMonitoringInterval found for ${symbol}`);
      }
    }
  
    console.log('All trading activities stopped.');
  }
  
    /**
     * Retrieves the profit target.
     * @returns The profit target.
     */
    public getProfitTarget(userId: number): number {
      const state = this.getUserTradeState(userId);
      return state.profitTarget;
    }
    /**
     * Verifies if the user has an active subscription.
     * @param userEmail - The email of the user.
     */
    public async verifySubscription(userEmail: string): Promise<void> {
      const user = await this.userRepository.findByEmail(userEmail);
      if (!user || !user.has_subscription) {
        throw new UnauthorizedException('You do not have an active subscription.');
      }
    }

    /**
     * Retrieves the current status of trading activities.
     * @returns An object containing status details.
     */
    public getStatus(userId: number): Record<string, any> {
      const state = this.getUserTradeState(userId);
      return {
        activeTrades: Object.keys(state.purchasePrices).map((symbol) => ({
          symbol,
          monitoringStatus: state.purchasePrices[symbol]?.sold ? 'Monitoring After Sale' : 'Active',
        })),
        purchasePrices: state.purchasePrices,
        profitTarget: state.profitTarget,
        accumulatedProfit: state.accumulatedProfit,
        activeMonitoringIntervals: Object.keys(state.activeMonitoringIntervals),
        startDayTimestamp: new Date(state.startDayTimestamp).toISOString(),
        payloadLogs: state.payloadLogs,
      };
    }
      
}
