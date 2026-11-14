import { randomInt } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EightByEightClient, SmsSendError } from '../sms/eight-by-eight.client';
import { hashOtp, sameHash } from './otp-hash';
import { OtpProvider } from './otp.provider';

const DEFAULT_MESSAGE =
  'Your temple queue verification code is {code}. It is valid for 5 minutes. Do not share it with anyone.';

/**
 * Sends our own one-time code as an SMS through 8x8 Connect. We create and
 * check the code ourselves (only a hash is stored), like the WhatsApp provider.
 */
@Injectable()
export class EightByEightOtpProvider implements OtpProvider {
  private readonly client: EightByEightClient;
  private readonly messageText: string;
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.client = new EightByEightClient(config);
    this.messageText = config.get<string>('OTP_MESSAGE') || DEFAULT_MESSAGE;
    this.secret = config.get<string>('JWT_SECRET') ?? 'dev';
  }

  async start(to: string, mobile: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    try {
      await this.client.send(to, this.messageText.replace('{code}', code));
    } catch (err) {
      if (err instanceof SmsSendError && err.httpStatus === 400) {
        throw new HttpException(
          'That mobile number is not valid.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new ServiceUnavailableException(
        'We could not send the code by SMS right now. Please try again in a minute.',
      );
    }

    return { codeHash: hashOtp(this.secret, mobile, code) };
  }

  async check(
    _to: string,
    mobile: string,
    code: string,
    stored: { codeHash: string | null },
  ) {
    if (!stored.codeHash) return false;
    return sameHash(hashOtp(this.secret, mobile, code), stored.codeHash);
  }
}
