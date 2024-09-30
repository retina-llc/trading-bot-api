// log.ts
import { createLogger, format, transports } from 'winston';
import * as path from 'path';

const logsDir = path.join(__dirname, '..', 'logs');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({
      filename: 'application.log',
      dirname: logsDir,
      maxsize: 5242880,
      maxFiles: 5,
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    })
  ]
});

logger.info('Test log entry'); // Add this line to create a test log entry

export default logger;

export function getLogger() {
  return logger;
}
