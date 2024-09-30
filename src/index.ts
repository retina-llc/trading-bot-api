import * as dotenv from 'dotenv';
import { getTicker, getOrderBook } from './api/api';
import { GeminiAIClient } from './ai/gemini.ai';
import { placeOrder } from './api/trading';  // Import the placeOrder function

dotenv.config();

const aiClient = GeminiAIClient.getInstance();

async function main() {
  try {
    const symbol = 'BTC_USDT';

    // Get AI recommendation
    const prompt = { message: `Provide a trading recommendation for ${symbol}` };
    const aiRecommendation = await aiClient.generate(prompt);
    console.log('AI Recommendation:', aiRecommendation);

    // Fetch ticker and order book data
    const ticker = await getTicker(symbol);
    console.log('Ticker:', ticker);

    const orderBook = await getOrderBook(symbol);
    console.log('Order Book:', orderBook);

    // Implement your trading strategy based on AI recommendations
    if (aiRecommendation.includes('buy')) {
      console.log('Recommendation: Buy');
      // Place a buy order
      const buyQuantity = calculateBuyQuantity(ticker);  // Implement your logic to calculate quantity
      await placeOrder(symbol, 'buy', buyQuantity);
      console.log('Placed buy order');
    } else if (aiRecommendation.includes('sell')) {
      console.log('Recommendation: Sell');
      // Place a sell order
      const sellQuantity = calculateSellQuantity(ticker);  // Implement your logic to calculate quantity
      await placeOrder(symbol, 'sell', sellQuantity);
      console.log('Placed sell order');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();

// Function to calculate buy quantity (example logic)
function calculateBuyQuantity(ticker: any) {
  // Implement your logic to determine how much to buy
  // Example: Buy 1 unit
  return 1;
}

// Function to calculate sell quantity (example logic)
function calculateSellQuantity(ticker: any) {
  // Implement your logic to determine how much to sell
  // Example: Sell 1 unit
  return 1;
}
