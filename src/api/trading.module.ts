import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt"; // Import JwtModule
import { TradingService } from "./trading.service";
import AIService from "../ai/ai.service";
import { RateLimiterService } from "./rate.limiter";
import { TradingController } from "./controllers";
import { LogService } from "./log.service";
import { UserModule } from "./user/user-module";
import { ApiModule } from "./api-module";

@Module({
  imports: [
    UserModule,
    ApiModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "your_secret_key", // Replace with your actual secret
      signOptions: { expiresIn: "1h" }, // Optional: Configure expiration
    }),
  ], // Import UserModule and JwtModule
  controllers: [TradingController],
  providers: [TradingService, AIService, RateLimiterService, LogService],
  exports: [TradingService, LogService],
})
export class TradingModule {}
