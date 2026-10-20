import { randomInt } from 'crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashOtp, sameHash } from './otp-hash';
import { OtpProvider } from './otp.provider';

/**
 * Temporary test mode, used until a real provider is configured. Nothing is
 * sent: the code is returned to the caller so the page can show it, which means
 * it does NOT prove the visitor owns the phone number. It keeps the whole flow
 * working (send code, enter code, expiry, resend and attempt limits).
 *
 * It switches itself off the moment OTP_PROVIDER is set to a real provider
 * (twilio-whatsapp or twilio-verify). To forbid it on a hosted server, set
 * OTP_ALLOW_TEST_MODE=false.
 */
@Injectable()
export class DevOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');
  private readonly secret: string;
  private readonly allowed: boolean;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('JWT_SECRET') ?? 'dev';
    const hosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    this.allowed = !(hosted && config.get<string>('OTP_ALLOW_TEST_MODE') === 'false');
    if (hosted && this.allowed) {
      this.logger.warn(
        'OTP TEST MODE is active on a hosted server: codes are shown on screen and do not verify phone ownership. Set OTP_PROVIDER to a real provider to turn this off.',
      );
    }
  }

  private assertAllowed() {
    if (!this.allowed) {
      throw new ServiceUnavailableException(
        'Phone verification is not set up yet. Please contact the temple office.',
      );
    }
  }

  async start(_to: string, mobile: string) {
    this.assertAllowed();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    this.logger.warn(
      `TEST MODE: code for ${mobile} is ${code} (nothing was sent)`,
    );
    return { codeHash: hashOtp(this.secret, mobile, code), devCode: code };
  }

  async check(
    _to: string,
    mobile: string,
    code: string,
    stored: { codeHash: string | null },
  ) {
    this.assertAllowed();
    if (!stored.codeHash) return false;
    return sameHash(hashOtp(this.secret, mobile, code), stored.codeHash);
  }
}
