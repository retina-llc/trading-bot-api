import { Injectable, InternalServerErrorException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";

@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);
  private readonly logsDirectory: string;
  private readonly maxLogs = 200; // Limit to 200 logs per user

  constructor() {
    // Resolve absolute path for production
    this.logsDirectory = process.env.NODE_ENV === 'production' 
      ? '/home/ubuntu/app/dist/logs'
      : path.join(__dirname, '..', 'logs');
  }

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

    try {
      // Ensure logs directory exists
      if (!fs.existsSync(this.logsDirectory)) {
        fs.mkdirSync(this.logsDirectory, { recursive: true });
      }

      // Read existing logs
      let logs: string[] = [];
      if (fs.existsSync(logFilePath)) {
        const existingLogs = fs.readFileSync(logFilePath, "utf8");
        logs = existingLogs.split("\n").filter(entry => entry.trim() !== "");
      }

      // Add new log entry
      logs.push(this.formatLogEntry(logEntry));

      // Strictly enforce the maxLogs limit by keeping only the most recent logs
      if (logs.length > this.maxLogs) {
        this.logger.warn(`Log limit exceeded for user ${userId}. Trimming to ${this.maxLogs} entries.`);
        logs = logs.slice(-this.maxLogs); // Keep only the last maxLogs entries
      }

      // Write back to file
      fs.writeFileSync(logFilePath, logs.join("\n"), "utf8");
    } catch (error) {
      console.error(
        "[writeLog] Failed to write log entry:",
        error instanceof Error ? error.message : String(error)
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
    const userLogsPattern = path.join(this.logsDirectory, `user-${userId}*.log*`);

    // Get all matching log files for the user
    const matchingFiles = fs.readdirSync(this.logsDirectory).filter((file) =>
      file.startsWith(`user-${userId}`)
    );

    if (matchingFiles.length === 0) {
      console.log(`[getLogs] No matching log files found for user ${userId}`);
      return "No records available";
    }

    // Sort files by modification date to get the latest
    const latestLogFile = matchingFiles
      .map((file) => ({
        file,
        time: fs.statSync(path.join(this.logsDirectory, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time)[0].file;


    const logFilePath = path.join(this.logsDirectory, latestLogFile);
    const logs = fs.readFileSync(logFilePath, "utf8").trim();

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
      
      this.logger.debug(`Attempting to delete logs at: ${logFilePath}`);
      
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(this.logsDirectory)) {
        fs.mkdirSync(this.logsDirectory, { recursive: true });
      }

      if (fs.existsSync(logFilePath)) {
        fs.truncateSync(logFilePath, 0);
        this.logger.log(`Successfully cleared logs for user ${userId}`);
      } else {
        // Create empty file if it doesn't exist
        fs.writeFileSync(logFilePath, '', { encoding: 'utf8' });
        this.logger.log(`Created new empty log file for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to clear logs for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      throw new InternalServerErrorException("Failed to clear logs");
    }
  }

  async truncateExistingLogs(userId: number): Promise<void> {
    const logFilePath = path.join(this.logsDirectory, `user-${userId}.log`);
    
    try {
      if (fs.existsSync(logFilePath)) {
        const existingLogs = fs.readFileSync(logFilePath, "utf8")
          .split("\n")
          .filter(entry => entry.trim() !== "");

        if (existingLogs.length > this.maxLogs) {
          const truncatedLogs = existingLogs.slice(-this.maxLogs);
          fs.writeFileSync(logFilePath, truncatedLogs.join("\n"), "utf8");
          this.logger.log(`Truncated logs for user ${userId} to ${this.maxLogs} entries`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to truncate logs for user ${userId}:`, error);
    }
  }
}
