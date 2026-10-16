import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UploadedImage } from './events.image';
import { EventsService } from './events.service';
import { eventImageUpload } from './events.upload';

interface AdminRequest {
  user: { sub: string; email: string };
}

@Controller('admin/events')
@UseGuards(AdminGuard)
export class EventsAdminController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list() {
    return this.eventsService.listAdmin();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(eventImageUpload)
  create(
    @Req() req: AdminRequest,
    @Body() dto: CreateEventDto,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.eventsService.create(req.user.sub, dto, file);
  }

  @Get(':id/registrations')
  registrations(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.listRegistrations(id);
  }

  @Get(':id/image')
  @Header('Cache-Control', 'private, max-age=60')
  async image(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.eventsService.getAdminImage(id);
    res.setHeader('Content-Type', image.mime);
    return new StreamableFile(image.data);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.findAdmin(id);
  }

  @Patch(':id')
  @UseInterceptors(eventImageUpload)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEventDto,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.eventsService.update(id, dto, file);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.publish(id);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.unpublish(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.cancel(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.remove(id);
  }
}
