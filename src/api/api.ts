import axios from 'axios';
import * as crypto from 'crypto';

const BITMART_API_URL = 'https://api-cloud.bitmart.com';
const BITMART_API_KEY = 'ba7fb99a8dfc0348abc7f194bffcbf6513e40d17';
const BITMART_API_SECRET = 'e9ae31b708f572b4b13ef0d9c325bdd5628f3590fc8693120bf49c297a2a583a';

function generateSignature(httpMethod: string, url: string, queryString: string, secretKey: string): string {
  const preHashString = `${httpMethod}${url}${queryString}`;
  return crypto.createHmac('sha256', secretKey).update(preHashString).digest('hex');
}

// Function to get BitMart authentication headers
async function getAuthHeaders(endpoint: string, method: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const queryString = `timestamp=${timestamp}`;
  const signature = generateSignature(method, endpoint, queryString, BITMART_API_SECRET);
  return {
    'X-BM-KEY': BITMART_API_KEY,
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

// Function to get order book from BitMart
export async function getOrderBook(symbol: string): Promise<any> {
  const url = `${BITMART_API_URL}/spot/v1/symbols/book?symbol=${symbol}`;
  const headers = await getAuthHeaders(url, 'GET');
  const response = await axios.get(url, { headers });
  return response.data;
}

// Function to get historical data from BitMart
export async function getHistoricalData(symbol: string): Promise<any> {
  const url = `${BITMART_API_URL}/spot/v1/history?symbol=${symbol}&interval=1h`;
  const headers = await getAuthHeaders(url, 'GET');
  const response = await axios.get(url, { headers });
  return response.data;
}

// Function to analyze historical data and make a prediction
export function analyzeFluctuations(data: any): string {
  const prices = data.map((item: any) => item.price);
  const recentPrice = prices[prices.length - 1];
  const previousPrice = prices[prices.length - 2];

  if (recentPrice > previousPrice) {
    return 'BUY';
  } else if (recentPrice < previousPrice) {
    return 'SELL';
  } else {
    return 'HOLD';
  }
}

// Function to get AI predictions
export async function getAIPredictions(symbol: string): Promise<string> {
  try {
    console.log(`Received request for AI predictions with symbol: ${symbol}`);
    
    const historicalData = await getHistoricalData(symbol);
    const recommendation = analyzeFluctuations(historicalData);

    console.log('AI predictions response:', recommendation);
    return recommendation; // Returns 'BUY', 'SELL', or 'HOLD'
  } catch (error) {
    console.error('Error fetching AI predictions:', error);
    throw new Error('Failed to get AI predictions');
  }
}

// Function to get AI recommendation
export async function getAIRecommendation(symbol: string): Promise<string> {
  try {
    console.log(`Received request for AI recommendation with symbol: ${symbol}`);

    const historicalData = await getHistoricalData(symbol);
    const recommendation = analyzeFluctuations(historicalData);

    console.log('AI recommendation response:', recommendation);
    return recommendation; // Returns 'BUY', 'SELL', or 'HOLD'
  } catch (error) {
    console.error('Error fetching AI recommendation:', error);
    throw new Error('Failed to get AI recommendation');
  }
}

export async function getKline(symbol: string): Promise<any> {
  const fullSymbol = `${symbol}_USDT`; // Adjust this if your quote currency is different
  try {
    const response = await axios.get(`https://api.bitmart.com/v2/klines?symbol=${fullSymbol}&interval=1h`);
    return response.data.data; // Adjust this based on the actual API response structure
  } catch (error) {
    console.error('Error fetching kline data:', error);
    throw error;
  }
}

export async function fetchTicker(symbol: string): Promise<number> {
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
export async function fetchUserTrades(this: any, symbol: string): Promise<any> {
  const endpoint = `/spot/v1/trades`;
  const params = {
    symbol,
  };

  const response = await this.apiRequest('GET', endpoint, params);
  return response.data;
}