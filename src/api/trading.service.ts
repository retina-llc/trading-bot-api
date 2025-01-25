// src/trading/trading.service.ts

import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import axios from "axios";
import * as crypto from "crypto";
import * as ccxt from "ccxt";
import { getUserLogger } from "./logger"; // Import the logger factory
import { getTopTrendingCoinsForTheDay } from "./gainer";
import { UserRepository } from "./user/user-repository";
import { SymbolHelper } from "./utils/symbol.helper"; // Ensure correct path

const BITMART_API_URL = "https://api-cloud.bitmart.com";

interface UserTradeState {
  purchasePrices: Record<
    string,
    { price: number; timestamp: number; quantity: number; sold?: boolean }
  >;
  lastRecordedPrices: Record<string, number>; // New field to store last recorded current price
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
      state = {
        lastRecordedPrices: {}, // Initialize this field
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
    let retries = 0;
    const maxRetries = 3;
    const valueThreshold = 1.0; // The threshold value in USD
  
    while (retries < maxRetries) {
      try {
        // Wait a few seconds before checking after the sell order.
        await new Promise((resolve) => setTimeout(resolve, 5000));
  
        // Check the available quantity of the asset for the given symbol.
        const remainingQuantity = await this.getAvailableQuantity(userId, symbol);
        const currentPrice = await this.fetchTicker(symbol);
        const remainingValue = remainingQuantity * currentPrice;
  
        if (remainingValue < valueThreshold) {
          logger.info(
            `Sell confirmed for ${symbol}. Remaining value ($${remainingValue.toFixed(
              2,
            )}) is below $${valueThreshold}.`,
          );
  
          // Transition to monitoring after sale
          logger.info(`Transitioning to monitoring after sale for ${symbol}.`);
          console.log(`[ensureSellCompleted] Transitioning to monitoring after sale for ${symbol}`);
  
          // Update the state and clear the sell retry loop
          state.purchasePrices[symbol] = {
            ...state.purchasePrices[symbol],
            quantity: 0,
            sold: true, // Mark as sold
          };
          this.monitorAfterSale(userId, symbol, expectedSoldQuantity, currentPrice, state.profitTarget);
          return; // Exit the retry loop
        } else {
          logger.warn(
            `Sell order for ${symbol} not fully executed. Remaining value: $${remainingValue.toFixed(
              2,
            )}. Reattempting sell...`,
          );
          await this.placeOrder(userId, symbol, "sell", remainingQuantity);
        }
      } catch (error) {
        logger.error(
          `Error during sell confirmation for ${symbol}: ${(error as Error).message}`,
        );
      }
  
      retries++;
    }
  
    logger.error(
      `Failed to fully execute sell order for ${symbol} after ${maxRetries} attempts.`,
    );
  }
  
  public getAccumulatedProfit(userId: number): number {
    const state = this.getUserTradeState(userId);
  
    if (!state) {
      console.warn(`No trade state found for user ${userId}. Returning 0.`);
      return 0;
    }
  
    console.log(`[getAccumulatedProfit] Accumulated profit for user ${userId}: ${state.accumulatedProfit}`);
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
    const logger = getUserLogger(userId); // Retrieve user-specific logger
    const url = `${BITMART_API_URL}/account/v1/wallet`;

    try {
      logger.info("Starting balance fetch process.");

      // Log the URL being accessed
      console.log(`[getUserBalance] URL: ${url}`);

      // Retrieve authentication headers
      const headers = await this.getAuthHeaders(
        userId,
        "/account/v1/wallet",
        "GET",
        "",
        {},
      );

      // Log the headers being used (excluding sensitive information)
      console.log(`[getUserBalance] Headers:`, {
        "X-BM-KEY": headers["X-BM-KEY"] ? "****" : null,
        "X-BM-TIMESTAMP": headers["X-BM-TIMESTAMP"],
        "X-BM-MEMO": headers["X-BM-MEMO"] ? "****" : null,
        "Content-Type": headers["Content-Type"],
      });

      logger.info("Fetching user balance from BitMart API.");

      // Make the API request to fetch the wallet information
      const response = await axios.get(url, { headers });

      // Log the full API response for debugging purposes
      console.log(
        `[getUserBalance] API Response:`,
        JSON.stringify(response.data, null, 2),
      );

      // Ensure that the response structure is as expected
      if (
        !response.data ||
        !response.data.data ||
        !Array.isArray(response.data.data.wallet)
      ) {
        logger.error("Unexpected API response structure:", response.data);
        throw new Error("Unexpected API response structure");
      }

      // Find the balance entry for the specified currency
      const balanceEntry = response.data.data.wallet.find(
        (b: any) => b.currency.toUpperCase() === currency.toUpperCase(),
      );

      // Log the found balance entry
      if (balanceEntry) {
        console.log(
          `[getUserBalance] Found ${currency} Balance:`,
          balanceEntry,
        );
      } else {
        console.warn(
          `[getUserBalance] ${currency} balance not found in wallet data.`,
        );
      }

      // Parse the available balance
      const availableBalance = balanceEntry
        ? parseFloat(balanceEntry.available)
        : 0;

      // Log the parsed available balance
      console.log(
        `[getUserBalance] Available ${currency} Balance: ${availableBalance}`,
      );

      logger.info(
        `User balance retrieved successfully: ${availableBalance} ${currency}`,
      );

      return availableBalance;
    } catch (error: unknown) {
      const err = error as any; // Type assertion

      // Log the error details
      console.error("[getUserBalance] Error fetching user balance:", {
        message: err.message || "Unknown error",
        stack: err.stack || "No stack trace available",
        response: err.response
          ? JSON.stringify(err.response.data, null, 2)
          : "No response data",
      });

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
    const formattedSymbol = SymbolHelper.toCCXTSymbol(symbol); // Convert to "PWC/USDT"
    const apiSymbol = symbol; // Use original symbol for API URL

    const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${apiSymbol}`;
    console.log(`Fetching ticker data for symbol: ${symbol} from URL: ${url}`);
    try {
      const response = await axios.get(url);
      console.log(
        `Response data for symbol ${symbol}:`,
        JSON.stringify(response.data, null, 2),
      );

      const tickers = response.data.data.tickers;
      if (!tickers || tickers.length === 0) {
        console.error(`No ticker data available for symbol: ${symbol}`);
        throw new Error(`No ticker data available for symbol: ${symbol}`);
      }

      const lastPrice = parseFloat(tickers[0].last_price);
      if (isNaN(lastPrice)) {
        console.error(
          `Invalid last price value for symbol: ${symbol}`,
          tickers[0].last_price,
        );
        throw new Error(`Invalid last price value for symbol: ${symbol}`);
      }

      console.log(`Last price for symbol ${symbol}: ${lastPrice}`);
      return lastPrice;
    } catch (error: any) {
      console.error(
        `Error fetching ticker data for ${symbol}:`,
        error.message,
        error.stack,
      );
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

      console.log(
        `[getAvailableQuantity] Available balance for ${symbol.split("_")[0]}: ${available}`,
      );

      return available;
    } catch (error: unknown) {
      const err = error as any;
      console.error(
        "Error fetching available quantity:",
        err.message || "Unknown error",
      );
      throw new Error("Failed to fetch available quantity");
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
   * @param profit   Target - The target profit to achieve before stopping.
   * @returns An object containing trade details.
   */
  public async startTrade(
    userId: number,
    symbol: string,
    amount: number,
    rebuyPercentage: number,
    profitTarget: number,
  ): Promise<any> {
    try {
      if (!symbol || amount <= 4) {
        throw new Error(
          "Invalid symbol or amount. Amount must be greater than 4.",
        );
      }

      // Fetch user balance
      const balance = await this.getUserBalance(userId, "USDT"); // Assuming USDT is the quote currency
      if (balance <= 0) {
        throw new Error("Insufficient USDT balance to start trade.");
      }

      if (amount > balance) {
        throw new Error(
          `Requested amount (${amount} USDT) exceeds available balance (${balance} USDT).`,
        );
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
        `Placing buy order for symbol: ${symbol}, amount: ${amount}, purchaseQuantity: ${purchaseQuantity}`,
      );

      // Place a buy order with the correct cost
      await this.placeOrder(userId, symbol, "buy", amount);

      console.log(
        `Buy order placed successfully for symbol: ${symbol}, purchaseQuantity: ${purchaseQuantity}`,
      );

      const state = this.getUserTradeState(userId);
      state.purchasePrices[symbol] = {
        price: lastPrice,
        timestamp: Date.now(),
        quantity: purchaseQuantity,
      };
      state.profitTarget = profitTarget;
      state.accumulatedProfit = 0;
      state.startDayTimestamp = Date.now();

      // Start continuous monitoring
      this.startContinuousMonitoring(
        userId,
        symbol,
        purchaseQuantity,
        rebuyPercentage,
      );

      return { symbol, amount, remainingBalance: balance - amount };
    } catch (error: unknown) {
      const err = error as Error;
      console.error(
        `[startTrade] Error starting trade for ${symbol}: ${err.message}`,
      );
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
      
      const purchase = state.purchasePrices[symbol];
      if (!purchase) {
        logger.error(`No purchase data found for ${symbol}`);
        throw new Error(`Purchase data missing for symbol: ${symbol}`);
      }
  
      const purchasePrice = purchase.price;
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
    } catch (error) {
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
  ) {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);
  
    if (state.monitorIntervals[symbol]) {
      logger.info(`Clearing existing monitoring interval for ${symbol}.`);
      clearInterval(state.monitorIntervals[symbol]);
      delete state.monitorIntervals[symbol];
    }
  
    logger.info(
      `Starting continuous monitoring for ${symbol} with rebuyPercentage: ${rebuyPercentage}.`,
    );
  
    state.purchasePrices[symbol].sold = false; // Transition to active monitoring
  
    state.monitorIntervals[symbol] = setInterval(async () => {
      try {
        if (this.isNewDay(state)) {
          logger.info("A new day has started. Resetting accumulated profit.");
          state.accumulatedProfit = 0;
          state.startDayTimestamp = Date.now();
        }
  
        const currentPrice = await this.fetchTicker(symbol);
        logger.info(`Current price for ${symbol}: ${currentPrice}`);
        state.lastRecordedPrices[symbol] = currentPrice;
  
        const purchase = state.purchasePrices[symbol];
        if (!purchase) {
          logger.info(`Purchase price not found for symbol: ${symbol}`);
          return;
        }
  
        const residualValue = purchase.quantity * currentPrice;
        if (residualValue < 1.0) {
          logger.info(
            `Residual value (${residualValue.toFixed(
              2,
            )} USDT) is below threshold.`,
          );
          purchase.quantity = 0;
          purchase.sold = true;
          clearInterval(state.monitorIntervals[symbol]);
          return;
        }
  
        const purchasePrice = purchase.price;
        const priceDrop = (purchasePrice - currentPrice) / purchasePrice;
        const profit = (currentPrice - purchasePrice) / purchasePrice;
  
        logger.info(`Purchase price for ${symbol}: ${purchasePrice}`);
        logger.info(`Price drop for ${symbol}: ${(priceDrop * 100).toFixed(2)}%`);
        logger.info(`Current profit for ${symbol}: ${(profit * 100).toFixed(2)}%`);
        console.log(`Purchase price for ${symbol}: ${purchasePrice}`);
        if (priceDrop >= 0.05) {
          logger.info(`Price dropped by 5% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, "sell", quantity);
          await this.ensureSellCompleted(userId, symbol, quantity);
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
          state.purchasePrices[symbol] = {
            ...state.purchasePrices[symbol],
            price: currentPrice,
            quantity: 0,
            sold: true,
          };
          logger.info(
            `Waiting for 15 seconds before starting monitorAfterSale for ${symbol}.`,
          );
          setTimeout(() => {
            this.monitorAfterSale(
              userId,
              symbol,
              quantity,
              currentPrice,
              rebuyPercentage,
            );
          }, 15000);
        } else if (profit >= 0.05) {
          logger.info(`Profit of 5% or more for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, "sell", quantity);
          await this.ensureSellCompleted(userId, symbol, quantity);
          await this.checkAndHandleProfit(userId, symbol, quantity, currentPrice);
          state.purchasePrices[symbol] = {
            ...state.purchasePrices[symbol],
            sold: true,
          };
          logger.info(
            `Waiting for 15 seconds before starting monitorAfterSale for ${symbol}.`,
          );
          setTimeout(() => {
            this.monitorAfterSale(
              userId,
              symbol,
              quantity,
              currentPrice,
              rebuyPercentage,
            );
          }, 15000);
        } else if (state.accumulatedProfit >= state.profitTarget) {
          logger.info(`Accumulated profit target reached for ${symbol}. Selling.`);
          await this.placeOrder(userId, symbol, "sell", quantity);
          this.stopTrade(userId);
        }
      } catch (error) {
        logger.error(
          "Error checking price and selling: " + (error as Error).message,
        );
      }
    }, 5000);
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
    rebuyPercentage: number,
  ): Promise<void> {
    const logger = getUserLogger(userId); // Retrieve user-specific logger
    const state = this.getUserTradeState(userId); // Get user-specific state

    // Mark trade as monitoring after sale in the user state
    if (!state.purchasePrices[symbol]) {
      state.purchasePrices[symbol] = {
        price: sellPrice,
        timestamp: Date.now(),
        quantity,
        sold: true,
      };
    } else {
      state.purchasePrices[symbol].sold = true;
    }

    logger.info(`Monitoring after sale for ${symbol}.`);

    const startRebuyMonitoring = async (
      currentSymbol: string,
      quantity: number,
      rebuyPercentage: number,
    ) => {
      logger.info(
        `Starting rebuy monitoring for ${currentSymbol} with quantity: ${quantity}, sellPrice: ${sellPrice}, rebuyPercentage: ${rebuyPercentage}`,
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
            logger.error(
              `Current price for ${currentSymbol} is invalid or undefined.`,
            );
            return;
          }
          logger.info(`Current price for ${currentSymbol}: ${currentPrice}`);
    
          const priceIncrease = (currentPrice - initialPrice) / initialPrice;
          const priceDrop = (initialPrice - currentPrice) / initialPrice;
    
          logger.info(
            `Price change for ${currentSymbol}: Increase: ${(priceIncrease * 100).toFixed(2)}%, Drop: ${(priceDrop * 100).toFixed(2)}%`,
          );
    
          if (priceIncrease >= 0.002) {
            logger.info(`Price increased by 0.2% or more for ${currentSymbol}.`);
    
            const availableBalance = await this.getUserBalance(userId);
            logger.info(`User balance: ${availableBalance}`);
    
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
            const rebuyQuantity = amountToRebuy / currentPrice;
    
            if (
              rebuyQuantity > 0 &&
              rebuyQuantity * currentPrice <= availableBalance
            ) {
              await this.placeOrder(userId, currentSymbol, "buy", amountToRebuy);
              logger.info(
                `Buy order placed for ${currentSymbol} with cost: ${amountToRebuy} USDT`,
              );
    
              state.purchasePrices[currentSymbol] = {
                price: currentPrice,
                timestamp: Date.now(),
                quantity: rebuyQuantity,
                sold: false, // Transition to active monitoring
              };
    
              clearInterval(checkRebuyInterval);
    
              this.startContinuousMonitoring(
                userId,
                currentSymbol,
                rebuyQuantity,
                rebuyPercentage,
              );
            }
          } else if (priceDrop >= 0.05) {
            logger.info(`Price dropped by 5% or more for ${currentSymbol}.`);
    
            const availableBalance = await this.getUserBalance(userId);
            const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
            const rebuyQuantity = amountToRebuy / currentPrice;
    
            if (
              rebuyQuantity > 0 &&
              rebuyQuantity * currentPrice <= availableBalance
            ) {
              await this.placeOrder(userId, currentSymbol, "buy", amountToRebuy);
              logger.info(
                `Buy order placed for ${currentSymbol} with cost: ${amountToRebuy} USDT`,
              );
    
              state.purchasePrices[currentSymbol] = {
                price: currentPrice,
                timestamp: Date.now(),
                quantity: rebuyQuantity,
                sold: false, // Transition to active monitoring
              };
    
              clearInterval(checkRebuyInterval);
    
              this.startContinuousMonitoring(
                userId,
                currentSymbol,
                rebuyQuantity,
                rebuyPercentage,
              );
            }
          }
    
          const timeElapsed =
            Date.now() - (state.purchasePrices[currentSymbol]?.timestamp || 0);
          if (timeElapsed >= 210000 && currentPrice !== undefined) {
            initialPrice = currentPrice; // Safely reassign to a valid currentPrice
          }
        } catch (error) {
          logger.error(
            `log: ${(error as Error).message}`,
          );
        }
      }, 8000);
    
      state.activeMonitoringIntervals[currentSymbol] = checkRebuyInterval;
    
      setTimeout(async () => {
        if (
          !state.purchasePrices[currentSymbol] ||
          Date.now() - state.purchasePrices[currentSymbol].timestamp >= 3600000
        ) {
          logger.info(
            `1 hour elapsed without rebuying ${currentSymbol}. Buying into the top trending coin for the day.`,
          );
    
          const trendingCoins = await getTopTrendingCoinsForTheDay();
          if (trendingCoins.length > 0) {
            const topTrendingCoin = trendingCoins[0].symbol;
            const availableBalance = await this.getUserBalance(userId);
            const currentPrice = await this.fetchTicker(topTrendingCoin);
    
            if (currentPrice !== undefined && !isNaN(currentPrice)) {
              const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
              const rebuyQuantity = amountToRebuy / currentPrice;
    
              if (
                rebuyQuantity > 0 &&
                rebuyQuantity * currentPrice <= availableBalance
              ) {
                await this.placeOrder(
                  userId,
                  topTrendingCoin,
                  "buy",
                  amountToRebuy,
                );
                state.purchasePrices[topTrendingCoin] = {
                  price: currentPrice,
                  timestamp: Date.now(),
                  quantity: rebuyQuantity,
                  sold: false,
                };
                this.startContinuousMonitoring(
                  userId,
                  topTrendingCoin,
                  rebuyQuantity,
                  rebuyPercentage,
                );
              }
            }
          }
          clearInterval(state.activeMonitoringIntervals[currentSymbol]);
          delete state.activeMonitoringIntervals[currentSymbol];
        }
      }, 3600000); // Stop after 1 hour
    };    

    // Start the rebuy monitoring
    startRebuyMonitoring(symbol, quantity, rebuyPercentage);
  }
  public stopTrade(userId: number): void {
    const logger = getUserLogger(userId);
    const state = this.getUserTradeState(userId);
  
    logger.info(`Stopping all trading activities for user ${userId}.`);
  
    // Clear monitorIntervals for this user
    Object.keys(state.monitorIntervals).forEach((symbol) => {
      const interval = state.monitorIntervals[symbol];
      if (interval) {
        clearInterval(interval);
        delete state.monitorIntervals[symbol];
        logger.info(`Cleared monitorInterval for symbol: ${symbol}`);
      }
    });
  
    // Clear activeMonitoringIntervals for this user
    Object.keys(state.activeMonitoringIntervals).forEach((symbol) => {
      const interval = state.activeMonitoringIntervals[symbol];
      if (interval) {
        clearInterval(interval);
        delete state.activeMonitoringIntervals[symbol];
        logger.info(`Cleared activeMonitoringInterval for symbol: ${symbol}`);
      }
    });
  
    // Remove the stopped trades from purchasePrices (or mark them as sold)
    Object.keys(state.purchasePrices).forEach((symbol) => {
      const purchase = state.purchasePrices[symbol];
      if (purchase) {
        purchase.sold = true; // Mark as sold
        purchase.quantity = 0; // Clear quantity
      }
      delete state.purchasePrices[symbol]; // Remove the purchase record
    });
  
    // Clear accumulated profit and reset user state
    state.accumulatedProfit = 0;
    state.startDayTimestamp = Date.now();
  
    logger.info(`All trading activities stopped for user ${userId}.`);
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
public async sellNow(userId: number, symbol: string): Promise<void> {
  const logger = getUserLogger(userId);
  const state = this.getUserTradeState(userId);

  try {
    logger.info(`[sellNow] User ${userId} requested to sell ${symbol} immediately.`);

    const purchase = state.purchasePrices[symbol];
    if (!purchase || purchase.quantity <= 0) {
      throw new Error(`No active trade found for symbol: ${symbol}`);
    }

    const quantityToSell = purchase.quantity;
    const currentPrice = await this.fetchTicker(symbol);

    if (currentPrice === undefined || isNaN(currentPrice)) {
      throw new Error(`Failed to fetch current price for ${symbol}`);
    }

    logger.info(`[sellNow] Current price for ${symbol}: ${currentPrice}. Proceeding with sell.`);

    // Stop continuous monitoring for this symbol
    if (state.monitorIntervals[symbol]) {
      clearInterval(state.monitorIntervals[symbol]);
      delete state.monitorIntervals[symbol];
      logger.info(`[sellNow] Continuous monitoring stopped for ${symbol}.`);
    }

    // Place the sell order
    await this.placeOrder(userId, symbol, "sell", quantityToSell);
    await this.ensureSellCompleted(userId, symbol, quantityToSell);

    // --------------------------------------------
    //   IMPORTANT: Update accumulated profit here
    // --------------------------------------------
    await this.checkAndHandleProfit(userId, symbol, quantityToSell, currentPrice);

    logger.info(`[sellNow] Sell order completed for ${symbol}. Transitioning to monitoring after sale.`);

    // Mark the trade as sold in the user state
    state.purchasePrices[symbol] = {
      ...state.purchasePrices[symbol],
      quantity: 0,
      sold: true,
    };

    // Transition to after-sale monitoring logic
    this.monitorAfterSale(userId, symbol, quantityToSell, currentPrice, state.profitTarget);

    logger.info(`[sellNow] Monitoring after sale started for ${symbol}.`);
  } catch (error) {
    logger.error(`[sellNow] Error processing immediate sell for ${symbol}: ${(error as Error).message}`);
    throw error;
  }
}
}