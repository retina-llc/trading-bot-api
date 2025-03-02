import {
    Injectable,
    UnauthorizedException,
    BadRequestException,
  } from "@nestjs/common";
  import * as ccxt from "ccxt";
  import { getUserLogger } from "./logger";
  import { UserRepository } from "./user/user-repository";
  
  interface PurchaseInfo {
    price: number;
    timestamp: number;
    quantity: number;
    sold?: boolean;
    rebuyPercentage?: number;
  }
  
  interface UserTradeState {
    purchasePrices: Record<
      string,
      {
        price: number;
        timestamp: number;
        quantity: number;
        sold?: boolean;
        rebuyPercentage?: number;
      }
    >;
    lastRecordedPrices: Record<string, number>;
    profitTarget: number;
    accumulatedProfit: number;
    startDayTimestamp: number;
    payloadLogs: Record<string, any[]>;
    monitorIntervals: Record<string, NodeJS.Timeout>;
    activeMonitoringIntervals: Record<string, NodeJS.Timeout>;
    profitCheckThreshold?: number;
    lossCheckThreshold?: number;
  }
  
  @Injectable()
  export class BinanceTradingService {
    private userTrades = new Map<number, UserTradeState>();
  
    constructor(private readonly userRepository: UserRepository) {}
  
    /**
     * 1) Pull user’s Binance API keys from DB (assuming you've stored them).
     */
    private async getUserBinanceApiKeys(
      userId: number
    ): Promise<{ binanceApiKey: string; binanceApiSecret: string }> {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user || !user.apiKeys) {
        throw new UnauthorizedException("API keys not found for this user");
      }
  
      // Make sure your User entity has these fields:
      const { binanceApiKey, binanceApiSecret } = user.apiKeys;
  
      if (!binanceApiKey || !binanceApiSecret) {
        throw new UnauthorizedException("Incomplete Binance API keys for this user");
      }
  
      return {
        binanceApiKey,
        binanceApiSecret,
      };
    }
  
    /**
     * 2) Initialize a ccxt.binance instance
     */
    private async initializeBinanceExchange(userId: number): Promise<ccxt.binance> {
      const { binanceApiKey, binanceApiSecret } = await this.getUserBinanceApiKeys(userId);
  
      const exchange = new ccxt.binance({
        apiKey: binanceApiKey,
        secret: binanceApiSecret,
        enableRateLimit: true,
        // If you ever want Testnet, you can uncomment and adjust:
        // urls: {
        //   api: {
        //     public: 'https://testnet.binance.vision/api',
        //     private: 'https://testnet.binance.vision/api',
        //   },
        // },
        options: {
          defaultType: 'spot',
        },
      });
  
      // Load markets before making any trades
      await exchange.loadMarkets();
      return exchange;
    }
  
    /**
     * Helper to retrieve or initialize a user’s trade state.
     */
    private getUserTradeState(userId: number): UserTradeState {
      let state = this.userTrades.get(userId);
      if (!state) {
        state = {
          purchasePrices: {},
          lastRecordedPrices: {},
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
  
    /**
     * 3) Get user’s balance in a particular currency (default = USDT).
     */
    public async getUserBalance(userId: number, currency: string = "USDT"): Promise<number> {
      const logger = getUserLogger(userId);
      const exchange = await this.initializeBinanceExchange(userId);
  
      try {
        const balances = await exchange.fetchBalance();
        // The returned object typically has shape like { "USDT": { "free": 123.45 }, ... }
        const freeBalance = balances[currency]?.free || 0;
        logger.info(`[Binance] Fetched ${currency} balance: ${freeBalance}`);
        return freeBalance;
      } catch (error) {
        logger.error(`[Binance] Error fetching balance: ${error}`);
        throw new Error("Failed to fetch user balance on Binance");
      }
    }
  
    /**
     * 4) Fetch the current ticker price for a symbol (e.g. "BTC_USDT" -> "BTC/USDT").
     */
    private async fetchTicker(symbol: string, userId: number): Promise<number> {
      const exchangeSymbol = symbol.replace("_", "/"); // e.g. "BTC_USDT" -> "BTC/USDT"
      const logger = getUserLogger(userId);
      const exchange = await this.initializeBinanceExchange(userId);
  
      try {
        const ticker = await exchange.fetchTicker(exchangeSymbol);
        const lastPrice = ticker.last;
        if (!lastPrice || isNaN(lastPrice)) {
          throw new Error(`Invalid ticker data for ${symbol}`);
        }
        logger.info(`[Binance] Fetched ticker for ${symbol}: ${lastPrice}`);
        return lastPrice;
      } catch (error) {
        logger.error(`[Binance] Error fetching ticker for ${symbol}: ${error}`);
        throw new Error(`Failed to fetch ticker for ${symbol}`);
      }
    }
  
    /**
     * 5) Place a market buy or sell order on Binance via CCXT.
     */
    public async placeOrder(
      userId: number,
      symbol: string,
      side: "buy" | "sell",
      amount: number
    ): Promise<void> {
      const logger = getUserLogger(userId);
      const exchange = await this.initializeBinanceExchange(userId);
      const exchangeSymbol = symbol.replace("_", "/"); // "BTC_USDT" -> "BTC/USDT"
  
      try {
        if (side === "buy") {
          // Market buy using quoteOrderQty (the USDT amount)
          logger.info(`[Binance] Placing MARKET BUY for ${exchangeSymbol} with USDT: ${amount}`);
          await exchange.createOrder(exchangeSymbol, "market", "buy", 0, undefined, {
            quoteOrderQty: amount,
          });
        } else {
          // Market sell: `amount` is the base quantity
          logger.info(`[Binance] Placing MARKET SELL for ${exchangeSymbol}, quantity: ${amount}`);
          await exchange.createMarketSellOrder(exchangeSymbol, amount);
        }
      } catch (error) {
        logger.error(`[Binance] Error placing ${side} order for ${symbol}: ${error}`);
        throw new Error(`Failed to place ${side} order for ${symbol} on Binance`);
      }
    }
  
    /**
     * 6) Start a trade (market buy), record purchase, then start monitoring.
     */
    public async startTrade(
      userId: number,
      symbol: string,
      usdtAmount: number,
      rebuyPercentage: number,
      profitTarget: number
    ): Promise<any> {
      const logger = getUserLogger(userId);
      const state = this.getUserTradeState(userId);
  
      try {
        // 1) Check user’s USDT balance
        const userBalance = await this.getUserBalance(userId, "USDT");
        if (usdtAmount > userBalance) {
          throw new BadRequestException("Not enough USDT balance.");
        }
  
        // 2) Fetch current price
        const lastPrice = await this.fetchTicker(symbol, userId);
  
        // 3) Place a buy order
        await this.placeOrder(userId, symbol, "buy", usdtAmount);
  
        // 4) Approx quantity purchased
        const quantityPurchased = usdtAmount / lastPrice;
  
        // 5) Store in userTradeState
        state.purchasePrices[symbol] = {
          price: lastPrice,
          timestamp: Date.now(),
          quantity: quantityPurchased,
          sold: false,
          rebuyPercentage,
        };
        state.profitTarget = profitTarget;
        state.startDayTimestamp = Date.now();
  
        // 6) Start continuous monitoring
        this.startContinuousMonitoring(userId, symbol, quantityPurchased);
  
        logger.info(`[Binance] Started trade for ${symbol} with ${usdtAmount} USDT.`);
        return {
          symbol,
          purchasedQuantity: quantityPurchased,
          purchasePrice: lastPrice,
        };
      } catch (error) {
        logger.error(`[Binance] Failed to start trade for ${symbol}: ${error}`);
        throw error;
      }
    }
  
    /**
     * 7) Continuously monitor for target profit or acceptable loss, etc.
     */
    private async startContinuousMonitoring(userId: number, symbol: string, quantity: number) {
      const logger = getUserLogger(userId);
      const state = this.getUserTradeState(userId);
  
      // Clear any existing interval
      if (state.monitorIntervals[symbol]) {
        clearInterval(state.monitorIntervals[symbol]);
      }
  
      logger.info(`[Binance] Starting continuous monitoring for ${symbol}.`);
  
      state.monitorIntervals[symbol] = setInterval(async () => {
        try {
          const currentPrice = await this.fetchTicker(symbol, userId);
          state.lastRecordedPrices[symbol] = currentPrice;
  
          const purchaseInfo = state.purchasePrices[symbol];
          if (!purchaseInfo) return;
  
          const purchasePrice = purchaseInfo.price;
          const profitRatio = (currentPrice - purchasePrice) / purchasePrice;
          logger.info(
            `[Binance] Symbol ${symbol}: currentPrice=${currentPrice}, purchasedAt=${purchasePrice}, profitRatio=${profitRatio.toFixed(
              4
            )}`
          );
  
          // Example condition: if profit >= 3%, sell
          if (profitRatio >= 0.03) {
            logger.info(`[Binance] Profit target reached (3% or more). Selling ${symbol}.`);
            await this.sellNow(userId, symbol);
          }
  
          // Example condition: if price drops 5% from purchase, sell
          if (profitRatio <= -0.05) {
            logger.info(`[Binance] Price dropped 5% from purchase. Selling ${symbol}.`);
            await this.sellNow(userId, symbol);
          }
        } catch (error) {
          logger.error(`[Binance] Error in continuous monitoring for ${symbol}: ${error}`);
        }
      }, 5000); // check every 5 seconds
    }
  
    /**
     * 8) Sell immediately and clear intervals for that symbol.
     */
    public async sellNow(userId: number, symbol: string): Promise<void> {
      const logger = getUserLogger(userId);
      const state = this.getUserTradeState(userId);
  
      const purchase = state.purchasePrices[symbol];
      if (!purchase || purchase.quantity <= 0) {
        logger.warn(`[Binance] No active position found for ${symbol} to sell.`);
        return;
      }
  
      try {
        // Stop the monitoring interval
        if (state.monitorIntervals[symbol]) {
          clearInterval(state.monitorIntervals[symbol]);
          delete state.monitorIntervals[symbol];
        }
  
        // Place a sell order for the entire quantity
        await this.placeOrder(userId, symbol, "sell", purchase.quantity);
  
        // Mark as sold
        purchase.sold = true;
        purchase.quantity = 0;
  
        logger.info(`[Binance] Sold position for ${symbol}.`);
      } catch (error) {
        logger.error(`[Binance] Error selling ${symbol}: ${error}`);
        throw error;
      }
    }
  
    /**
     * 9) Stop all trades for a user (clear intervals, mark everything sold).
     */
    public stopTrade(userId: number): void {
      const logger = getUserLogger(userId);
      const state = this.getUserTradeState(userId);
  
      logger.info(`[Binance] Stopping all Binance trades for user ${userId}.`);
  
      // Clear intervals
      for (const symbol of Object.keys(state.monitorIntervals)) {
        clearInterval(state.monitorIntervals[symbol]);
        delete state.monitorIntervals[symbol];
      }
      for (const symbol of Object.keys(state.activeMonitoringIntervals)) {
        clearInterval(state.activeMonitoringIntervals[symbol]);
        delete state.activeMonitoringIntervals[symbol];
      }
  
      // Mark all purchases as sold
      for (const symbol of Object.keys(state.purchasePrices)) {
        const purchase = state.purchasePrices[symbol];
        purchase.sold = true;
        purchase.quantity = 0;
        delete state.purchasePrices[symbol];
      }
  
      // Reset any global profit tracking if needed
      state.accumulatedProfit = 0;
      state.startDayTimestamp = Date.now();
  
      logger.info(`[Binance] All Binance trading activities stopped for user ${userId}.`);
    }
  
    /**
     * (Optional) Get user's accumulated profit on Binance.
     */
    public getAccumulatedProfit(userId: number): number {
      const state = this.getUserTradeState(userId);
      return state.accumulatedProfit; 
    }
  
    /**
     * (Optional) Get user's configured profit target for Binance trades.
     */
    public getProfitTarget(userId: number): number {
      const state = this.getUserTradeState(userId);
      return state.profitTarget;
    }
  
    /**
     * (Optional) Return a simple status object for the user's Binance trades.
     */
    public getStatus(userId: number): Record<string, any> {
      const state = this.getUserTradeState(userId);
  
      return {
        // Let's show each symbol plus its 'sold' status
        activeTrades: Object.keys(state.purchasePrices).map((symbol) => {
          const purchase = state.purchasePrices[symbol];
          return {
            symbol,
            purchasePrice: purchase.price,
            quantity: purchase.quantity,
            sold: purchase.sold,
          };
        }),
        profitTarget: state.profitTarget,
        accumulatedProfit: state.accumulatedProfit,
        lastRecordedPrices: state.lastRecordedPrices,
        startDayTimestamp: new Date(state.startDayTimestamp).toISOString(),
      };
    }
  
    /**
     * (Optional) Example "buy now" method that rebuys without going through "startTrade" logic.
     */
    public async buyNow(userId: number, symbol: string, usdtAmount: number): Promise<void> {
      const logger = getUserLogger(userId);
      const state = this.getUserTradeState(userId);
  
      // Just a simple approach:
      // 1) place a market buy with the given USDT
      // 2) store/monitor
      try {
        logger.info(`[Binance] buyNow request for ${symbol}, usdtAmount = ${usdtAmount}`);
  
        const balance = await this.getUserBalance(userId, "USDT");
        if (usdtAmount > balance) {
          throw new BadRequestException("Not enough USDT balance to buy.");
        }
  
        // Place the buy
        await this.placeOrder(userId, symbol, "buy", usdtAmount);
  
        // Fetch price
        const lastPrice = await this.fetchTicker(symbol, userId);
        const quantity = usdtAmount / lastPrice;
  
        // Update user state
        state.purchasePrices[symbol] = {
          price: lastPrice,
          timestamp: Date.now(),
          quantity,
          sold: false,
          rebuyPercentage: state.purchasePrices[symbol]?.rebuyPercentage || 5,
        };
  
        // Optionally start or re-start monitoring for that symbol
        this.startContinuousMonitoring(userId, symbol, quantity);
      } catch (error) {
        logger.error(`[Binance] buyNow error for ${symbol}: ${(error as Error).message}`);
        throw error;
      }
    }
  }
  