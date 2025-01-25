export interface UserTradeState {
  purchasePrices: Record<
    string,
    { price: number; timestamp: number; quantity: number; sold?: boolean }
  >;
  profitTarget: number;
  accumulatedProfit: number;
  startDayTimestamp: number;
  payloadLogs: Record<string, any[]>;
  monitorIntervals: Record<string, NodeJS.Timeout>;
  activeMonitoringIntervals: Record<string, NodeJS.Timeout>;
}
