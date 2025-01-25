// src/logger.ts
import { createLogger, format, transports } from "winston";
import * as path from "path";
import * as fs from "fs";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, json } = format;

// Define directories for user and system logs
const logsDir = path.join(__dirname, "..", "logs");
const systemLogsDir = path.join(__dirname, "..", "system_logs");
console.log('Logs Directory Path:', logsDir);
console.log('System Logs Directory Path:', systemLogsDir);

// Ensure the user logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Ensure the system logs directory exists
if (!fs.existsSync(systemLogsDir)) {
  fs.mkdirSync(systemLogsDir, { recursive: true });
}

// Define the log format as JSON
const logFormat = combine(timestamp(), json());

// Logger factory function for user-specific logs
export function getUserLogger(userId: number) {
  return createLogger({
    level: "info",
    format: logFormat,
    transports: [
      new DailyRotateFile({
        filename: path.join(logsDir, `user-${userId}-%DATE%.log`),
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "20m",
        maxFiles: "14d",
      }),
      new transports.Console(),
    ],
  });
}

// System-wide logger
export const systemLogger = createLogger({
  level: "info",
  format: logFormat,
  transports: [
    new DailyRotateFile({
      filename: path.join(systemLogsDir, `system-%DATE%.log`),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
    new transports.Console(),
  ],
});
