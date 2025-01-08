// src/logger.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob'; // Ensure you have installed glob: npm install glob

@Injectable()
export class LogService {
  private readonly logsDirectory = path.join(__dirname, '..', 'logs');

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? 'Invalid date' : date.toISOString();
  }

  private formatLogEntry(logEntry: string): string {
    try {
      const logObject = JSON.parse(logEntry);
      logObject.timestamp = this.formatTimestamp(logObject.timestamp);
      return JSON.stringify(logObject);
    } catch (error) {
      console.error('Failed to parse log entry:', (error instanceof Error) ? error.message : String(error));
      return logEntry;
    }
  }

  /**
   * Retrieves logs for a specific user.
   * @param userId - The ID of the user whose logs are to be fetched.
   * @returns The log contents as a string or a message if no logs are available.
   */
  async getLogs(userId: number): Promise<string> {
    try {
      console.log(`Logs directory: ${this.logsDirectory}`);

      if (!fs.existsSync(this.logsDirectory)) {
        console.error(`Logs directory does not exist: ${this.logsDirectory}`);
        return 'No records available';
      }

      // Use glob to match user-specific log files
      const userLogPattern = path.join(this.logsDirectory, `user-${userId}-*.log`);
      const logFiles = glob.sync(userLogPattern);
      console.log(`Log files found for user ${userId}: ${logFiles.join(', ')}`);

      if (logFiles.length === 0) {
        console.error(`No log files found for user ID ${userId}.`);
        return 'No records available';
      }

      let logContents = '';
      for (const file of logFiles) {
        console.log(`Reading log file: ${file}`);
        try {
          const fileContents = fs.readFileSync(file, 'utf8');
          const formattedEntries = fileContents
            .split('\n')
            .filter(entry => entry.trim() !== '')
            .map(this.formatLogEntry.bind(this))
            .join('\n');
          logContents += formattedEntries + '\n';
        } catch (fileReadError) {
          console.error(`Failed to read file ${file}:`, (fileReadError instanceof Error) ? fileReadError.message : String(fileReadError));
          // Continue reading other files even if one fails
        }
      }

      return logContents.trim() || 'No records available';
    } catch (error) {
      console.error('Failed to read log files:', (error instanceof Error) ? error.message : String(error));
      throw new InternalServerErrorException('Failed to read log files');
    }
  }

  /**
   * Deletes all logs for a specific user.
   * @param userId - The ID of the user whose logs are to be deleted.
   */
  async deleteUserLogs(userId: number): Promise<void> {
    try {
      console.log(`Logs directory: ${this.logsDirectory}`);

      if (!fs.existsSync(this.logsDirectory)) {
        console.error(`Logs directory does not exist: ${this.logsDirectory}`);
        throw new InternalServerErrorException(`Logs directory does not exist: ${this.logsDirectory}`);
      }

      // Use glob to match user-specific log files
      const userLogPattern = path.join(this.logsDirectory, `user-${userId}-*.log`);
      const logFiles = glob.sync(userLogPattern);
      console.log(`Log files found for deletion: ${logFiles.join(', ')}`);

      if (logFiles.length === 0) {
        console.error(`No log files found for user ID ${userId} to delete.`);
        throw new InternalServerErrorException(`No log files found for user ID ${userId}`);
      }

      logFiles.forEach(file => {
        const filePath = path.join(this.logsDirectory, file);
        console.log(`Deleting log file: ${filePath}`);
        try {
          fs.unlinkSync(filePath);
          console.log(`Deleted log file: ${filePath}`);
        } catch (deleteError) {
          console.error(`Failed to delete file ${filePath}:`, (deleteError instanceof Error) ? deleteError.message : String(deleteError));
        }
      });

      console.log(`All log files for user ID ${userId} deleted successfully.`);
    } catch (error) {
      console.error('Failed to delete log files:', (error instanceof Error) ? error.message : String(error));
      throw new InternalServerErrorException('Failed to delete log files');
    }
  }
}
