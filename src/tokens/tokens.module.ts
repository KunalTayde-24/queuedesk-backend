import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OtpModule } from '../otp/otp.module';
import { AdminQueueController } from './admin-queue.controller';
import { QueueDaysService } from './queue-days.service';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [OtpModule, AuthModule],
  controllers: [TokensController, AdminQueueController],
  providers: [TokensService, QueueDaysService],
  exports: [TokensService],
})
export class TokensModule {}
