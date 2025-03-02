import {
    Controller,
    Get,
    Post,
    HttpException,
    HttpStatus,
    Body,
    Req,
    BadRequestException,
    UseGuards,
  } from "@nestjs/common";
  import { Request } from "express";
  import { AuthGuard } from "./subscription/awt.guard"; // or wherever your AuthGuard is
  import { JwtService } from "@nestjs/jwt";
  import { RequestWithUser } from "./request-user";
import { BinanceTradingService } from "./binance";
  
  /**
   * A dedicated controller for Binance-based trading endpoints.
   */
  @Controller("binance")
  export class BinanceController {
    constructor(
      private readonly binanceTradingService: BinanceTradingService,
      private readonly jwtService: JwtService,
    ) {}
  
    /**
     * Get user's Binance balance for USDT (or any currency).
     * Example usage: GET /binance/balance
     */
    @UseGuards(AuthGuard)
    @Get("balance")
    async getBalance(@Req() req: RequestWithUser): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      try {
        const balance = await this.binanceTradingService.getUserBalance(userId, "USDT");
        return { balance };
      } catch (error) {
        throw new HttpException(
          `Failed to fetch user balance: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Start a Binance trade (market buy), then begin monitoring logic.
     * Example usage: POST /binance/start-trade
     *  {
     *    "symbol": "BTC_USDT",
     *    "usdtAmount": 10,
     *    "rebuyPercentage": 5,
     *    "profitTarget": 50
     *  }
     */
    @UseGuards(AuthGuard)
    @Post("start-trade")
    async startTrade(
      @Req() req: RequestWithUser,
      @Body()
      body: {
        symbol: string;
        usdtAmount: number;
        rebuyPercentage: number;
        profitTarget: number;
      },
    ): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      const { symbol, usdtAmount, rebuyPercentage, profitTarget } = body;
      if (!symbol || !usdtAmount || !rebuyPercentage || !profitTarget) {
        throw new BadRequestException(
          "symbol, usdtAmount, rebuyPercentage, and profitTarget are required.",
        );
      }
  
      try {
        const result = await this.binanceTradingService.startTrade(
          userId,
          symbol,
          usdtAmount,
          rebuyPercentage,
          profitTarget,
        );
        return { message: `Trade started for ${symbol} on Binance.`, ...result };
      } catch (error) {
        throw new HttpException(
          `Failed to start trade: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Stop all Binance trades for the user (clears intervals, marks everything sold).
     * Example usage: GET /binance/stop-trade
     */
    @UseGuards(AuthGuard)
    @Get("stop-trade")
    async stopTrade(@Req() req: RequestWithUser): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      try {
        this.binanceTradingService.stopTrade(userId);
        return { message: "All Binance trading stopped successfully." };
      } catch (error) {
        throw new HttpException(
          `Failed to stop Binance trading: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Place a manual buy/sell order on Binance (market).
     * Example usage: POST /binance/place-order
     *  { "symbol": "BTC_USDT", "side": "buy", "amount": 10 }
     */
    @UseGuards(AuthGuard)
    @Post("place-order")
    async placeOrder(
      @Req() req: RequestWithUser,
      @Body() body: { symbol: string; side: "buy" | "sell"; amount?: number },
    ): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      const { symbol, side, amount } = body;
      if (!symbol || !side) {
        throw new BadRequestException("Symbol and side are required.");
      }
  
      try {
        await this.binanceTradingService.placeOrder(userId, symbol, side, amount || 0);
        return { message: `Order ${side} placed for ${symbol} on Binance.` };
      } catch (error) {
        throw new HttpException(
          `Failed to place Binance order: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Immediately sell a position and stop its monitoring.
     * Example usage: POST /binance/sell-now
     *  { "symbol": "BTC_USDT" }
     */
    @UseGuards(AuthGuard)
    @Post("sell-now")
    async sellNow(
      @Req() req: RequestWithUser,
      @Body() body: { symbol: string },
    ): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      const { symbol } = body;
      if (!symbol) {
        throw new BadRequestException("Symbol is required.");
      }
  
      try {
        await this.binanceTradingService.sellNow(userId, symbol);
        return { message: `Sell order placed for ${symbol} on Binance.` };
      } catch (error) {
        throw new HttpException(
          `Failed to process sell-now request: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Immediately buy (market) using your rebuy logic.
     * Example usage: POST /binance/buy-now
     *  { "symbol": "BTC_USDT", "usdtAmount": 20 }
     *
     * If you pass 0 or omit 'usdtAmount', the service might fallback to a 
     * formula like (userBalance * rebuyPercentage/100).
     */
    @UseGuards(AuthGuard)
    @Post("buy-now")
    async buyNow(
      @Req() req: RequestWithUser,
      @Body() body: { symbol: string; usdtAmount?: number },
    ): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      const { symbol, usdtAmount } = body;
      if (!symbol) {
        throw new BadRequestException("Symbol is required.");
      }
  
      try {
        await this.binanceTradingService.buyNow(userId, symbol, usdtAmount || 0);
        return { message: `Buy order placed for ${symbol} on Binance.` };
      } catch (error) {
        throw new HttpException(
          `Failed to process buy-now request: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Check user's accumulated profit on Binance. 
     * Example usage: GET /binance/accumulated-profit
     */
    @UseGuards(AuthGuard)
    @Get("accumulated-profit")
    async getAccumulatedProfit(@Req() req: RequestWithUser): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      try {
        const accumulatedProfit = this.binanceTradingService.getAccumulatedProfit(userId);
        return { accumulatedProfit };
      } catch (error) {
        throw new HttpException(
          `Failed to retrieve accumulated profit: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Get user’s configured profit target on Binance trades.
     * Example usage: GET /binance/profit-target
     */
    @UseGuards(AuthGuard)
    @Get("profit-target")
    async getProfitTarget(@Req() req: RequestWithUser): Promise<any> {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      try {
        const profitTarget = this.binanceTradingService.getProfitTarget(userId);
        return { profitTarget };
      } catch (error) {
        throw new HttpException(
          `Failed to retrieve profit target: ${(error as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  
    /**
     * Retrieve current status (active trades, etc.) from BinanceTradingService.
     * Example usage: GET /binance/status
     */
    @UseGuards(AuthGuard)
    @Get("status")
    getStatus(@Req() req: RequestWithUser): any {
      const userId = req.user?.id;
      if (!userId) {
        throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
      }
  
      return this.binanceTradingService.getStatus(userId);
    }
  }
  