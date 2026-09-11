import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { QueueActionsController } from './queue-actions.controller';
import { QueueActionsService } from './queue-actions.service';

@Module({
  imports: [AuthModule, WhatsappModule],
  controllers: [QueueActionsController],
  providers: [QueueActionsService],
})
export class QueueActionsModule {}
