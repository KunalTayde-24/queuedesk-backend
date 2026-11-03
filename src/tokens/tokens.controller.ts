import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { dateFromKey, keyFromDate, todayKey } from '../common/dates';
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

  /**
   * One date's queue, without phone numbers: lets a visitor holding a token for a
   * later date see when it is called. `dateFromKey` rejects a malformed date.
   */
  @Get('queue')
  findByDate(@Query('date') date: string) {
    return this.tokensService.listForDate(keyFromDate(dateFromKey(date ?? '')), false);
  }

  /** The dates visitors can pick from. */
  @Get('dates')
  openDates() {
    return this.queueDays.listOpenForVisitors();
  }

  /** One token's current date, number and status, so a visitor's ticket follows a move. */
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tokensService.findPublic(id);
  }
}
