import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import * as ccxt from 'ccxt';
import dotenv from 'dotenv';
import logger from './logger';
import { getLogger } from './logger'; 
import { getTopTrendingCoinsForTheDay } from './gainer';
dotenv.config();


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
  private exchange: ccxt.bitmart;
  private monitoringExchange: ccxt.bitmart; 
  constructor() {
    this.exchange = new ccxt.bitmart({
      apiKey: process.env.BITMART_API_KEY,
      secret: process.env.BITMART_API_SECRET,
      uid: process.env.BITMART_API_MEMO,
    });

    this.monitoringExchange = new ccxt.bitmart({
      apiKey: process.env.MONITORING_API_KEY,
      secret: process.env.MONITORING_API_SECRET,
      uid: 'Monitoring',
    });
  }

  private generateSignature(httpMethod: string, url: string, timestamp: string, queryString: string, body: any, secretKey: string, memo: string): string {
    const bodyString = body && Object.keys(body).length > 0 ? JSON.stringify(body) : '';
    const preHashString = `${timestamp}#${memo}#${httpMethod}#${url}${queryString ? '?' + queryString : ''}${bodyString}`;

    console.log('Generating signature with the following parameters:');
    console.log('Timestamp:', timestamp);
    console.log('Memo:', memo);
    console.log('HTTP Method:', httpMethod);
    console.log('URL:', url);
    console.log('Query String:', queryString);
    console.log('Body:', bodyString);
    console.log('Pre-hash String:', preHashString);

    const signature = crypto.createHmac('sha256', secretKey).update(preHashString).digest('hex');
    console.log('Generated Signature:', signature);
    return signature;
  }
  private async getMonitoringAuthHeaders(endpoint: string, method: string, queryString: string, body: any): Promise<any> {
    const apiKey = process.env.MONITORING_API_KEY!;
    const apiSecret = process.env.MONITORING_API_SECRET!;
    const memo = 'Monitoring';
    const timestamp = Date.now().toString();
  
    console.log('Monitoring Auth Headers:');
    console.log('API Key:', apiKey);
    console.log('Memo:', memo);
    console.log('Timestamp:', timestamp);
  
    const urlPath = endpoint.replace(BITMART_API_URL, '');
    console.log('URL Path:', urlPath);
  
    const signature = this.generateSignature(method, urlPath, timestamp, queryString, body, apiSecret, memo);
    console.log('Signature:', signature);
  
    return {
      'X-BM-KEY': apiKey,
      'X-BM-SIGN': signature,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-MEMO': memo,
      'Content-Type': 'application/json'
    };
  }
  
  private async getAuthHeaders(endpoint: string, method: string, queryString: string, body: any): Promise<any> {
    const apiKey = process.env.BITMART_API_KEY!;
    const apiSecret = process.env.BITMART_API_SECRET!;
    const apiMemo = process.env.BITMART_API_MEMO!;
    const timestamp = Date.now().toString();

    console.log('Auth Headers:');
    console.log('API Key:', apiKey);
    console.log('API Memo:', apiMemo);
    console.log('Timestamp:', timestamp);

    const urlPath = endpoint.replace(BITMART_API_URL, '');
    console.log('URL Path:', urlPath);

    const signature = this.generateSignature(method, urlPath, timestamp, queryString, body, apiSecret, apiMemo);
    console.log('Signature:', signature);

    return {
      'X-BM-KEY': apiKey,
      'X-BM-SIGN': signature,
      'X-BM-TIMESTAMP': timestamp,
      'X-BM-MEMO': apiMemo, // Add the memo to the headers
      'Content-Type': 'application/json'
    };
  }

  public getAccumulatedProfit(): number {
    return this.accumulatedProfit;
  }

  public async getUserBalance(): Promise<number> {
    const url = `${BITMART_API_URL}/account/v1/wallet`;
    const headers = await this.getAuthHeaders(url, 'GET', '', {});
  
    try {
      logger.info('Received request for user balance');
      const response = await axios.get(url, { headers });
      logger.info('Received full response:', { responseData: response.data });
  
      const balances = response.data.data;
      logger.info('Received balances object:', { balances });
  
      if (!balances.wallet || balances.wallet.length === 0) {
        logger.warn('Wallet is empty');
        return 0.00; // Return 0 if wallet is empty
      }
  
      const usdtBalance = balances.wallet.find((b: any) => b.currency === 'USDT');
      logger.info('USDT balance object:', { usdtBalance });
  
      if (!usdtBalance) {
        logger.warn('USDT balance not found');
        return 0.00; // Return 0 if USDT balance is not found
      }
  
      const availableBalance = parseFloat(usdtBalance.available);
      logger.info('Available USDT balance:', { availableBalance });
  
      return availableBalance;
    } catch (error) {
      logger.error('Error fetching user balance:', { message: (error as any).message, stack: (error as any).stack });
      throw new Error('Failed to fetch user balance');
    }
  }
  
  public getTradeStatus(): { 
    activeTrade: boolean, 
    monitoringStatus: string, 
    tradingSymbol: string | null, 
    skyrocketProfitMode: boolean, 
    skyrocketProfitTarget: number 
  } {
    const activeSymbols = Object.keys(this.monitorIntervals);
    
    if (activeSymbols.length === 0) {
      return { 
        activeTrade: false, 
        monitoringStatus: 'No active trades', 
        tradingSymbol: null, 
        skyrocketProfitMode: false, 
        skyrocketProfitTarget: 0 
      };
    }
  
    const symbol = activeSymbols[0]; // Assuming only one active trade at a time
    const isMonitoringAfterSale = !!this.purchasePrices[symbol];
  
    const monitoringStatus = isMonitoringAfterSale ? 'Monitoring continuously' : 'Monitoring after sale';
    return { 
      activeTrade: true, 
      monitoringStatus, 
      tradingSymbol: symbol, 
      skyrocketProfitMode: this.skyrocketProfitMode, 
      skyrocketProfitTarget: this.skyrocketProfitTarget 
    };
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
public async getAvailableQuantity(symbol: string): Promise<number> {
  try {
    // Fetch user balance or account information
    const url = `${BITMART_API_URL}/account/v1/wallet`;
    const headers = await this.getAuthHeaders(url, 'GET', '', {});
    const response = await axios.get(url, { headers });

    // Find the specific asset quantity
    const balances = response.data.data.wallet;
    const asset = balances.find((b: any) => b.currency === symbol.split('_')[0]); // Adjust based on symbol format
    return asset ? parseFloat(asset.available) : 0;
  } catch (error) {
    console.error('Error fetching available quantity:', error);
    throw new Error('Failed to fetch available quantity');
  }
}


  private async fetchBestMarketPrice(symbol: string): Promise<number> {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      if (ticker.bid === undefined) {
        throw new Error('Failed to fetch market price');
      }
      return ticker.bid; // Best bid price for sell orders
    } catch (error) {
      console.error('Error fetching ticker data:', error);
      throw new Error('Failed to fetch market price');
    }
  }

  public async placeOrder(symbol: string, side: 'buy' | 'sell', quantity?: number, price?: number): Promise<void> {
    try {
        if (side === 'sell') {
            if (!quantity) {
                // Fetch available quantity if not provided
                quantity = await this.getAvailableQuantity(symbol);
                if (quantity <= 0) {
                    throw new Error('No available quantity to sell');
                }
            }

            // Fetch the best market price
            const marketPrice = await this.fetchBestMarketPrice(symbol);
            console.log(`Placing sell order for symbol: ${symbol}, quantity: ${quantity}, market price: ${marketPrice}`);

            const order = await this.exchange.createOrder(symbol, 'market', side, quantity);
            console.log(`Sell order placed successfully for ${symbol}, quantity: ${quantity}`);
            console.log('Order response:', JSON.stringify(order, null, 2));
        } else { // side === 'buy'
            if (!price) {
                // Fetch the best market price if not provided
                const ticker = await this.exchange.fetchTicker(symbol);
                price = ticker.ask; // Use the ask price for buy orders
            }

            // Calculate the notional value
            const notional = (quantity || 0) * (price || 0);
            // Ensure the notional value meets the minimum requirement
            if (notional < 5) {
                throw new Error('Order notional value must be at least $5.');
            }

            console.log(`Placing buy order for symbol: ${symbol}, quantity: ${quantity}, price: ${price}`);
            const order = await this.exchange.createOrder(symbol, 'market', side, quantity || 0, price || 0);
            console.log(`Buy order placed successfully for ${symbol}, quantity: ${quantity}`);
            console.log('Order response:', JSON.stringify(order, null, 2));
        }
    } catch (error) {
        console.error(`Error placing ${side} order for ${symbol}:`, (error as any).message);
        throw new Error(`Failed to place ${side} order for ${symbol}`);
    }
}

  public async startTrade(symbol: string, amount: number, rebuyPercentage: number, profitTarget: number): Promise<any> {
    try {
        if (!symbol || amount <= 4) {
            throw new Error('Invalid symbol or amount.');
        }
  
        const balance = await this.getUserBalance();
  
        if (amount > balance) {
            throw new Error('Insufficient balance.');
        }
  
        const lastPrice = await this.fetchTicker(symbol);
        const purchaseQuantity = amount / lastPrice;
  
        console.log(`Placing buy order for symbol: ${symbol}, amount: ${amount}, purchaseQuantity: ${purchaseQuantity}`);
  
        await this.placeOrder(symbol, 'buy', purchaseQuantity, lastPrice); // Pass the lastPrice as the price
  
        console.log(`Buy order placed successfully for symbol: ${symbol}, purchaseQuantity: ${purchaseQuantity}`);
  
        this.purchasePrices[symbol] = { price: lastPrice, timestamp: Date.now() };
  
        this.profitTarget = profitTarget;
        this.accumulatedProfit = 0;
        this.startDayTimestamp = Date.now();
  
        this.startContinuousMonitoring(symbol, purchaseQuantity, rebuyPercentage);
  
        return { symbol, amount, remainingBalance: balance - amount };
    } catch (error) {
        console.error('Error starting trade:', error);
        throw new Error('Failed to start trade');
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

  private async checkAndHandleProfit(symbol: string, quantity: number, sellPrice: number): Promise<void> {
    const profit = await this.calculateProfit(symbol, quantity, sellPrice);
    this.accumulatedProfit += profit;
    console.log(`Accumulated Profit: ${this.accumulatedProfit}`);

    if (this.accumulatedProfit >= this.profitTarget) {
      console.log(`Profit target of ${this.profitTarget} reached. Selling and stopping trade.`);
      await this.placeOrder(symbol, 'sell', quantity);
      this.stopTrade();
    }
  }

  private isNewDay(): boolean {
    const oneDayInMillis = 24 * 60 * 60 * 1000;
    return (Date.now() - this.startDayTimestamp) >= oneDayInMillis;
  }

  private async startContinuousMonitoring(symbol: string, quantity: number, rebuyPercentage: number) {
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

            if (priceDrop > 0.004) { // 0.4% drop
                logger.info(`Price dropped by more than 0.4% for ${symbol}. Selling.`);
                await this.placeOrder(symbol, 'sell'); // No quantity specified
                await this.checkAndHandleProfit(symbol, quantity, currentPrice);
                delete this.purchasePrices[symbol];
                logger.info(`Waiting for 3 minutes before starting monitorAfterSale for ${symbol}.`);
                setTimeout(() => {
                    this.monitorAfterSale(symbol, quantity, currentPrice, rebuyPercentage); // Start monitoring after sale after 3 minutes
                }, 10000); // 3 minutes delay
            } else if (profit >= 0.02) { // 2% profit
                logger.info(`Profit of 2% or more for ${symbol}. Selling.`);
                await this.placeOrder(symbol, 'sell'); // No quantity specified
                await this.checkAndHandleProfit(symbol, quantity, currentPrice);
                delete this.purchasePrices[symbol];
                logger.info(`Waiting for 3 minutes before starting monitorAfterSale for ${symbol}.`);
                setTimeout(() => {
                    this.monitorAfterSale(symbol, quantity, currentPrice, rebuyPercentage); // Start monitoring after sale after 3 minutes
                }, 18000); // 3 minutes delay
            } else if (this.accumulatedProfit >= this.profitTarget) {
                logger.info(`Accumulated profit target reached for ${symbol}. Selling.`);
                await this.placeOrder(symbol, 'sell'); // No quantity specified
                this.stopTrade();
            } else if (Date.now() - purchase.timestamp <= 60000 && profit >= 0.05) { // 5% increase in 1 minute
                logger.info(`5% profit in 1 minute for ${symbol}. Waiting for further changes.`);
                await this.waitForSkyrocketingProfit(symbol, quantity, rebuyPercentage);
            }
        } catch (error) {
            logger.info('Error checking price and selling: ' + error);
        }
    }, 10000); // Check every 25 seconds
}

  private async waitForSkyrocketingProfit(symbol: string, quantity: number, rebuyPercentage: number) {
    this.skyrocketProfitMode = true; // Set skyrocket profit mode to true
    this.skyrocketProfitTarget = 8; // Assuming 50% profit target for skyrocket mode

    const checkSkyrocketingInterval = setInterval(async () => {
      try {
        if (this.isNewDay()) {
          console.log('A new day has started. Resetting accumulated profit.');
          this.accumulatedProfit = 0;
          this.startDayTimestamp = Date.now();
        }

        const currentPrice = await this.fetchTicker(symbol);
        const purchase = this.purchasePrices[symbol];
        if (!purchase) {
          console.error('Purchase price not found for symbol:', symbol);
          clearInterval(checkSkyrocketingInterval);
          return;
        }

        const purchasePrice = purchase.price;
        const profit = (currentPrice - purchasePrice) / purchasePrice;

        if (profit >= 0.1) { // 10% profit
          await this.placeOrder(symbol, 'sell', quantity);
          await this.checkAndHandleProfit(symbol, quantity, currentPrice);
          delete this.purchasePrices[symbol];
          clearInterval(checkSkyrocketingInterval);
          this.monitorAfterSale(symbol, quantity, currentPrice, rebuyPercentage); // Start monitoring after sale
          this.skyrocketProfitMode = false; // Reset skyrocket profit mode
          this.skyrocketProfitTarget = 0; // Reset skyrocket profit target
        }

      } catch (error) {
        console.error('Error checking skyrocketing profit:', error);
      }
    }, 60000); // Check every minute

    setTimeout(() => {
      clearInterval(checkSkyrocketingInterval);
      this.skyrocketProfitMode = false; // Reset skyrocket profit mode
      this.skyrocketProfitTarget = 0; // Reset skyrocket profit target
    }, 240000); // Stop after 4 minutes
  }

  private activeMonitoringIntervals: { [key: string]: NodeJS.Timeout } = {};

  private async monitorAfterSale(symbol: string, quantity: number, sellPrice: number, rebuyPercentage: number): Promise<void> {
    const startRebuyMonitoring = async (currentSymbol: string, quantity: number, rebuyPercentage: number) => {
        logger.info(`Starting rebuy monitoring for ${currentSymbol} with quantity: ${quantity}, sellPrice: ${sellPrice}, rebuyPercentage: ${rebuyPercentage}`);

        let initialPrice: number | undefined = await this.monitoringExchange.fetchTicker(currentSymbol).then(ticker => ticker.last);
        if (initialPrice === undefined) {
            logger.error(`Initial price for ${currentSymbol} is undefined.`);
            return;
        }
        logger.info(`Initial price for ${currentSymbol}: ${initialPrice}`);

        const checkRebuyInterval = setInterval(async () => {
            try {
                const currentPrice = await this.monitoringExchange.fetchTicker(currentSymbol).then(ticker => ticker.last);
                if (currentPrice === undefined) {
                    logger.error(`Current price for ${currentSymbol} is undefined.`);
                    return;
                }
                logger.info(`Current price for ${currentSymbol}: ${currentPrice}`);

                if (initialPrice !== undefined) {
                    const priceIncrease = (currentPrice - initialPrice) / initialPrice;
                    const priceDrop = (initialPrice - currentPrice) / initialPrice;

                    logger.info(`Price change for ${currentSymbol}: Increase: ${priceIncrease * 100}%, Drop: ${priceDrop * 100}%`);

                    if (priceIncrease >= 0.002) { // 0.2% increase
                        logger.info(`Price increased by 0.2% or more for ${currentSymbol}.`);

                        const availableBalance = await this.getUserBalance();
                        logger.info(`User balance: ${availableBalance}`);

                        const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
                        logger.info(`Amount to rebuy: ${amountToRebuy}`);

                        const rebuyQuantity = amountToRebuy / currentPrice;
                        if (rebuyQuantity <= 0 || rebuyQuantity * currentPrice > availableBalance) {
                            throw new Error('Insufficient balance to rebuy or invalid rebuy quantity.');
                        }
                        logger.info(`Rebuy quantity: ${rebuyQuantity}`);

                        await this.placeOrder(currentSymbol, 'buy', rebuyQuantity, currentPrice);
                        logger.info(`Buy order placed for ${currentSymbol} with quantity: ${rebuyQuantity}`);

                        this.purchasePrices[currentSymbol] = { price: currentPrice, timestamp: Date.now() };
                        logger.info(`Updated purchase price for ${currentSymbol}: ${currentPrice}`);

                        clearInterval(checkRebuyInterval);

                        // Start continuous monitoring after successful rebuy
                        this.startContinuousMonitoring(currentSymbol, rebuyQuantity, rebuyPercentage);
                    } else if (priceDrop >= 0.05) { // 5% drop
                        logger.info(`Price dropped by 5% or more for ${currentSymbol}.`);

                        const availableBalance = await this.getUserBalance();
                        logger.info(`User balance: ${availableBalance}`);

                        const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
                        logger.info(`Amount to rebuy: ${amountToRebuy}`);

                        const rebuyQuantity = amountToRebuy / currentPrice;
                        if (rebuyQuantity <= 0 || rebuyQuantity * currentPrice > availableBalance) {
                            throw new Error('Insufficient balance to rebuy or invalid rebuy quantity.');
                        }
                        logger.info(`Rebuy quantity: ${rebuyQuantity}`);

                        await this.placeOrder(currentSymbol, 'buy', rebuyQuantity, currentPrice);
                        logger.info(`Buy order placed for ${currentSymbol} with quantity: ${rebuyQuantity}`);

                        this.purchasePrices[currentSymbol] = { price: currentPrice, timestamp: Date.now() };
                        logger.info(`Updated purchase price for ${currentSymbol}: ${currentPrice}`);

                        clearInterval(checkRebuyInterval);

                        // Start continuous monitoring after successful rebuy
                        this.startContinuousMonitoring(currentSymbol, rebuyQuantity, rebuyPercentage);
                    }
                }

                const timeElapsed = Date.now() - (this.purchasePrices[currentSymbol]?.timestamp || 0);
                if (timeElapsed >= 210000) { // 3 minutes 30 seconds
                    initialPrice = currentPrice;
                } else {
                    initialPrice = currentPrice;
                }
            } catch (error) {
                logger.error('Error monitoring rebuy: ' + error);
            }
        }, 20000); // Check every 25 seconds

        this.activeMonitoringIntervals[currentSymbol] = checkRebuyInterval;

        setTimeout(async () => {
            if (!this.purchasePrices[currentSymbol] || Date.now() - this.purchasePrices[currentSymbol].timestamp >= 3600000) { // 1 hour
                logger.info(`1 hour elapsed without rebuying ${currentSymbol}. Buying into the top trending coin for the day.`);

                // Fetch the top trending coins for the day
                const trendingCoins = await getTopTrendingCoinsForTheDay();
                if (trendingCoins.length > 0) {
                    const topTrendingCoin = trendingCoins[0].symbol;
                    const availableBalance = await this.getUserBalance();
                    logger.info(`User balance: ${availableBalance}`);

                    // Calculate the amount to rebuy based on the user's available balance
                    const amountToRebuy = (availableBalance * rebuyPercentage) / 100;
                    logger.info(`Amount to rebuy: ${amountToRebuy}`);

                    // Fetch the current price of the top trending coin
                    const currentPrice = await this.monitoringExchange.fetchTicker(topTrendingCoin).then(ticker => ticker.last);
                    if (currentPrice === undefined) {
                        logger.error(`Current price for ${topTrendingCoin} is undefined.`);
                        return;
                    }

                    // Calculate the quantity to rebuy based on the available amount and current price
                    const rebuyQuantity = amountToRebuy / currentPrice;
                    if (rebuyQuantity <= 0 || rebuyQuantity * currentPrice > availableBalance) {
                        throw new Error('Insufficient balance to rebuy or invalid rebuy quantity.');
                    }
                    logger.info(`Rebuy quantity: ${rebuyQuantity}`);

                    // Place the buy order for the top trending coin
                    await this.placeOrder(topTrendingCoin, 'buy', rebuyQuantity, currentPrice);
                    logger.info(`Buy order placed for ${topTrendingCoin} with quantity: ${rebuyQuantity}`);

                    // Update the purchase price and timestamp for the new coin
                    this.purchasePrices[topTrendingCoin] = { price: currentPrice, timestamp: Date.now() };
                    logger.info(`Updated purchase price for ${topTrendingCoin}: ${currentPrice}`);

                    // Stop monitoring the previous coin
                    clearInterval(this.activeMonitoringIntervals[currentSymbol]);
                    delete this.activeMonitoringIntervals[currentSymbol];

                    // Start continuous monitoring for the newly purchased top trending coin
                    this.startContinuousMonitoring(topTrendingCoin, rebuyQuantity, rebuyPercentage);
                } else {
                    // No trending coins found, clear the monitoring interval
                    clearInterval(this.activeMonitoringIntervals[currentSymbol]);
                    delete this.activeMonitoringIntervals[currentSymbol];
                }
            }
        }, 3600000); // 1 hour
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
}