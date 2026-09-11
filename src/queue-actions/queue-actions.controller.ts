import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { QueueActionsService } from './queue-actions.service';

@Controller('queue-actions')
@UseGuards(AdminGuard)
export class QueueActionsController {
  constructor(private readonly queueActionsService: QueueActionsService) {}

  @Post('call/:id')
  @HttpCode(HttpStatus.OK)
  call(@Param('id') id: string) {
    return this.queueActionsService.call(id);
  }

  @Post('recall/:id')
  @HttpCode(HttpStatus.OK)
  recall(@Param('id') id: string) {
    return this.queueActionsService.recall(id);
  }

  @Post('skip/:id')
  @HttpCode(HttpStatus.OK)
  skip(@Param('id') id: string) {
    return this.queueActionsService.skip(id);
  }

  @Post('done/:id')
  @HttpCode(HttpStatus.OK)
  done(@Param('id') id: string) {
    return this.queueActionsService.done(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.queueActionsService.remove(id);
  }
}
