import axios from "axios";
import fs from "fs";
import path from "path";
import { EmailService } from "./email/email-service";

const emailService = new EmailService();

// API keys for the top gainers
const TOP_GAINERS_API_KEY = "63cbdd8eb8f3b73d9cb852072290648ba91a9fa8";
const TOP_GAINERS_API_SECRET =
  "28793edd474d812cbf388bb2a4c497782c867355d80f71d53b4e972e1adec58d";

// API keys for the most volatile coins
const VOLATILE_COINS_API_KEY = "fd1a780d1beca5a20d712d17e13b6acd443634a4";
const VOLATILE_COINS_API_SECRET =
  "ba57f596383e372ee0ee3e46ec6ad3c9686f2bab0bcc6adce7de7356c3c846ce";

// Paths for data persistence
const PERSISTENCE_PATH = path.resolve(__dirname, "data");
const TOP_GAINERS_FILE = path.join(PERSISTENCE_PATH, "topGainersStore.json");
const DAILY_GAINERS_FILE = path.join(
  PERSISTENCE_PATH,
  "dailyGainersStore.json",
);
const PUMPED_COINS_FILE = path.join(PERSISTENCE_PATH, "pumpedCoins.json");

// Type for ticker data
interface TickerData {
  symbol: string;
  last_price: string;
}

// Type for volatility data
interface VolatilityDataEntry {
  prices: number[];
  totalFluctuation: number;
}

// Store for tracking top gainers across multiple calls
let topGainersStore: {
  [symbol: string]: { count: number; totalPercentageIncrease: number };
} = loadData(TOP_GAINERS_FILE) || {};
let dailyGainersStore: {
  [symbol: string]: { count: number; totalPercentageIncrease: number };
} = loadData(DAILY_GAINERS_FILE) || {};
let pumpedCoins: { [symbol: string]: { percentageIncrease: number } } =
  loadData(PUMPED_COINS_FILE) || {};
let lastResetDate: Date = new Date();

// Ensure persistence directory exists
function ensurePersistencePath() {
  if (!fs.existsSync(PERSISTENCE_PATH)) {
    fs.mkdirSync(PERSISTENCE_PATH);
  }
}

// Load data from a JSON file
function loadData(filePath: string): any {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
  return null;
}

// Save data to a JSON file
function saveData(filePath: string, data: any) {
  ensurePersistencePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function resetDailyStoreIfNeeded() {
  const currentDate = new Date();
  if (
    currentDate.getDate() !== lastResetDate.getDate() ||
    currentDate.getMonth() !== lastResetDate.getMonth() ||
    currentDate.getFullYear() !== lastResetDate.getFullYear()
  ) {
    dailyGainersStore = {};
    pumpedCoins = {}; // Reset pumped coins daily
    lastResetDate = currentDate;
    saveData(DAILY_GAINERS_FILE, dailyGainersStore);
    saveData(PUMPED_COINS_FILE, pumpedCoins);
  }
}

// Function to get ticker data for all coins using given API credentials
async function getTickerData(
  apiKey: string,
  apiSecret: string,
): Promise<TickerData[]> {
  const response = await axios.get(
    "https://api-cloud.bitmart.com/spot/v1/ticker",
    {
      headers: {
        "X-BM-KEY": apiKey,
        "X-BM-SECRET": apiSecret,
      },
    },
  );

  return response.data.data.tickers;
}

// Function to calculate the percentage increase over a 3-minute interval
export async function getTopGainers() {
  const tickers = await getTickerData(
    TOP_GAINERS_API_KEY,
    TOP_GAINERS_API_SECRET,
  );

  // Store the initial prices
  const initialPrices: { [symbol: string]: number } = {};
  tickers.forEach((ticker: TickerData) => {
    initialPrices[ticker.symbol] = parseFloat(ticker.last_price);
  });

  // Wait for 3 minutes
  await new Promise((resolve) => setTimeout(resolve, 3 * 60 * 1000));

  // Fetch the ticker data again
  const updatedTickers = await getTickerData(
    TOP_GAINERS_API_KEY,
    TOP_GAINERS_API_SECRET,
  );

  // Calculate the percentage increase
  const gains = updatedTickers.map((ticker: TickerData) => {
    const initialPrice = initialPrices[ticker.symbol];
    const updatedPrice = parseFloat(ticker.last_price);
    const percentageIncrease =
      ((updatedPrice - initialPrice) / initialPrice) * 100;
    return { symbol: ticker.symbol, percentageIncrease };
  });

  // Filter out tickers with non-positive percentage increases
  const positiveGains = gains.filter((gain) => gain.percentageIncrease > 0);

  // Sort the tickers by percentage increase in descending order
  positiveGains.sort((a, b) => b.percentageIncrease - a.percentageIncrease);

  // Update the top gainers store
  positiveGains.slice(0, 5).forEach(({ symbol, percentageIncrease }) => {
    if (!topGainersStore[symbol]) {
      topGainersStore[symbol] = { count: 0, totalPercentageIncrease: 0 };
    }
    topGainersStore[symbol].count += 1;
    topGainersStore[symbol].totalPercentageIncrease += percentageIncrease;
  });

  // Save the top gainers store to the local drive
  saveData(TOP_GAINERS_FILE, topGainersStore);

  // Update the daily gainers store
  positiveGains.slice(0, 5).forEach(({ symbol, percentageIncrease }) => {
    if (!dailyGainersStore[symbol]) {
      dailyGainersStore[symbol] = { count: 0, totalPercentageIncrease: 0 };
    }
    dailyGainersStore[symbol].count += 1;
    dailyGainersStore[symbol].totalPercentageIncrease += percentageIncrease;

    // Track pumped coins
    if (percentageIncrease >= 20) {
      pumpedCoins[symbol] = { percentageIncrease };
    }
  });

  // Save the daily gainers and pumped coins to the local drive
  saveData(DAILY_GAINERS_FILE, dailyGainersStore);
  saveData(PUMPED_COINS_FILE, pumpedCoins);

  // Return the top 5 gainers
  return positiveGains.slice(0, 5);
}

// Function to calculate the most volatile coin within the last 2 minutes
export async function getMostVolatileCoin() {
  const volatilityWindow = 2 * 60 * 1000; // 2 minutes
  const fetchInterval = 10000; // Fetch data every 10 seconds
  const fetchCount = volatilityWindow / fetchInterval;

  const volatilityData: { [symbol: string]: VolatilityDataEntry } = {};

  for (let i = 0; i < fetchCount; i++) {
    const tickers = await getTickerData(
      VOLATILE_COINS_API_KEY,
      VOLATILE_COINS_API_SECRET,
    );

    tickers.forEach((ticker: TickerData) => {
      const symbol = ticker.symbol;
      const price = parseFloat(ticker.last_price);

      if (!volatilityData[symbol]) {
        volatilityData[symbol] = {
          prices: [],
          totalFluctuation: 0,
        };
      }

      const symbolData = volatilityData[symbol];
      if (symbolData.prices.length > 0) {
        const lastPrice = symbolData.prices[symbolData.prices.length - 1];
        const fluctuation = Math.abs(price - lastPrice);
        symbolData.totalFluctuation += fluctuation;
      }

      symbolData.prices.push(price);
    });

    // Wait for the fetch interval
    await new Promise((resolve) => setTimeout(resolve, fetchInterval));
  }

  // Calculate the average fluctuation for each coin
  const volatilityScores = Object.keys(volatilityData).map((symbol) => {
    const symbolData = volatilityData[symbol];
    const averageFluctuation =
      symbolData.totalFluctuation / (symbolData.prices.length - 1);
    return { symbol, averageFluctuation };
  });

  // Sort by the average fluctuation in descending order
  volatilityScores.sort((a, b) => b.averageFluctuation - a.averageFluctuation);

  // Return the most volatile coin
  return volatilityScores[0];
}

// Function to get the top 10 trending coins
export function getTopTrendingCoins() {
  const trendingCoins = Object.keys(topGainersStore).map((symbol) => {
    const data = topGainersStore[symbol];
    const averagePercentageIncrease = data.totalPercentageIncrease / data.count;
    return { symbol, count: data.count, averagePercentageIncrease };
  });

  // Filter out coins with non-positive average percentage increases
  const positiveTrendingCoins = trendingCoins.filter(
    (coin) => coin.averagePercentageIncrease > 0,
  );

  // Sort by the count of appearances in the top 5, and then by average percentage increase
  positiveTrendingCoins.sort(
    (a, b) =>
      b.count - a.count ||
      b.averagePercentageIncrease - a.averagePercentageIncrease,
  );

  // Return the top 10 trending coins
  return positiveTrendingCoins.slice(0, 10);
}

export function getTopTrendingCoinsForTheDay() {
  resetDailyStoreIfNeeded();

  const trendingCoins = Object.keys(dailyGainersStore).map((symbol) => {
    const data = dailyGainersStore[symbol];
    const averagePercentageIncrease = data.totalPercentageIncrease / data.count;
    return { symbol, count: data.count, averagePercentageIncrease };
  });

  // Filter out coins with non-positive average percentage increases
  const positiveTrendingCoins = trendingCoins.filter(
    (coin) => coin.averagePercentageIncrease > 0,
  );

  // Sort by the count of appearances in the top 5, and then by average percentage increase
  positiveTrendingCoins.sort(
    (a, b) =>
      b.count - a.count ||
      b.averagePercentageIncrease - a.averagePercentageIncrease,
  );

  // Return the top 5 trending coins for the day
  return positiveTrendingCoins.slice(0, 5);
}

// Function to get pumped coins for the day
export function getPumpedCoins() {
  resetDailyStoreIfNeeded();
  return pumpedCoins;
}
