import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Token, TokenStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { dateFromKey, keyFromDate, todayKey } from '../common/dates';
import { CreateTokenDto, CreateWalkInDto } from './dto/create-token.dto';
import { QueueDaysService } from './queue-days.service';

const MAX_RETRIES = 5;

/** The token as sent to the website, with the date as a plain "YYYY-MM-DD". */
export interface TokenView {
  id: string;
  date: string;
  tokenNumber: number;
  name: string;
  mobile: string;
  status: TokenStatus;
  createdAt: Date;
}

function toView(token: Token, includeMobile: boolean): TokenView {
  return {
    id: token.id,
    date: keyFromDate(token.date),
    tokenNumber: token.tokenNumber,
    name: token.name,
    // The public queue (display board, visitors' phones) never receives phone numbers.
    mobile: includeMobile ? token.mobile : '',
    status: token.status,
    createdAt: token.createdAt,
  };
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly queueDays: QueueDaysService,
  ) {}

  /** A visitor's token: the date must be open and the phone number verified. */
  async createForVisitor(dto: CreateTokenDto): Promise<TokenView> {
    const today = todayKey();
    if (dto.date < today) {
      throw new BadRequestException('That date has already passed. Please pick another.');
    }
    if (!(await this.queueDays.isOpen(dto.date))) {
      throw new BadRequestException(
        'The queue is not open on that date. Please pick one of the open dates.',
      );
    }

    // One live token per phone number per date. Checked before the code is
    // spent, so a duplicate attempt does not burn the verification.
    const existing = await this.prisma.token.findFirst({
      where: {
        date: dateFromKey(dto.date),
        mobile: dto.mobile,
        status: { not: TokenStatus.DONE },
      },
    });
    if (existing) {
      throw new ConflictException(
        `This number already has token #${existing.tokenNumber} for that date.`,
      );
    }

    const token = await this.allocate(
      dateFromKey(dto.date),
      { name: dto.name.trim(), mobile: dto.mobile },
      (tx) => this.otp.consume(tx, dto.verificationToken, dto.mobile),
    );
    return toView(token, true);
  }

  /** Staff adding someone at the counter: no OTP, any date, default today. */
  async createWalkIn(dto: CreateWalkInDto): Promise<TokenView> {
    const key = dto.date ?? todayKey();
    const token = await this.allocate(dateFromKey(key), {
      name: dto.name.trim(),
      mobile: dto.mobile,
    });
    return toView(token, true);
  }

  /** One token by id for its holder's phone: no phone number, so the id alone reveals little. */
  async findPublic(id: string): Promise<TokenView> {
    const token = await this.prisma.token.findUnique({ where: { id } });
    if (!token) throw new NotFoundException('Token not found');
    return toView(token, false);
  }

  /**
   * Moves the people still waiting on one date to another open date, keeping their
   * order and giving them the next numbers there. Called or finished tokens stay
   * where they are. A person who already holds a live token on the new date is skipped.
   */
  async moveWaiting(fromKey: string, toKey: string): Promise<{ moved: number; skipped: number }> {
    if (fromKey === toKey) {
      throw new BadRequestException('Pick a different date to move the tokens to.');
    }
    if (toKey < todayKey()) {
      throw new BadRequestException('You cannot move tokens to a date that has already passed.');
    }
    if (!(await this.queueDays.isOpen(toKey))) {
      throw new BadRequestException('The new date is not open for the queue yet.');
    }
    const from = dateFromKey(fromKey);
    const to = dateFromKey(toKey);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const waiting = await tx.token.findMany({
              where: { date: from, status: TokenStatus.WAITING },
              orderBy: { tokenNumber: 'asc' },
            });
            if (waiting.length === 0) return { moved: 0, skipped: 0 };

            const live = await tx.token.findMany({
              where: { date: to, status: { not: TokenStatus.DONE } },
              select: { mobile: true },
            });
            const taken = new Set(live.map((t) => t.mobile));
            const top = await tx.token.aggregate({ where: { date: to }, _max: { tokenNumber: true } });
            let next = (top._max.tokenNumber ?? 0) + 1;

            let moved = 0;
            let skipped = 0;
            for (const token of waiting) {
              if (taken.has(token.mobile)) {
                skipped++;
                continue;
              }
              await tx.token.update({ where: { id: token.id }, data: { date: to, tokenNumber: next++ } });
              taken.add(token.mobile);
              moved++;
            }
            return { moved, skipped };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === 'P2034');
        if (!retryable || attempt === MAX_RETRIES - 1) throw err;
      }
    }
    return { moved: 0, skipped: 0 };
  }

  async listForDate(key: string, includeMobile: boolean): Promise<TokenView[]> {
    const tokens = await this.prisma.token.findMany({
      where: { date: dateFromKey(key) },
      orderBy: { tokenNumber: 'desc' },
    });
    return tokens.map((t) => toView(t, includeMobile));
  }

  private async allocate(
    date: Date,
    data: { name: string; mobile: string },
    beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<Token> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (beforeCreate) await beforeCreate(tx);

            // Uses Prisma's own aggregate (not a raw query) so the date is
            // serialized identically to how `create` below writes it.
            const result = await tx.token.aggregate({
              where: { date },
              _max: { tokenNumber: true },
            });
            const next = (result._max.tokenNumber ?? 0) + 1;

            return tx.token.create({
              data: { date, tokenNumber: next, name: data.name, mobile: data.mobile },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        const isRetryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2002' || err.code === 'P2034');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new Error('Failed to allocate a token number');
  }
}
