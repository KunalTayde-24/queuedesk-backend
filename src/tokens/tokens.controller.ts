import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { todayKey } from '../common/dates';
import { CreateTokenDto } from './dto/create-token.dto';
import { QueueDaysService } from './queue-days.service';
import { TokensService } from './tokens.service';

/** Public endpoints: used by visitors' phones and the display board. */
@Controller('tokens')
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly queueDays: QueueDaysService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTokenDto) {
    return this.tokensService.createForVisitor(dto);
  }

  /** Today's queue, without phone numbers. */
  @Get('today')
  findToday() {
    return this.tokensService.listForDate(todayKey(), false);
  }

  /** The dates visitors can pick from. */
  @Get('dates')
  openDates() {
    return this.queueDays.listOpenForVisitors();
  }
}
