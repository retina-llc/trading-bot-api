// src/api/logger.module.ts
import { Module } from '@nestjs/common';
import { LogService } from './log.service';
import { LogController } from './log.controller';

@Module({
  controllers: [LogController], // Register LogController
  providers: [LogService],
  exports: [LogService], // Export if other modules need to use LogService
})
export class LoggerModule {}
