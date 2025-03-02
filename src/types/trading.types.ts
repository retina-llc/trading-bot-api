interface PurchaseInfo {
  price: number;
  timestamp: number;
  quantity: number;
  sold: boolean;
  rebuyPercentage: number;
  profitThresholds: number[]; // Array of profit percentages to sell at
}

interface TradeState {
  purchasePrices: Record<string, PurchaseInfo>;
  monitorIntervals: Record<string, NodeJS.Timeout>;
  activeMonitoringIntervals: Record<string, NodeJS.Timeout>;
  profitThresholds: number[]; // Default thresholds for new trades
} 