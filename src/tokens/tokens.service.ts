import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, Token, TokenStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { dateFromKey, keyFromDate, todayKey } from '../common/dates';
import { CreateTokenDto, CreateWalkInDto } from './dto/create-token.dto';
import { MoveTokensDto } from './dto/move-tokens.dto';
import { QueueDaysService } from './queue-days.service';

const MAX_RETRIES = 5;

/** What a token says about the event whose queue it is in. */
export type TokenWithEvent = Token & {
  event?: { title: string; venue: string; startsAt: Date; endsAt: Date } | null;
};

export const withEvent = {
  event: { select: { title: true, venue: true, startsAt: true, endsAt: true } },
} as const;

/** The token as sent to the website, with the date as a plain "YYYY-MM-DD". */
export interface TokenView {
  id: string;
  date: string;
  eventId: string | null;
  eventTitle: string | null;
  eventVenue: string | null;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  tokenNumber: number;
  name: string;
  mobile: string;
  status: TokenStatus;
  calledAt: Date | null;
  createdAt: Date;
}

/**
 * `staff` is true for the admin views and for the visitor who just created the token.
 * The public queue (display board, other visitors' phones) never receives phone
 * numbers or names, only the token number and its status.
 */
function toView(token: TokenWithEvent, staff: boolean): TokenView {
  return {
    id: token.id,
    date: keyFromDate(token.date),
    eventId: token.eventId,
    eventTitle: token.event?.title ?? null,
    eventVenue: token.event?.venue ?? null,
    eventStartsAt: token.event?.startsAt ?? null,
    eventEndsAt: token.event?.endsAt ?? null,
    tokenNumber: token.tokenNumber,
    name: staff ? token.name : '',
    mobile: staff ? token.mobile : '',
    status: token.status,
    calledAt: token.calledAt,
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

  /** The event must be published and run a queue, and its queue must be open that day. */
  private async assertQueueOpen(eventId: string, key: string) {
    if (key < todayKey()) {
      throw new BadRequestException('That date has already passed. Please pick another.');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, needsQueue: true },
    });
    if (!event || event.status !== EventStatus.PUBLISHED || !event.needsQueue) {
      throw new BadRequestException('This event is not taking queue tokens.');
    }
    if (!(await this.queueDays.isOpen(eventId, key))) {
      throw new BadRequestException(
        'The queue for this event is not open on that date. Please pick one of the open queues.',
      );
    }
  }

  /** A visitor's token: the event's queue must be open and the phone number verified. */
  async createForVisitor(dto: CreateTokenDto): Promise<TokenView> {
    await this.assertQueueOpen(dto.eventId, dto.date);

    // One live token per phone number per event and date. Checked before the code is
    // spent, so a duplicate attempt does not burn the verification.
    const existing = await this.prisma.token.findFirst({
      where: {
        eventId: dto.eventId,
        date: dateFromKey(dto.date),
        mobile: dto.mobile,
        status: { not: TokenStatus.DONE },
      },
    });
    if (existing) {
      throw new ConflictException(
        `This number already has token #${existing.tokenNumber} for this event.`,
      );
    }

    const token = await this.allocate(
      dto.eventId,
      dateFromKey(dto.date),
      { name: dto.name.trim(), mobile: dto.mobile },
      (tx) => this.otp.consume(tx, dto.verificationToken, dto.mobile),
    );
    return toView(token, true);
  }

  /** Staff adding someone at the counter: no OTP; the event's queue must be open (default today). */
  async createWalkIn(dto: CreateWalkInDto): Promise<TokenView> {
    const key = dto.date ?? todayKey();
    await this.assertQueueOpen(dto.eventId, key);
    const token = await this.allocate(dto.eventId, dateFromKey(key), {
      name: dto.name.trim(),
      mobile: dto.mobile,
    });
    return toView(token, true);
  }

  /** One token by id for its holder's phone: no name or phone number, so the id alone reveals little. */
  async findPublic(id: string): Promise<TokenView> {
    const token = await this.prisma.token.findUnique({ where: { id }, include: withEvent });
    if (!token) throw new NotFoundException('Token not found');
    return toView(token, false);
  }

  /**
   * Moves the people still waiting in one event's queue on one date to another open queue
   * (another date of the same event, or another event's queue), keeping their order and giving
   * them the next numbers there. Called or finished tokens stay where they are. A person who
   * already holds a live token in the target queue is skipped.
   */
  async moveWaiting(dto: MoveTokensDto): Promise<{ moved: number; skipped: number }> {
    const toEventId = dto.toEventId ?? dto.eventId;
    if (dto.from === dto.to && toEventId === dto.eventId) {
      throw new BadRequestException('Pick a different queue to move the tokens to.');
    }
    if (dto.to < todayKey()) {
      throw new BadRequestException('You cannot move tokens to a date that has already passed.');
    }
    if (!(await this.queueDays.isOpen(toEventId, dto.to))) {
      throw new BadRequestException('That queue is not open yet.');
    }
    const from = dateFromKey(dto.from);
    const to = dateFromKey(dto.to);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const waiting = await tx.token.findMany({
              where: { eventId: dto.eventId, date: from, status: TokenStatus.WAITING },
              orderBy: { tokenNumber: 'asc' },
            });
            if (waiting.length === 0) return { moved: 0, skipped: 0 };

            const live = await tx.token.findMany({
              where: { eventId: toEventId, date: to, status: { not: TokenStatus.DONE } },
              select: { mobile: true },
            });
            const taken = new Set(live.map((t) => t.mobile));
            const top = await tx.token.aggregate({
              where: { eventId: toEventId, date: to },
              _max: { tokenNumber: true },
            });
            let next = (top._max.tokenNumber ?? 0) + 1;

            let moved = 0;
            let skipped = 0;
            for (const token of waiting) {
              if (taken.has(token.mobile)) {
                skipped++;
                continue;
              }
              await tx.token.update({
                where: { id: token.id },
                data: { eventId: toEventId, date: to, tokenNumber: next++ },
              });
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

  /** One date's tokens, optionally only one event's queue. Names and phone numbers are staff-only. */
  async listForDate(key: string, staff: boolean, eventId?: string): Promise<TokenView[]> {
    const tokens = await this.prisma.token.findMany({
      where: { date: dateFromKey(key), ...(eventId ? { eventId } : {}) },
      include: withEvent,
      orderBy: { tokenNumber: 'desc' },
    });
    return tokens.map((t) => toView(t, staff));
  }

  private async allocate(
    eventId: string,
    date: Date,
    data: { name: string; mobile: string },
    beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<TokenWithEvent> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            if (beforeCreate) await beforeCreate(tx);

            // Uses Prisma's own aggregate (not a raw query) so the date is
            // serialized identically to how `create` below writes it.
            const result = await tx.token.aggregate({
              where: { eventId, date },
              _max: { tokenNumber: true },
            });
            const next = (result._max.tokenNumber ?? 0) + 1;

            return tx.token.create({
              data: { eventId, date, tokenNumber: next, name: data.name, mobile: data.mobile },
              include: withEvent,
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
