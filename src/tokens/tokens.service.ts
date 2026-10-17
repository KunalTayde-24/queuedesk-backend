import {
  BadRequestException,
  ConflictException,
  Injectable,
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
