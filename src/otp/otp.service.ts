import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OTP_PROVIDER, OtpProvider } from './otp.provider';

const RESEND_COOLDOWN_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
// After a correct code, the visitor has this long to finish getting their token.
const VERIFIED_VALID_MS = 10 * 60_000;

@Injectable()
export class OtpService {
  private readonly ttlMs: number;
  private readonly countryCode: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {
    this.ttlMs = Number(config.get<string>('OTP_TTL_SECONDS') ?? 300) * 1000;
    this.countryCode = config.get<string>('DEFAULT_COUNTRY_CODE') ?? '+91';
  }

  private e164(mobile: string) {
    return `${this.countryCode}${mobile}`;
  }

  private tooMany(message: string) {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  async send(mobile: string) {
    const now = Date.now();

    const last = await this.prisma.otpChallenge.findFirst({
      where: { mobile },
      orderBy: { createdAt: 'desc' },
    });
    if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (RESEND_COOLDOWN_MS - (now - last.createdAt.getTime())) / 1000,
      );
      throw this.tooMany(
        `Please wait ${wait} seconds before asking for another code.`,
      );
    }

    const recent = await this.prisma.otpChallenge.count({
      where: { mobile, createdAt: { gte: new Date(now - 60 * 60_000) } },
    });
    if (recent >= MAX_SENDS_PER_HOUR) {
      throw this.tooMany(
        'Too many codes requested for this number. Please try again in an hour.',
      );
    }

    const started = await this.provider.start(this.e164(mobile), mobile);

    await this.prisma.otpChallenge.create({
      data: {
        mobile,
        codeHash: started.codeHash ?? null,
        expiresAt: new Date(now + this.ttlMs),
      },
    });

    return {
      sent: true,
      expiresInSeconds: Math.round(this.ttlMs / 1000),
      resendAfterSeconds: RESEND_COOLDOWN_MS / 1000,
      // Only ever present in test mode (see DevOtpProvider).
      ...(started.devCode ? { devCode: started.devCode } : {}),
    };
  }

  async verify(mobile: string, code: string) {
    const now = new Date();
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        mobile,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new BadRequestException(
        'That code has expired. Please ask for a new one.',
      );
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw this.tooMany('Too many wrong tries. Please ask for a new code.');
    }

    // Count the try first, so a slow or failing provider cannot be used to guess for free.
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });

    const ok = await this.provider.check(this.e164(mobile), mobile, code, {
      codeHash: challenge.codeHash,
    });
    if (!ok) {
      const left = MAX_ATTEMPTS - (challenge.attempts + 1);
      throw new BadRequestException(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right. Please ask for a new code.',
      );
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: now },
    });

    // The challenge id is the proof of verification: unguessable, tied to this
    // number in the database, short-lived and usable exactly once.
    return {
      verificationToken: challenge.id,
      expiresInSeconds: VERIFIED_VALID_MS / 1000,
    };
  }

  /**
   * Spends a verification for exactly one token. Runs inside the token's own
   * transaction, so if the token cannot be created the verification is not lost.
   */
  async consume(
    tx: Prisma.TransactionClient,
    verificationToken: string,
    mobile: string,
  ) {
    const result = await tx.otpChallenge.updateMany({
      where: {
        id: verificationToken,
        mobile,
        consumedAt: null,
        verifiedAt: { gte: new Date(Date.now() - VERIFIED_VALID_MS) },
      },
      data: { consumedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new BadRequestException(
        'Phone verification expired. Please verify your number again.',
      );
    }
  }
}
