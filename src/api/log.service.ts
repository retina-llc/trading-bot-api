import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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

  async getLogs(): Promise<string> {
    try {
      console.log(`Logs directory: ${this.logsDirectory}`);

      if (!fs.existsSync(this.logsDirectory)) {
        console.error(`Logs directory does not exist: ${this.logsDirectory}`);
        return 'No records available';
      }

      // Refresh the list of log files
      const logFiles = fs.readdirSync(this.logsDirectory);
      console.log(`Log files found: ${logFiles.join(', ')}`);

      if (logFiles.length === 0) {
        console.error(`No log files found in directory: ${this.logsDirectory}`);
        return 'No records available';
      }

      const logContents = logFiles.map(file => {
        const filePath = path.join(this.logsDirectory, file);
        console.log(`Reading log file: ${filePath}`);

        try {
          const fileContents = fs.readFileSync(filePath, 'utf8');
          const formattedEntries = fileContents.split('\n').map(this.formatLogEntry.bind(this)).join('\n');
          return formattedEntries;
        } catch (fileReadError) {
          console.error(`Failed to read file ${filePath}:`, (fileReadError instanceof Error) ? fileReadError.message : String(fileReadError));
          return '';  // Returning empty string in case of read errors
        }
      }).join('\n');

      return logContents || 'No records available';  // Return message if logContents is empty
    } catch (error) {
      console.error('Failed to read log files:', (error instanceof Error) ? error.message : String(error));
      throw new InternalServerErrorException('Failed to read log files');
    }
  }

  async deleteAllLogs(): Promise<void> {
    try {
      console.log(`Logs directory: ${this.logsDirectory}`);

      if (!fs.existsSync(this.logsDirectory)) {
        console.error(`Logs directory does not exist: ${this.logsDirectory}`);
        throw new InternalServerErrorException(`Logs directory does not exist: ${this.logsDirectory}`);
      }

      const logFiles = fs.readdirSync(this.logsDirectory);
      console.log(`Log files found for deletion: ${logFiles.join(', ')}`);

      if (logFiles.length === 0) {
        console.error(`No log files found in directory: ${this.logsDirectory}`);
        throw new InternalServerErrorException(`No log files found in directory: ${this.logsDirectory}`);
      }

      logFiles.forEach(file => {
        const filePath = path.join(this.logsDirectory, file);
        console.log(`Deleting log file: ${filePath}`);
        try {
          fs.unlinkSync(filePath);
        } catch (deleteError) {
          console.error(`Failed to delete file ${filePath}:`, (deleteError instanceof Error) ? deleteError.message : String(deleteError));
        }
      });

      console.log(`All log files deleted successfully.`);
    } catch (error) {
      console.error('Failed to delete log files:', (error instanceof Error) ? error.message : String(error));
      throw new InternalServerErrorException('Failed to delete log files');
    }
  }
}
