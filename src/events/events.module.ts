import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TokensModule } from '../tokens/tokens.module';
import { EventsAdminController } from './events-admin.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AuthModule, TokensModule],
  controllers: [EventsController, EventsAdminController],
  providers: [EventsService],
})
export class EventsModule {}
