import axios from 'axios';
import * as crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const BITMART_API_URL = 'https://api-cloud.bitmart.com';

// Generate BitMart signature
function generateSignature(httpMethod: string, url: string, body: any, secretKey: string): string {
  const preHashString = `${httpMethod}${url}${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secretKey).update(preHashString).digest('hex');
}

// Function to get BitMart authentication headers
async function getAuthHeaders(endpoint: string, method: string): Promise<any> {
  const apiKey = process.env.BITMART_API_KEY!;
  const apiSecret = process.env.BITMART_API_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const queryString = `timestamp=${timestamp}`;
  const signature = generateSignature(method, endpoint, queryString, apiSecret);
  return {
    'X-BM-KEY': apiKey,
    'X-BM-SIGN': signature,
    'Content-Type': 'application/json'
  };
}

// Function to get ticker data from BitMart
export async function getTicker(symbol: string): Promise<any> {
  const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${symbol}`;
  const headers = await getAuthHeaders(url, 'GET');
  const response = await axios.get(url, { headers });
  return response.data;
}

export async function getUserBalance(): Promise<number> {
  const url = `${BITMART_API_URL}/account/v1/wallet`;
  const headers = await getAuthHeaders(url, 'GET');
  
  try {
    console.log('Received request for user balance');
    const response = await axios.get(url, { headers });
    console.log('Received full response:', JSON.stringify(response.data, null, 2)); // Log the entire response

    const balances = response.data.data;
    console.log('Received balances object:', JSON.stringify(balances, null, 2)); // Log the balances object

    // Check if the wallet array exists and has entries
    if (!balances.wallet || balances.wallet.length === 0) {
      console.log('No funds found in wallet, returning balance as $0.00');
      return 0.00; // Return 0 if wallet is empty
    }

    // Ensure you handle the actual structure of the response correctly
    const usdBalance = balances.wallet.find((b: any) => b.currency === 'USD'); // Adjust based on actual balance structure

    if (!usdBalance) {
      console.error('USD balance not found');
      return 0.00; // Return 0 if USD balance is not found
    }

    return parseFloat(usdBalance.balance);
  } catch (error) {
    console.error('Error fetching user balance:', error);
    throw new Error('Failed to fetch user balance');
  }
}

// Function to place an order on BitMart
export async function placeOrder(symbol: string, side: 'buy' | 'sell', quantity: number) {
  const url = `${BITMART_API_URL}/spot/v1/order`;
  const apiKey = process.env.BITMART_API_KEY!;
  const apiSecret = process.env.BITMART_API_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    symbol,
    side,
    quantity,
    type: 'limit', // or 'market' based on your needs
    price: '0', // or set an appropriate price for limit orders
    timestamp,
  };
  const signature = generateSignature('POST', '/spot/v1/order', body, apiSecret);

  const headers = {
    'X-BM-KEY': apiKey,
    'X-BM-SIGN': signature,
    'Content-Type': 'application/json',
  };

  try {
    const response = await axios.post(url, body, { headers });
    return response.data;
  } catch (error) {
    console.error('Error placing order:', error);
    throw new Error('Failed to place order');
  }
}

// Store purchase prices and timestamps
const purchasePrices: Record<string, { price: number; timestamp: number }> = {};

// Function to monitor coins and buy based on percentage increase
// Function to monitor coins and buy based on percentage increase
export async function monitorAndBuy(symbols: string[]) {
  try {
    if (symbols.length === 0) {
      throw new Error('Please provide at least one symbol.');
    }

    console.log('Starting monitoring with symbols:', symbols);
    
    // Get user balance
    const balance = await getUserBalance();
    const buyAmount = balance * 0.1; // 10% of the balance
    console.log('User balance:', balance);
    console.log('Amount to invest in each coin:', buyAmount);

    // Get the top 2 gainer symbols
    const topSymbols = await getTopGainer(symbols);

    if (topSymbols.length === 0) {
      console.log('No top gainers found, aborting.');
      return;
    }

    // Use the first top gainer symbol
    const topSymbol = topSymbols[0];
    const purchaseQuantity = buyAmount / (await getTicker(topSymbol)).data.tickers[0].last_price;

    console.log('Buying top gainer:', topSymbol);
    await placeOrder(topSymbol, 'buy', purchaseQuantity);

    // Store the purchase price and timestamp
    purchasePrices[topSymbol] = { price: parseFloat((await getTicker(topSymbol)).data.tickers[0].last_price), timestamp: Date.now() };

    // Set interval to check price and sell
    setInterval(async () => {
      console.log('Checking price and selling for symbol:', topSymbol);
      await checkPriceAndSell(topSymbol, purchaseQuantity);
    }, 60000); // Check every minute
  } catch (error) {
    console.error('Error monitoring and buying:', error);
  }
}


// Function to check price and handle selling based on conditions
export async function checkPriceAndSell(symbol: string, quantity: number) {
  const url = `${BITMART_API_URL}/spot/v1/ticker?symbol=${symbol}`;
  
  try {
    console.log('Fetching current price for symbol:', symbol);
    const response = await axios.get(url);
    const currentPrice = parseFloat(response.data.tickers[0].last_price);
    console.log('Current price:', currentPrice);
    
    const purchase: { price: number; timestamp: number } | undefined = purchasePrices[symbol];
    if (!purchase) {
      console.error('Purchase price not found for symbol:', symbol);
      return;
    }

    const purchasePrice = purchase.price;
    const priceDrop = (purchasePrice - currentPrice) / purchasePrice;
    const profit = (currentPrice - purchasePrice) / purchasePrice;

    console.log('Purchase price:', purchasePrice);
    console.log('Price drop percentage:', priceDrop);
    console.log('Profit percentage:', profit);

    if (priceDrop > 0.004) { // 0.4% drop
      console.log('Price dropped by 0.4%, selling:', symbol);
      await placeOrder(symbol, 'sell', quantity);
      delete purchasePrices[symbol]; // Clear stored price after selling
    } else if (profit >= 0.1) { // 10% profit
      console.log('Profit target of 10% reached, selling:', symbol);
      await placeOrder(symbol, 'sell', quantity);
      delete purchasePrices[symbol]; // Clear stored price after selling
    }
  } catch (error) {
    console.error('Error checking price and selling:', error);
    throw new Error('Failed to check price and sell');
  }
}

// Function to get the top 2 gainers among provided symbols
// Function to get the top 2 gainers among provided symbols based on 24-hour percentage increase
export async function getTopGainer(symbols: string[]): Promise<string[]> {
  try {
    if (symbols.length === 0) {
      throw new Error('Please provide at least one symbol.');
    }

    console.log('Determining top gainers among symbols:', symbols);
    
    // Store percentage increase for each symbol
    const increases: Record<string, number> = {};

    for (const symbol of symbols) {
      console.log('Processing symbol:', symbol);
      const tickerData = await getTicker(symbol);

      if (tickerData && tickerData.data && tickerData.data.tickers.length > 0) {
        const ticker = tickerData.data.tickers[0];
        const openPrice = parseFloat(ticker.open_24h);
        const closePrice = parseFloat(ticker.close_24h);
        const percentageIncrease = ((closePrice - openPrice) / openPrice) * 100;

        increases[symbol] = percentageIncrease;

        console.log('Ticker data for symbol', symbol, ':', tickerData);
        console.log('Open price:', openPrice);
        console.log('Close price:', closePrice);
        console.log('Percentage increase:', percentageIncrease);
      } else {
        console.error(`No ticker data found for symbol: ${symbol}`);
      }
    }

    // Find the top 2 symbols with the highest percentage increase
    const sortedSymbols = Object.keys(increases)
      .sort((a, b) => increases[b] - increases[a])
      .slice(0, 2);

    console.log('Top gainers symbols:', sortedSymbols);
    
    return sortedSymbols;
  } catch (error) {
    console.error('Error determining top gainers:', error);
    return [];
  }
}
