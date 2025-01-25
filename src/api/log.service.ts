import { Injectable, InternalServerErrorException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class LogService {
  private readonly logsDirectory = path.join(__dirname, "..", "logs");
  private readonly maxLogs = 200; // Limit to 200 logs per user

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? "Invalid date" : date.toISOString();
  }

  private formatLogEntry(logEntry: string): string {
    try {
      const logObject = JSON.parse(logEntry);
      logObject.timestamp = this.formatTimestamp(logObject.timestamp);
      return JSON.stringify(logObject);
    } catch (error) {
      console.error(
        "Failed to parse log entry:",
        error instanceof Error ? error.message : String(error),
      );
      return logEntry;
    }
  }

  /**
   * Writes a new log entry for a user, ensuring the log count is limited to `maxLogs`.
   * @param userId - The ID of the user.
   * @param logEntry - The log entry to write.
   */
  async writeLog(userId: number, logEntry: string): Promise<void> {
    const logFilePath = path.join(this.logsDirectory, `user-${userId}.log`);
    console.log(`[writeLog] Logs directory: ${this.logsDirectory}`);
    console.log(`[writeLog] Log file path for user ${userId}: ${logFilePath}`);

    try {
      if (!fs.existsSync(this.logsDirectory)) {
        console.log("[writeLog] Logs directory does not exist. Creating it...");
        fs.mkdirSync(this.logsDirectory, { recursive: true });
      }

      let logs: string[] = [];
      if (fs.existsSync(logFilePath)) {
        console.log(`[writeLog] Existing log file found for user ${userId}`);
        const existingLogs = fs.readFileSync(logFilePath, "utf8");
        logs = existingLogs.split("\n").filter((entry) => entry.trim() !== "");
      } else {
        console.log(`[writeLog] No existing log file for user ${userId}`);
      }

      // Add the new log entry
      logs.push(logEntry);
      console.log(`[writeLog] Added new log entry for user ${userId}: ${logEntry}`);

      // Trim to the last `maxLogs` entries
      if (logs.length > this.maxLogs) {
        console.log(`[writeLog] Trimming logs for user ${userId} to ${this.maxLogs} entries`);
        logs = logs.slice(-this.maxLogs);
      }

      // Write back to the log file
      fs.writeFileSync(logFilePath, logs.join("\n"), "utf8");
      console.log(`[writeLog] Successfully wrote logs for user ${userId}`);
    } catch (error) {
      console.error(
        "[writeLog] Failed to write log entry:",
        error instanceof Error ? error.message : String(error),
      );
      throw new InternalServerErrorException("Failed to write log entry");
    }
  }

  /**
   * Retrieves logs for a specific user.
   * @param userId - The ID of the user whose logs are to be fetched.
   * @returns The log contents as a string or a message if no logs are available.
   */
  async getLogs(userId: number): Promise<string> {
    try {
      const logFilePath = path.join(this.logsDirectory, `user-${userId}.log`);
      console.log(`[getLogs] Log file path for user ${userId}: ${logFilePath}`);

      if (!fs.existsSync(logFilePath)) {
        console.log(`[getLogs] No log file found for user ${userId}`);
        return "No records available";
      }

      const logs = fs.readFileSync(logFilePath, "utf8").trim();
      console.log(`[getLogs] Retrieved logs for user ${userId}:`, logs);
      return logs || "No records available";
    } catch (error) {
      console.error(
        "[getLogs] Failed to read log files:",
        error instanceof Error ? error.message : String(error),
      );
      throw new InternalServerErrorException("Failed to read log files");
    }
  }

  /**
   * Truncates logs to the last `maxLogs` entries for a specific user.
   * @param userId - The ID of the user.
   */
  async truncateUserLogs(userId: number): Promise<void> {
    const logFilePath = path.join(this.logsDirectory, `user-${userId}.log`);
    console.log(`[truncateUserLogs] Log file path for user ${userId}: ${logFilePath}`);

    try {
      if (fs.existsSync(logFilePath)) {
        console.log(`[truncateUserLogs] Truncating logs for user ${userId}`);
        const logs = fs.readFileSync(logFilePath, "utf8")
          .split("\n")
          .filter((entry) => entry.trim() !== "");

        // Trim to the last `maxLogs` entries
        const truncatedLogs = logs.slice(-this.maxLogs);

        // Write back only the truncated logs
        fs.writeFileSync(logFilePath, truncatedLogs.join("\n"), "utf8");
        console.log(`[truncateUserLogs] Successfully truncated logs for user ${userId}`);
      } else {
        console.log(`[truncateUserLogs] No log file found for user ${userId}`);
      }
    } catch (error) {
      console.error(
        "[truncateUserLogs] Failed to truncate log file:",
        error instanceof Error ? error.message : String(error),
      );
      throw new InternalServerErrorException("Failed to truncate log file");
    }
  }

  /**
   * Deletes all logs for a specific user, or truncates them if the file exists.
   * @param userId - The ID of the user whose logs are to be managed.
   */
  async deleteUserLogs(userId: number): Promise<void> {
    try {
      const logFilePath = path.join(this.logsDirectory, `user-${userId}.log`);
      console.log(`[deleteUserLogs] Log file path for user ${userId}: ${logFilePath}`);

      if (fs.existsSync(logFilePath)) {
        console.log(`[deleteUserLogs] Truncating logs for user ${userId}`);
        await this.truncateUserLogs(userId);
      } else {
        console.log(`[deleteUserLogs] No log file found for user ${userId}`);
      }
    } catch (error) {
      console.error(
        "[deleteUserLogs] Failed to delete log file:",
        error instanceof Error ? error.message : String(error),
      );
      throw new InternalServerErrorException("Failed to delete log file");
    }
  }
}
