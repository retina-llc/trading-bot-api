// testLoadMarkets.ts

import ccxt from 'ccxt';

(async () => {
  const exchange = new ccxt.bitmart({
    verbose: true, // Enable verbose logging
  });

  try {
    await exchange.loadMarkets();
    console.log(`Total markets loaded: ${exchange.symbols.length}`);

    const testSymbol = 'PWC_USDT';
    if (exchange.symbols.includes(testSymbol)) {
      console.log(`Success: ${testSymbol} is available.`);
    } else {
      console.warn(`Warning: ${testSymbol} is NOT available.`);
    }
  } catch (error: any) {
    console.error(`Error loading markets: ${error.message}`);
  }
})();
