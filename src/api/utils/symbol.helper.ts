// src/utils/symbol.helper.ts

export class SymbolHelper {
    /**
     * Converts symbols from "BASE_QUOTE" to "BASE/QUOTE" format.
     * @param symbol - The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
     * @returns The trading symbol in "BASE/QUOTE" format (e.g., "PWC/USDT").
     */
    public static toCCXTSymbol(symbol: string): string {
      return symbol.replace('_', '/').toUpperCase();
    }
  
    /**
     * Converts symbols from "BASE/QUOTE" to "BASE_QUOTE" format.
     * @param symbol - The trading symbol in "BASE/QUOTE" format (e.g., "PWC/USDT").
     * @returns The trading symbol in "BASE_QUOTE" format (e.g., "PWC_USDT").
     */
    public static fromCCXTSymbol(symbol: string): string {
      return symbol.replace('/', '_').toUpperCase();
    }
  }
  