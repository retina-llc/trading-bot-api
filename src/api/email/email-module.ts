import { Module } from '@nestjs/common';
import { EmailService } from './email-service';

@Module({
  providers: [EmailService],
  exports: [EmailService], // Export to use in other modules
})
export class EmailModule {}
