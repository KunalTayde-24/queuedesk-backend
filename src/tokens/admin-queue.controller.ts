import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { isValidDateKey, todayKey } from '../common/dates';
import { CreateWalkInDto } from './dto/create-token.dto';
import { QueueDaysService } from './queue-days.service';
import { TokensService } from './tokens.service';

function requireDateKey(value: string | undefined, fallback?: string): string {
  const key = value ?? fallback;
  if (!isValidDateKey(key)) {
    throw new BadRequestException('Date must look like 2026-10-24');
  }
  return key;
}

/** Staff-only: view any date's queue, choose which dates are open, add walk-ins. */
@Controller('admin/queue')
@UseGuards(AdminGuard)
export class AdminQueueController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly queueDays: QueueDaysService,
  ) {}

  /** Full queue (with phone numbers) for one date; defaults to today. */
  @Get()
  list(@Query('date') date?: string) {
    return this.tokensService.listForDate(requireDateKey(date, todayKey()), true);
  }

  @Get('days')
  days() {
    return this.queueDays.listForAdmin();
  }

  @Put('days/:date')
  @HttpCode(HttpStatus.OK)
  open(@Param('date') date: string) {
    return this.queueDays.open(requireDateKey(date));
  }

  @Delete('days/:date')
  @HttpCode(HttpStatus.OK)
  close(@Param('date') date: string) {
    return this.queueDays.close(requireDateKey(date));
  }

  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  walkIn(@Body() dto: CreateWalkInDto) {
    return this.tokensService.createWalkIn(dto);
  }
}
