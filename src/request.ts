// src/index.ts
import * as dotenv from 'dotenv';
import { getTicker, getOrderBook } from './api/api';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

console.log('Gemini API Key:', apiKey);

async function main() {
  try {
    const ticker = await getTicker('btcusd');
    console.log('Ticker:', ticker);

    const orderBook = await getOrderBook('btcusd');
    console.log('Order Book:', orderBook);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

main();
