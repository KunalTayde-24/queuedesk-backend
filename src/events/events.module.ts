import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsAdminController } from './events-admin.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AuthModule],
  controllers: [EventsController, EventsAdminController],
  providers: [EventsService],
})
export class EventsModule {}
