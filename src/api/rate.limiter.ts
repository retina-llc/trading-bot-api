import { Injectable } from "@nestjs/common";
import axios, { AxiosResponse } from "axios";
import Bottleneck from "bottleneck";

@Injectable()
export class RateLimiterService {
  private requestTimestamps: Map<string, number[]> = new Map();
  private readonly REQUEST_LIMIT = 10; // Adjust based on API limits
  private readonly TIME_FRAME = 60 * 1000; // Time frame in milliseconds

  private cleanUpOldRequests(key: string) {
    const now = Date.now();
    const timestamps = this.requestTimestamps.get(key) || [];
    const recentRequests = timestamps.filter(
      (timestamp) => now - timestamp < this.TIME_FRAME,
    );
    this.requestTimestamps.set(key, recentRequests);
  }

  private addRequest(key: string) {
    this.cleanUpOldRequests(key);
    const timestamps = this.requestTimestamps.get(key) || [];
    timestamps.push(Date.now());
    this.requestTimestamps.set(key, timestamps);
  }

  async getTickerData(symbol: string): Promise<any> {
    const key = `ticker_${symbol}`;
    this.addRequest(key);
    const timestamps = this.requestTimestamps.get(key) || [];
    if (timestamps.length > this.REQUEST_LIMIT) {
      // Exceeding rate limit, wait or retry
      const waitTime = this.TIME_FRAME - (Date.now() - Math.min(...timestamps));
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
    // Perform API request here
    // return axios.get(`https://api-cloud.bitmart.com/spot/v1/ticker?symbol=${symbol}`);
  }
}
