// src/api/log.controller.ts
import {
  Controller,
  Get,
  Delete,
  Req,
  UseGuards,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request } from "express";
import { LogService } from "./log.service";
import { JwtAuthGuard } from "../auth/jwt-auth";

@Controller("logs") // Base path for the controller
export class LogController {
  constructor(private readonly logService: LogService) {}

  /**
   * Retrieves logs for the authenticated user.
   */
  @UseGuards(JwtAuthGuard) // Use JwtAuthGuard
  @Get()
  async getLogs(@Req() req: Request): Promise<string> {
    console.log("Received request for logs");
    const user = req.user as any; // Adjust based on your authentication setup
    if (!user || !user.id) {
      throw new UnauthorizedException("User not found");
    }
    try {
      const logs = await this.logService.getLogs(user.id);
      return logs;
    } catch (error) {
      console.error("Error fetching logs:", error);
      throw new HttpException(
        "Failed to fetch logs",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Deletes logs for the authenticated user.
   */
  @UseGuards(JwtAuthGuard) // Use JwtAuthGuard
  @Delete("delete")  // Add explicit path
  async deleteLogs(@Req() req: Request): Promise<{ message: string }> {
    const user = req.user as any;
    if (!user || !user.id) {
      throw new UnauthorizedException("User not found");
    }

    try {
      // Wait for deletion to complete
      await this.logService.deleteUserLogs(user.id);
      
      // Verify logs are deleted
      const logs = await this.logService.getLogs(user.id);
      if (logs && logs !== "No records available") {
        throw new Error("Logs were not properly deleted");
      }

      return { message: "Logs deleted successfully" };
    } catch (error) {
      console.error("Error deleting logs:", error);
      throw new HttpException(
        "Failed to delete logs",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
