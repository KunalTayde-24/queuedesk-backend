import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { isValidDateKey, todayKey } from '../common/dates';
import { CreateWalkInDto } from './dto/create-token.dto';
import { MoveTokensDto } from './dto/move-tokens.dto';
import { QueueDaysService } from './queue-days.service';
import { TokensService } from './tokens.service';

function requireDateKey(value: string | undefined, fallback?: string): string {
  const key = value ?? fallback;
  if (!isValidDateKey(key)) {
    throw new BadRequestException('Date must look like 2026-10-24');
  }
  return key;
}

/** Staff-only: view any date's queues, choose which event queues are open, add walk-ins. */
@Controller('admin/queue')
@UseGuards(AdminGuard)
export class AdminQueueController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly queueDays: QueueDaysService,
  ) {}

  /** Full queues (with names and phone numbers) for one date, all events or just `eventId`; defaults to today. */
  @Get()
  list(
    @Query('date') date?: string,
    @Query('eventId', new ParseUUIDPipe({ optional: true })) eventId?: string,
  ) {
    return this.tokensService.listForDate(requireDateKey(date, todayKey()), true, eventId);
  }

  @Get('days')
  days() {
    return this.queueDays.listForAdmin();
  }

  @Put('days/:date')
  @HttpCode(HttpStatus.OK)
  open(@Param('date') date: string, @Query('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.queueDays.open(eventId, requireDateKey(date));
  }

  @Delete('days/:date')
  @HttpCode(HttpStatus.OK)
  close(@Param('date') date: string, @Query('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.queueDays.close(eventId, requireDateKey(date));
  }

  /** Moves the waiting tokens of one event's date to another open queue (keeps their order). */
  @Post('move')
  @HttpCode(HttpStatus.OK)
  move(@Body() dto: MoveTokensDto) {
    requireDateKey(dto.from);
    requireDateKey(dto.to);
    return this.tokensService.moveWaiting(dto);
  }

  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  walkIn(@Body() dto: CreateWalkInDto) {
    return this.tokensService.createWalkIn(dto);
  }
}
