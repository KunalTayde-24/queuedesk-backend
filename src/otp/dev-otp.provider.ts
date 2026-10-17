import { createHash, randomInt, timingSafeEqual } from 'crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp.provider';

/**
 * Test mode: nothing is sent. The code is written to the server log and
 * returned to the caller so the whole flow can be tried without Twilio.
 * It refuses to run on a hosted/production server, so a real visitor can
 * never be shown their own code.
 */
@Injectable()
export class DevOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');

  constructor(private readonly config: ConfigService) {}

  private assertNotProduction() {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
      throw new ServiceUnavailableException(
        'Phone verification is not set up yet. Please contact the temple office.',
      );
    }
  }

  private hash(mobile: string, code: string) {
    const secret = this.config.get<string>('JWT_SECRET') ?? 'dev';
    return createHash('sha256')
      .update(`${secret}:${mobile}:${code}`)
      .digest('hex');
  }

  async start(_to: string, mobile: string) {
    this.assertNotProduction();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.logger.warn(
      `TEST MODE: code for ${mobile} is ${code} (nothing was sent)`,
    );
    return { codeHash: this.hash(mobile, code), devCode: code };
  }

  async check(
    _to: string,
    mobile: string,
    code: string,
    stored: { codeHash: string | null },
  ) {
    this.assertNotProduction();
    if (!stored.codeHash) return false;
    const a = Buffer.from(this.hash(mobile, code));
    const b = Buffer.from(stored.codeHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
