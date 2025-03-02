// src/trading/trading.service.ts

import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import axios from "axios";
import * as crypto from "crypto";
import * as ccxt from "ccxt";
import { getUserLogger } from "./logger"; // Import the logger factory
import { getTopTrendingCoinsForTheDay } from "./gainer";
import { UserRepository } from "./user/user-repository";
import { SymbolHelper } from "./utils/symbol.helper"; // Ensure correct path

const BITMART_API_URL = "https://api-cloud.bitmart.com";
interface PurchaseInfo {
  price: number;
  timestamp: number;
  quantity: number;
  sold?: boolean;
  rebuyPercentage?: number; // <-- declare here
  profitThresholds: number[]; // Array of profit percentages to sell at
}

interface UserTradeState {
  purchasePrices: Record<
    string,
    { price: number; timestamp: number; quantity: number; sold?: boolean; rebuyPercentage?: number; profitThresholds: number[]; }
  >;
  lastRecordedPrices: Record<string, number>; // New field to store last recorded current price
  profitTarget: number;
  accumulatedProfit: number;
  startDayTimestamp: number;
  payloadLogs: Record<string, any[]>;
  monitorIntervals: Record<string, NodeJS.Timeout>;
  activeMonitoringIntervals: Record<string, NodeJS.Timeout>;
  profitCheckThreshold: number;     // For normal trading
  lossCheckThreshold: number;       // For normal trading
  afterSaleProfitThreshold: number; // For after-sale monitoring
  afterSaleLossThreshold: number;   // For after-sale monitoring
  profitThresholds: number[]; // Default thresholds for new trades
  activeTrades: string[];
  afterSaleMonitorIntervals: { [key: string]: NodeJS.Timeout };
}
@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private payloadLogs: Record<string, any[]> = {};
  private purchasePrices: Record<
    string,
    { price: number; timestamp: number; quantity: number; sold?: boolean }
  > = {};
  private monitorIntervals: Record<string, NodeJS.Timeout> = {};
  private profitTarget: number = 0;
  private accumulatedProfit: number = 0;
  private startDayTimestamp: number = 0;
  private skyrocketProfitMode: boolean = false;
  private skyrocketProfitTarget: number = 0;
  private activeMonitoringIntervals: Record<string, NodeJS.Timeout> = {};
  private userTrades = new Map<number, UserTradeState>();
  private userTradeStates: Map<number, UserTradeState> = new Map();
  private DEFAULT_PROFIT_THRESHOLDS = [1, 3]; // Default profit percentages

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
      throw new UnauthorizedException("API keys not found for this user");
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
      throw new UnauthorizedException("Incomplete API keys for this user");
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
    memo: string,
  ): string {
    const bodyString =
      body && Object.keys(body).length > 0 ? JSON.stringify(body) : "";
    const preHashString = `${timestamp}#${memo}#${httpMethod}#${url}${queryString ? "?" + queryString : ""}${bodyString}`;
    return crypto
      .createHmac("sha256", secretKey)
      .update(preHashString)
      .digest("hex");
  }

  private async getAuthHeaders(
    userId: number,
    endpoint: string,
    method: string,
    queryString: string,
    body: any,
  ): Promise<any> {
    const { bitmartApiKey, bitmartApiSecret, bitmartApiMemo } =
      await this.getUserApiKeys(userId);
    const timestamp = Date.now().toString();
    const urlPath = endpoint.replace(BITMART_API_URL, "");
    const signature = this.generateSignature(
      method,
      urlPath,
      timestamp,
      queryString,
      body,
      bitmartApiSecret,
      bitmartApiMemo,
    );

    return {
      "X-BM-KEY": bitmartApiKey,
      "X-BM-SIGN": signature,
      "X-BM-TIMESTAMP": timestamp,
      "X-BM-MEMO": bitmartApiMemo,
      "Content-Type": "application/json",
    };
  }
  private getUserTradeState(userId: number): UserTradeState {
    let state = this.userTrades.get(userId);
    if (!state) {
      state = this.initializeTradeState(userId);
    }
    return state; // Now state is guaranteed to be UserTradeState
  }
  private async getMonitoringAuthHeaders(
    userId: number,
    endpoint: string,
    method: string,
    queryString: string,
    body: any,
  ): Promise<any> {
    const { monitoringApiKey, monitoringApiSecret, monitoringApiMemo } =
      await this.getUserApiKeys(userId);
    const timestamp = Date.now().toString();
    const urlPath = endpoint.replace(BITMART_API_URL, "");
    const signature = this.generateSignature(
      method,
      urlPath,
      timestamp,
      queryString,
      body,
      monitoringApiSecret,
      monitoringApiMemo,
    );

    return {
      "X-BM-KEY": monitoringApiKey,
      "X-BM-SIGN": signature,
      "X-BM-TIMESTAMP": timestamp,
      "X-BM-MEMO": monitoringApiMemo,
      "Content-Type": "application/json",
    };
  }

  // Add this helper method inside your TradingService class
  private async ensureSellCompleted(
    userId: number,
    symbol: string,
    expectedSoldQuantity: number,
  ): Promise<void> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);

    try {
      // Check if already sold
      if (state.purchasePrices[symbol]?.sold) {
        logger.info(`${symbol} already marked as sold, proceeding to after-sale monitoring`);
        const rebuyPercentage = state.purchasePrices[symbol]?.rebuyPercentage || 10;
        await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
        return;
      }

      // Get remaining balance with retry
      const remainingQuantity = await this.getSymbolBalance(userId, symbol);
      const currentPrice = await this.fetchTickerWithRetry(symbol);
      const remainingValue = remainingQuantity * currentPrice;

      if (remainingValue < 1) {
        logger.info(`Sell confirmed for ${symbol}. Remaining value ($${remainingValue.toFixed(2)}) is below $1.`);
        
        // Update state ONCE
        if (state.purchasePrices[symbol]) {
          state.purchasePrices[symbol].sold = true;
          state.purchasePrices[symbol].quantity = 0;
        }

        // Handle profit calculation
        await this.checkAndHandleProfit(userId, symbol, expectedSoldQuantity, currentPrice);

        // Start after-sale monitoring ONCE
        const rebuyPercentage = state.purchasePrices[symbol]?.rebuyPercentage || 10;
        logger.info(`Transitioning to after-sale monitoring for ${symbol}`);
        await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
        return;
      }

      throw new Error(`Sell not fully confirmed for ${symbol}. Remaining value: $${remainingValue.toFixed(2)}`);
    } catch (error) {
      logger.error(`Error during sell confirmation for ${symbol}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  public getAccumulatedProfit(userId: number): number {
    const state = this.getUserTradeState(userId);
  
    if (!state) {
      return 0;
    }
  
    return state.accumulatedProfit;
  }
  

  /**
   * Retrieves the user's balance for a specific currency.
   * @param userId - The ID of the user.
   * @param currency - The currency symbol (default: 'USDT').
   * @returns The available balance.
   */
  public async getUserBalance(
    userId: number,
    currency: string = "USDT",
  ): Promise<number> {
    const logger = getUserLogger(userId);
    const url = `${BITMART_API_URL}/account/v1/wallet`;

    try {
      logger.info("Starting balance fetch process.");

      const headers = await this.getAuthHeaders(
        userId,
        "/account/v1/wallet",
        "GET",
        "",
        {},
      );

      logger.info("Fetching user balance from BitMart API.");

      const response = await axios.get(url, { headers });

      if (
        !response.data ||
        !response.data.data ||
        !Array.isArray(response.data.data.wallet)
      ) {
        logger.error("Unexpected API response structure");
        throw new Error("Unexpected API response structure");
      }

      const balanceEntry = response.data.data.wallet.find(
        (b: any) => b.currency.toUpperCase() === currency.toUpperCase(),
      );

      const availableBalance = balanceEntry
        ? parseFloat(balanceEntry.available)
        : 0;

      logger.info(
        `User balance retrieved successfully: ${availableBalance} ${currency}`,
      );

      return availableBalance;
    } catch (error: unknown) {
      const err = error as any;
      logger.error(
        "Error fetching user balance:",
        err.message || "Unknown error",
      );
      throw new Error("Failed to fetch user balance");
    }
  }

  /**
   * Fetches the latest ticker price for a given symbol.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @returns The last traded price.
   */
  private async fetchTicker(symbol: string): Promise<number> {
    const formattedSymbol = SymbolHelper.toCCXTSymbol(symbol);
    const apiSymbol = symbol;
    const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${apiSymbol}`;

    try {
      const response = await axios.get(url);
      const tickers = response.data.data.tickers;
      
      if (!tickers || tickers.length === 0) {
        throw new Error(`No ticker data available for symbol: ${symbol}`);
      }

      const lastPrice = parseFloat(tickers[0].last_price);
      if (isNaN(lastPrice)) {
        throw new Error(`Invalid last price value for symbol: ${symbol}`);
      }

      return lastPrice;
    } catch (error: any) {
      throw new Error(`Failed to fetch ticker data for ${symbol}`);
    }
  }

  /**
   * Retrieves the available quantity for selling.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @returns The available quantity.
   */
  public async getAvailableQuantity(
    userId: number,
    symbol: string,
  ): Promise<number> {
    try {
      const url = `${BITMART_API_URL}/account/v1/wallet`;
      const headers = await this.getAuthHeaders(
        userId,
        "/account/v1/wallet",
        "GET",
        "",
        {},
      );
      const response = await axios.get(url, { headers });

      const balances = response.data.data.wallet;
      const asset = balances.find(
        (b: any) =>
          b.currency.toUpperCase() === symbol.split("_")[0].toUpperCase(),
      );

      const available = asset ? parseFloat(asset.available) : 0;

      return available;
    } catch (error: unknown) {
      const err = error as any;
      throw new Error("Failed to fetch available quantity");
    }
  }

  private async getSymbolBalance(userId: number, symbol: string): Promise<number> {
    const baseCurrency = symbol.split('_')[0];
    return await this.getAvailableQuantity(userId, symbol);
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
    side: "buy" | "sell",
    amount: number = 0,
    fallbackPrice?: number // Optional parameter for fallback price
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
      const parsedAmount = Number(amount);
  
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error(`Invalid amount provided for ${side} order: ${amount}`);
      }
  
      if (side === "buy") {
        const baseCurrency = market.quote;
        if (!baseCurrency) {
          throw new Error("Unable to determine base currency from symbol.");
        }
  
        if (parsedAmount <= 0) {
          const balance = await this.getUserBalance(userId, baseCurrency);
          if (!Number.isFinite(balance) || balance <= 0) {
            throw new Error("Insufficient balance for buying.");
          }
          amount = balance;
        }
  
        const precision = market.precision.price || 8;
        const cost = parseFloat(parsedAmount.toFixed(precision));
        if (!Number.isFinite(cost) || cost <= 0) {
          throw new Error("Invalid cost calculated for buying.");
        }
  
        payload = {
          symbol: formattedSymbol,
          side: "buy",
          amount: cost,
        };
  
        logger.info(`[placeOrder][BUY] Payload: ${JSON.stringify(payload)}`);
        const order = await exchange.createMarketBuyOrder(formattedSymbol, cost);
  
        logger.info(
          `Market BUY order placed successfully: ${JSON.stringify(order)}`
        );
        if (!order || typeof order !== "object") {
          throw new Error("Invalid order response received from exchange.");
        }
      } else if (side === "sell") {
        try {
          const baseCurrency = symbol.split("_")[0];
          const state = this.getUserTradeState(userId);
  
          const availableQuantity = await this.getAvailableQuantity(
            userId,
            baseCurrency
          );
  
          if (availableQuantity <= 0) {
            logger.error(
              `Real-time available quantity for ${baseCurrency} is 0. Cannot proceed with sell order.`
            );
            return;
          }
  
          let currentPrice: number;
          try {
            currentPrice = await this.fetchTicker(symbol);
          } catch (error) {
            if (state.lastRecordedPrices[symbol]) {
              currentPrice = state.lastRecordedPrices[symbol];
              logger.warn(
                `Failed to fetch current price for ${symbol}. Using last recorded monitoring price: ${currentPrice}`
              );
            } else {
              throw new Error(
                `Failed to fetch ticker data for ${symbol} and no recorded price available.`
              );
            }
          }
  
          const estimatedSellValue = availableQuantity * currentPrice;
  
          if (estimatedSellValue < 1) {
            logger.error(
              `Sell value too small for ${symbol}. Available Quantity: ${availableQuantity}, Current Price: ${currentPrice}, Estimated Value: ${estimatedSellValue}`
            );
            throw new Error(
              `Sell order value is too small to process for ${symbol}.`
            );
          }
  
          payload = {
            symbol: formattedSymbol,
            side: "sell",
            amount: availableQuantity,
          };
          logger.info(`[placeOrder][SELL] Payload: ${JSON.stringify(payload)}`);
  
          const order = await exchange.createMarketSellOrder(
            formattedSymbol,
            availableQuantity
          );
          logger.info(
            `Market SELL order placed successfully: ${JSON.stringify(order)}`
          );
          if (!order || typeof order !== "object") {
            throw new Error("Invalid order response received from exchange.");
          }
        } catch (sellError: unknown) {
          const errorDetails = sellError as Error;
          logger.error(
            `Error placing sell order for ${symbol}: ${errorDetails.message}`,
            {
              stack: errorDetails.stack,
            }
          );
          throw errorDetails;
        }
      }
  
      if (!this.payloadLogs[symbol]) {
        this.payloadLogs[symbol] = [];
      }
      this.payloadLogs[symbol].push(payload);
    } catch (error: unknown) {
      const logger = getUserLogger(userId);
      const errorDetails = error as Error;
      logger.error(`Error placing ${side} order for ${symbol}: ${errorDetails.message}`, {
        stack: errorDetails.stack,
        symbol,
        side,
        amount,
      });
      throw new Error(
        `Failed to place ${side} order for ${symbol}: ${errorDetails.message}`
      );
    }
  }
  
  /**
   * Starts a trade by placing a buy order and initiating monitoring.
   * @param userId - The ID of the user.
   * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
   * @param amount - The amount to invest.
   * @param rebuyPercentage - The percentage to rebuy on conditions.
   * @param profitTarget - The target profit to achieve before stopping.
   * @param profitThresholds - Optional custom thresholds for this trade
   * @returns An object containing trade details.
   */
  public async startTrade(
    userId: number,
    symbol: string,
    amount: number,
    rebuyPercentage: number,
    profitTarget: number,
    userProfitCheckThreshold?: number,
    userLossCheckThreshold?: number,
    profitThresholds?: number[]
  ): Promise<any> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);

    try {
      // Get user's saved thresholds from user entity
      const user = await this.userRepository.findOne({ where: { id: userId } });
      
      // Use saved thresholds, fallback to provided or defaults
      const effectiveProfitThreshold = userProfitCheckThreshold || 
        user?.profitThreshold || 
        0.008; // Default 0.8%

      const effectiveLossThreshold = userLossCheckThreshold || 
        user?.lossThreshold || 
        0.05;  // Default 5%

      logger.info(`Using thresholds for ${symbol}:`, {
        profitThreshold: `${(effectiveProfitThreshold * 100).toFixed(2)}%`,
        lossThreshold: `${(effectiveLossThreshold * 100).toFixed(2)}%`,
        source: user ? 'Saved Settings' : 'Defaults'
      });

      // Update state with correct thresholds
      state.profitCheckThreshold = effectiveProfitThreshold;
      state.lossCheckThreshold = effectiveLossThreshold;

      // Verify thresholds were set correctly
      logger.info(`Verified thresholds in state:`, {
        profitThreshold: `${(state.profitCheckThreshold * 100).toFixed(2)}%`,
        lossThreshold: `${(state.lossCheckThreshold * 100).toFixed(2)}%`
      });

      // Initialize state objects
      if (!state.purchasePrices) {
        state.purchasePrices = {};
      }
      if (!state.monitorIntervals) {
        state.monitorIntervals = {};
      }
      if (!state.activeTrades) {
        state.activeTrades = [];
      }

      logger.info(`Trade thresholds for ${symbol}:`, {
        profitTarget: `${(profitTarget * 100).toFixed(2)}%`,
        profitCheckThreshold: `${(state.profitCheckThreshold * 100).toFixed(2)}%`,
        lossCheckThreshold: `${(state.lossCheckThreshold * 100).toFixed(2)}%`,
        rebuyPercentage: `${rebuyPercentage}%`,
        profitThresholds: profitThresholds || [...state.profitThresholds]
      });

      const lastPrice = await this.fetchTicker(symbol);
      const purchaseQuantity = amount / lastPrice;

      // Place buy order
      await this.placeOrder(userId, symbol, "buy", amount);

      // Save purchase data BEFORE starting monitoring
      state.purchasePrices[symbol] = {
        price: lastPrice,
        timestamp: Date.now(),
        quantity: purchaseQuantity,
        rebuyPercentage,
        sold: false,
        profitThresholds: profitThresholds || [...state.profitThresholds],
      };

      // Save to active trades
      if (!state.activeTrades.includes(symbol)) {
        state.activeTrades.push(symbol);
      }

      // Update other state properties
      state.profitTarget = profitTarget;

      // Save state back to storage
      this.userTrades.set(userId, state);

      logger.info(`Purchase data saved for ${symbol} at price ${lastPrice}`);

      // Start monitoring
      await this.startContinuousMonitoring(
        userId,
        symbol,
        purchaseQuantity,
        rebuyPercentage
      );

      return {
        symbol,
        amount,
        purchasePrice: lastPrice,
        purchaseQuantity,
        profitTarget,
        isMonitoring: true
      };

    } catch (error) {
      logger.error(`Error starting trade: ${(error as Error).message}`);
      throw error;
    }
  }
  

  /**
   * Calculates profit based on purchase price, quantity, and sell price.
   * @param symbol - The trading symbol.
   * @param quantity - The quantity bought.
   * @param sellPrice - The current sell price.
   * @returns The calculated profit.
   */
  private async calculateProfit(
    userId: number,
    symbol: string,
    quantity: number,
    sellPrice: number,
  ): Promise<number> {
    const state = this.getUserTradeState(userId);
    const purchase = state.purchasePrices[symbol];

    if (!purchase) {
      throw new Error("Purchase price not found");
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
    sellPrice: number,
  ): Promise<void> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);
  
    try {
      logger.info(`[checkAndHandleProfit] Starting profit check for user: ${userId}, symbol: ${symbol}`);
      console.log(`[DEBUG][checkAndHandleProfit] Current state:`, {
        hasPurchasePrices: !!state.purchasePrices,
        symbolData: state.purchasePrices?.[symbol],
        quantity,
        sellPrice
      });
  
      // Initialize purchasePrices if it doesn't exist
      if (!state.purchasePrices) {
        state.purchasePrices = {};
      }
  
      const purchase = state.purchasePrices[symbol];
      if (!purchase) {
        console.log(`[DEBUG][checkAndHandleProfit] No purchase data found, attempting to recreate state`);
        
        // Recreate the purchase data if it's missing
        state.purchasePrices[symbol] = {
          price: sellPrice,  // Use the current sell price as the reference
          timestamp: Date.now(),
          quantity: quantity,
          sold: false,
          rebuyPercentage: 5, // Default value
          profitThresholds: [...state.profitThresholds]
        };
        
        console.log(`[DEBUG][checkAndHandleProfit] Recreated purchase data:`, state.purchasePrices[symbol]);
      }
  
      const purchasePrice = state.purchasePrices[symbol].price;
      const realizedProfit = (sellPrice - purchasePrice) * quantity;
  
      // Ensure profit values are calculated correctly
      const roundedProfit = parseFloat(realizedProfit.toFixed(2));
      if (isNaN(roundedProfit)) {
        logger.error(`[checkAndHandleProfit] Invalid profit calculated: ${realizedProfit}`);
        throw new Error("Invalid profit value calculated");
      }
  
      // Update accumulated profit
      state.accumulatedProfit += roundedProfit;
      state.accumulatedProfit = parseFloat(state.accumulatedProfit.toFixed(2)); // Normalize to two decimals
  
      console.log(`[DEBUG][checkAndHandleProfit] Profit calculation:`, {
        purchasePrice,
        sellPrice,
        quantity,
        realizedProfit: roundedProfit,
        accumulatedProfit: state.accumulatedProfit
      });
  
      // Log updated profit
      logger.info(`Accumulated profit updated for user ${userId}: ${state.accumulatedProfit.toFixed(2)} USDT`);
  
      // Persist the updated state
      this.userTrades.set(userId, state);
  
      // Check if profit target is reached
      if (state.accumulatedProfit >= state.profitTarget) {
        logger.info(`Profit target of ${state.profitTarget} reached. Stopping trades.`);
        this.stopTrade(userId);
        return;
      }

      // Update this part if it exists
      const rebuyPercentage = state.purchasePrices[symbol]?.rebuyPercentage || 5;
      await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
    } catch (error) {
      console.log(`[DEBUG][checkAndHandleProfit] Error:`, error);
      logger.error(
        `Error in checkAndHandleProfit for user ${userId}, symbol ${symbol}: ${(error as Error).message}`
      );
      throw error;
    }
  }  


  private isNewDay(state: UserTradeState): boolean {
    const oneDayInMillis = 24 * 60 * 60 * 1000;
    return Date.now() - state.startDayTimestamp >= oneDayInMillis;
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
    rebuyPercentage: number,
  ): Promise<void> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);
  
    try {
      // IMPORTANT: Clear ALL existing monitoring first
      if (state.afterSaleMonitorIntervals?.[symbol]) {
        clearInterval(state.afterSaleMonitorIntervals[symbol]);
        delete state.afterSaleMonitorIntervals[symbol];
        logger.info(`[startContinuousMonitoring] Forcefully cleared after-sale monitoring for ${symbol}`);
      }

      if (state.monitorIntervals?.[symbol]) {
        clearInterval(state.monitorIntervals[symbol]);
        delete state.monitorIntervals[symbol];
      }

      // Verify monitoring is cleared
      if (state.afterSaleMonitorIntervals?.[symbol] || state.monitorIntervals?.[symbol]) {
        logger.warn(`[startContinuousMonitoring] Detected lingering monitors for ${symbol}. Force clearing.`);
        state.afterSaleMonitorIntervals = {};
        state.monitorIntervals = {};
      }

      // Start new monitoring
      state.monitorIntervals[symbol] = setInterval(async () => {
        try {
          const currentPrice = await this.fetchTicker(symbol);
          const purchase = state.purchasePrices[symbol];

          if (!purchase || purchase.sold) {
            clearInterval(state.monitorIntervals[symbol]);
            delete state.monitorIntervals[symbol];
            logger.info(`Continuous monitoring stopped for ${symbol}`);
            return;
          }

          const purchasePrice = purchase.price;
          const priceChange = ((currentPrice - purchasePrice) / purchasePrice) * 100;

          // Separate profit and loss display
          const statusLog = `${symbol} - Price: ${currentPrice} | Buy: ${purchasePrice} | ${
            priceChange >= 0 
              ? `Profit: ${priceChange.toFixed(2)}% | Loss: 0.00%`
              : `Profit: 0.00% | Loss: ${Math.abs(priceChange).toFixed(2)}%`
          } | Targets: +${(state.profitCheckThreshold * 100).toFixed(2)}% / -${(state.lossCheckThreshold * 100).toFixed(2)}%`;

          logger.info(statusLog);

          if (priceChange >= (state.profitCheckThreshold * 100)) {
            logger.info(`Profit target reached for ${symbol}. Selling.`);
            
            // Stop continuous monitoring before selling
            clearInterval(state.monitorIntervals[symbol]);
            delete state.monitorIntervals[symbol];
            
            await this.placeOrder(userId, symbol, "sell", quantity);
            await this.ensureSellCompleted(userId, symbol, quantity);
            await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
            
            // Transition to monitoring after sale
            await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
            return;
          } else if (Math.abs(priceChange) >= (state.lossCheckThreshold * 100)) {
            logger.info(`Loss threshold reached for ${symbol}. Selling.`);
            
            // Stop continuous monitoring before selling
            clearInterval(state.monitorIntervals[symbol]);
            delete state.monitorIntervals[symbol];
            
            await this.placeOrder(userId, symbol, "sell", quantity);
            await this.ensureSellCompleted(userId, symbol, quantity);
            await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
            
            // Transition to monitoring after sale
            await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
            return;
          }

        } catch (error) {
          logger.error(`Error in continuous monitoring for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 5000);

      // Save clean state
      this.userTrades.set(userId, state);
      logger.info(`[startContinuousMonitoring] Successfully started new monitoring for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to start continuous monitoring for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async startMonitoringAfterSale(
    userId: number,
    symbol: string,
    rebuyPercentage: number
  ): Promise<void> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    
    // Get user's configured thresholds or use defaults
    const profitThreshold = (user?.afterSaleProfitThreshold ?? 0.2) * 100;  // Convert to percentage
    const lossThreshold = (user?.afterSaleLossThreshold ?? 0.35) * 100;

    try {
      const initialPrice = await this.fetchTickerWithRetry(symbol);
      
      // Clear any existing after-sale monitoring first
      if (state.afterSaleMonitorIntervals?.[symbol]) {
        clearInterval(state.afterSaleMonitorIntervals[symbol]);
        delete state.afterSaleMonitorIntervals[symbol];
      }

      state.afterSaleMonitorIntervals[symbol] = setInterval(async () => {
        try {
          const currentPrice = await this.fetchTickerWithRetry(symbol);
          if (!currentPrice || isNaN(currentPrice)) return;

          const priceChange = ((currentPrice - initialPrice) / initialPrice) * 100;
          
          logger.info(
            `After-Sale Monitor ${symbol} - Current: ${currentPrice.toFixed(5)} | ` +
            `Initial: ${initialPrice.toFixed(5)} | Change: ${priceChange.toFixed(2)}% | ` +
            `Rebuy at: +${profitThreshold}% / -${lossThreshold}%`
          );

          // If rebuy conditions met, FIRST clear the interval, THEN execute rebuy
          if (this.shouldRebuy(priceChange, profitThreshold, lossThreshold)) {
            // Clear interval BEFORE executing rebuy
            clearInterval(state.afterSaleMonitorIntervals[symbol]);
            delete state.afterSaleMonitorIntervals[symbol];
            this.userTrades.set(userId, state);
            
            logger.info(`[startMonitoringAfterSale] Cleared monitoring before rebuy for ${symbol}`);
            
            // Small delay to ensure interval is cleared
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Now execute rebuy
            await this.executeRebuy(userId, symbol, currentPrice, rebuyPercentage);
            return;
          }
        } catch (error) {
          logger.error(`Error in after-sale monitoring for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, 5000);

      this.userTrades.set(userId, state);
      logger.info(`Started after-sale monitoring for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to start after-sale monitoring for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeRebuy(
    userId: number,
    symbol: string,
    currentPrice: number,
    rebuyPercentage: number
  ): Promise<void> {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);

    try {
      // CRITICAL: Clear ALL monitoring before proceeding
      if (state.afterSaleMonitorIntervals?.[symbol]) {
        clearInterval(state.afterSaleMonitorIntervals[symbol]);
        delete state.afterSaleMonitorIntervals[symbol];
        // Clear the entire object to ensure no lingering references
        state.afterSaleMonitorIntervals = {};
        logger.info(`[executeRebuy] Forcefully cleared all after-sale monitoring`);
        
        // Save state immediately after clearing
        this.userTrades.set(userId, state);
        
        // Add delay to ensure interval is cleared
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const availableBalance = await this.getUserBalance(userId);
      const amountToRebuy = Math.max(5, (availableBalance * rebuyPercentage) / 100);

      if (amountToRebuy <= availableBalance) {
        await this.placeOrder(userId, symbol, "buy", amountToRebuy);
        logger.info(`Rebuy executed for ${symbol} - Amount: ${amountToRebuy} USDT`);

        // Update state
        state.purchasePrices[symbol] = {
          price: currentPrice,
          timestamp: Date.now(),
          quantity: amountToRebuy / currentPrice,
          sold: false,
          rebuyPercentage,
          profitThresholds: [...state.profitThresholds]
        };

        // Verify no after-sale monitoring exists before starting continuous
        if (state.afterSaleMonitorIntervals?.[symbol]) {
          logger.warn(`[executeRebuy] Detected lingering after-sale monitor, clearing again`);
          clearInterval(state.afterSaleMonitorIntervals[symbol]);
          state.afterSaleMonitorIntervals = {};
        }

        // Start new monitoring
        await this.startContinuousMonitoring(userId, symbol, amountToRebuy / currentPrice, rebuyPercentage);
      }
    } catch (error) {
      logger.error(`Failed to execute rebuy for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    rebuyPercentage: number,
  ) {
    const logger = getUserLogger(userId); // Retrieve user-specific logger
    const state = this.getUserTradeState(userId); // Get user's state

    logger.info(`Monitoring skyrocketing profit for ${symbol}.`);

    const checkSkyrocketingProfit = setInterval(async () => {
      try {
        const currentPrice = await this.fetchTicker(symbol);
        const purchase = state.purchasePrices[symbol];
        const purchasePrice = purchase?.price;

        if (!purchasePrice) {
          clearInterval(checkSkyrocketingProfit);
          return;
        }

        const profit = (currentPrice - purchasePrice) / purchasePrice;

        if (profit >= 0.1) {
          // 10% profit
          logger.info(
            `Skyrocketing profit of 10% reached for ${symbol}. Selling.`,
          );
          await this.placeOrder(userId, symbol, "sell", quantity);
          this.stopTrade(userId);
          clearInterval(checkSkyrocketingProfit);
        }
      } catch (error) {
        logger.error(
          `Checking Coin ${(error as Error).message}`,
        );
      }
    }, 60000); // Check every 1 minute

    setTimeout(async () => clearInterval(checkSkyrocketingProfit), 240000); // Stop after 4 minutes
  }


public async stopTrade(userId: number): Promise<void> {
  const logger = getUserLogger(userId);
  const state = this.getUserTradeState(userId);

  try {
    logger.info(`Stopping all trading activities for user ${userId}.`);

    // Clear regular monitoring intervals
    for (const symbol in state.monitorIntervals) {
      clearInterval(state.monitorIntervals[symbol]);
      delete state.monitorIntervals[symbol];
      logger.info(`Cleared monitoring interval for ${symbol}`);
    }

    // Clear after-sale monitoring intervals
    if (state.afterSaleMonitorIntervals) {
      for (const symbol in state.afterSaleMonitorIntervals) {
        clearInterval(state.afterSaleMonitorIntervals[symbol]);
        delete state.afterSaleMonitorIntervals[symbol];
        logger.info(`Cleared after-sale monitoring interval for ${symbol}`);
      }
    }

    // Clear all state
    state.monitorIntervals = {};
    state.afterSaleMonitorIntervals = {};
    state.purchasePrices = {};
    state.profitTarget = 0;
    state.accumulatedProfit = 0;
    state.startDayTimestamp = Date.now();
    state.activeTrades = [];

    // Save cleared state
    this.userTrades.set(userId, state);

    logger.info('All trading activities stopped successfully');
  } catch (error) {
    logger.error(`Error stopping trading for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
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
      throw new UnauthorizedException(
        "You do not have an active subscription.",
      );
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
        monitoringStatus: state.purchasePrices[symbol]?.sold
          ? "Monitoring After Sale"
          : "Active",
      })),
      purchasePrices: state.purchasePrices,
      profitTarget: state.profitTarget,
      accumulatedProfit: state.accumulatedProfit,
      activeMonitoringIntervals: Object.keys(state.activeMonitoringIntervals),
      startDayTimestamp: new Date(state.startDayTimestamp).toISOString(),
      payloadLogs: state.payloadLogs,
    };
  }
/**
 * Sells the specified coin immediately and transitions to monitoring after sale.
 * Stops continuous monitoring for the instance upon sell.
 * @param userId - The ID of the user.
 * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
 */
private async confirmSellAndStartMonitoring(
  userId: number,
  symbol: string,
  quantityToSell: number,
  rebuyPercentage: number
): Promise<void> {
  const logger = getUserLogger(userId);
  const state = this.getUserTradeState(userId);

  try {
    // Get remaining balance
    const remainingQuantity = await this.getSymbolBalance(userId, symbol);
    
    if (remainingQuantity < 0.1) {
      logger.info(`Sell confirmed for ${symbol}. Starting after-sale monitoring.`);
      
      // Update state
      if (state.purchasePrices[symbol]) {
        state.purchasePrices[symbol].sold = true;
        state.purchasePrices[symbol].quantity = 0;
      }

      // Start monitoring immediately
      await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);
      return;
    }

    throw new Error(`Sell not confirmed for ${symbol}. Remaining quantity: ${remainingQuantity}`);
  } catch (error) {
    logger.error(`Error confirming sell: ${(error as Error).message}`);
    throw error;
  }
}

public async sellNow(userId: number, symbol: string): Promise<void> {
  const logger = getUserLogger(userId);
  const state = this.getUserTradeState(userId);

  try {
    logger.info(`[sellNow] User ${userId} requested to sell ${symbol} immediately.`);

    // Get current purchase data before modifying state
    const purchase = state.purchasePrices[symbol];
    if (!purchase || purchase.quantity <= 0) {
      throw new Error(`No active trade found for symbol: ${symbol}`);
    }

    const quantityToSell = purchase.quantity;
    const rebuyPercentage = purchase.rebuyPercentage || 5;
    
    // Stop continuous monitoring first
    if (state.monitorIntervals[symbol]) {
      clearInterval(state.monitorIntervals[symbol]);
      delete state.monitorIntervals[symbol];
      logger.info(`[sellNow] Continuous monitoring stopped for ${symbol}.`);
    }

    // Place sell order
    await this.placeOrder(userId, symbol, "sell", quantityToSell);

    // Quick sell confirmation
    const remainingQuantity = await this.getSymbolBalance(userId, symbol);
    if (remainingQuantity < 0.1) {
      logger.info(`Sell confirmed for ${symbol}. Starting after-sale monitoring immediately.`);
      
      // Start monitoring before updating state
      await this.startMonitoringAfterSale(userId, symbol, rebuyPercentage);

      // Update state after monitoring is started
      state.purchasePrices[symbol] = {
        ...purchase,
        sold: true,
        quantity: 0
      };

      // Try to calculate profit
      try {
        const currentPrice = await this.fetchTickerWithRetry(symbol);
        if (currentPrice) {
          await this.checkAndHandleProfit(userId, symbol, quantityToSell, currentPrice);
        }
      } catch (error) {
        logger.warn(`Unable to calculate profit immediately: ${(error as Error).message}. Will retry during monitoring.`);
      }
    } else {
      throw new Error(`Sell not confirmed for ${symbol}. Remaining quantity: ${remainingQuantity}`);
    }

  } catch (error) {
    logger.error(`[sellNow] Error: ${(error as Error).message}`);
    throw error;
  }
}

public async buyNow(
  userId: number,
  symbol: string,
  percentage: number
): Promise<void> {
  const logger = getUserLogger(userId);
  const state = this.getUserTradeState(userId);

  try {
    // FIRST: Clear any existing monitoring
    if (state.afterSaleMonitorIntervals?.[symbol]) {
      clearInterval(state.afterSaleMonitorIntervals[symbol]);
      delete state.afterSaleMonitorIntervals[symbol];
      logger.info(`[buyNow] Cleared after-sale monitoring for ${symbol}`);
    }

    if (state.monitorIntervals?.[symbol]) {
      clearInterval(state.monitorIntervals[symbol]);
      delete state.monitorIntervals[symbol];
      logger.info(`[buyNow] Cleared existing monitoring for ${symbol}`);
    }

    const currentPrice = await this.fetchTickerWithRetry(symbol);
    const availableBalance = await this.getUserBalance(userId);
    const amount = (availableBalance * percentage) / 100;

    await this.placeOrder(userId, symbol, "buy", amount);
    
    // Update state with new purchase
    state.purchasePrices[symbol] = {
      price: currentPrice,
      timestamp: Date.now(),
      quantity: amount / currentPrice,
      sold: false,
      rebuyPercentage: percentage,
      profitThresholds: [...state.profitThresholds]
    };

    // Save state before starting new monitoring
    this.userTrades.set(userId, state);

    // Start continuous monitoring
    await this.startContinuousMonitoring(userId, symbol, amount / currentPrice, percentage);
    
    logger.info(`Manual buy executed for ${symbol} - Amount: ${amount} USDT`);
  } catch (error) {
    logger.error(`Failed to execute manual buy for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

private initializeTradeState(userId: number): UserTradeState {
  const newState: UserTradeState = {
    lastRecordedPrices: {},
    purchasePrices: {},
    profitTarget: 0,
    accumulatedProfit: 0,
    startDayTimestamp: Date.now(),
    payloadLogs: {},
    monitorIntervals: {},
    activeMonitoringIntervals: {},
    profitCheckThreshold: 0.008,    // Default 0.8% profit
    lossCheckThreshold: 0.006,      // Default 0.6% loss
    afterSaleProfitThreshold: 0.01,   // Default 1% profit for rebuy
    afterSaleLossThreshold: 0.01,    // Default 1% loss for rebuy
    profitThresholds: [...this.DEFAULT_PROFIT_THRESHOLDS],
    activeTrades: [],
    afterSaleMonitorIntervals: {},
  };
  this.userTradeStates.set(userId, newState);
  return newState;
}

public async setUserThresholds(
  userId: number,
  profitThreshold: number,
  lossThreshold: number
): Promise<void> {
  const logger = getUserLogger(userId);
  try {
    // Convert percentages to decimals if needed
    const normalizedProfitThreshold = profitThreshold > 1 ? profitThreshold / 100 : profitThreshold;
    const normalizedLossThreshold = lossThreshold > 1 ? lossThreshold / 100 : lossThreshold;

    // Find user first, then update
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    user.profitThreshold = normalizedProfitThreshold;
    user.lossThreshold = normalizedLossThreshold;
    user.thresholds_updated_at = new Date();

    await this.userRepository.save(user);

    logger.info(`User thresholds saved:`, {
      profitThreshold: `${(normalizedProfitThreshold * 100).toFixed(2)}%`,
      lossThreshold: `${(normalizedLossThreshold * 100).toFixed(2)}%`
    });
  } catch (error) {
    logger.error(`Failed to save user thresholds: ${(error as Error).message}`);
    throw error;
  }
}

public async setAfterSaleThresholds(
  userId: number,
  profitThreshold: number,
  lossThreshold: number
): Promise<void> {
  const user = await this.userRepository.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  // Convert to decimal if received as percentage
  const normalizedProfitThreshold = profitThreshold > 1 ? profitThreshold / 100 : profitThreshold;
  const normalizedLossThreshold = lossThreshold > 1 ? lossThreshold / 100 : lossThreshold;

  // Update user's after-sale thresholds
  user.afterSaleProfitThreshold = normalizedProfitThreshold;
  user.afterSaleLossThreshold = normalizedLossThreshold;

  // Save to database
  await this.userRepository.save(user);

  // Log the update
  this.logger.log(`Updated after-sale thresholds for user ${userId}:`, {
    profitThreshold: normalizedProfitThreshold,
    lossThreshold: normalizedLossThreshold
  });
}

private async fetchTickerWithRetry(
  symbol: string,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<number> {
  const logger = getUserLogger(0);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const price = await this.fetchTicker(symbol);
      if (price && !isNaN(price)) {
        return price;
      }
      throw new Error(`Invalid price received for ${symbol}`);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Attempt ${attempt}/${maxRetries} failed to fetch ticker for ${symbol}: ${(error as Error).message}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(`Failed to fetch ticker after ${maxRetries} attempts: ${lastError?.message}`);
}
public async getUserThresholds(userId: number) {
  const user = await this.userRepository.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }
  
  return {
    profitThreshold: user.profitThreshold,
    lossThreshold: user.lossThreshold,
    afterSaleProfitThreshold: user.afterSaleProfitThreshold,
    afterSaleLossThreshold: user.afterSaleLossThreshold
  };
}

private shouldRebuy(priceChange: number, profitThreshold: number, lossThreshold: number): boolean {
  return priceChange >= profitThreshold || Math.abs(priceChange) >= lossThreshold;
}
}