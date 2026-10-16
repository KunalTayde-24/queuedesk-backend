import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list() {
    return this.eventsService.listPublic();
  }

  @Get(':id/image')
  @Header('Cache-Control', 'public, max-age=3600')
  async image(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.eventsService.getPublicImage(id);
    res.setHeader('Content-Type', image.mime);
    return new StreamableFile(image.data);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.findPublic(id);
  }

  @Post(':id/registrations')
  @HttpCode(HttpStatus.CREATED)
  register(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.eventsService.register(id, dto);
  }
}
