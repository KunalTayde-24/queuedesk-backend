import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { OtpProvider } from './otp.provider';

type TwilioError = { code?: number; status?: number; message?: string };

/**
 * Real delivery through Twilio Verify. Twilio generates, sends and checks the
 * code (over SMS or WhatsApp, chosen with OTP_CHANNEL), so the code is never
 * stored on our side.
 */
@Injectable()
export class TwilioVerifyOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');
  private readonly client: Twilio;
  private readonly serviceSid: string;
  private readonly channel: 'sms' | 'whatsapp' | 'call';

  constructor(config: ConfigService) {
    this.client = new Twilio(
      config.get<string>('TWILIO_ACCOUNT_SID'),
      config.get<string>('TWILIO_AUTH_TOKEN'),
    );
    this.serviceSid = config.get<string>('TWILIO_VERIFY_SERVICE_SID') ?? '';
    const channel = config.get<string>('OTP_CHANNEL') ?? 'sms';
    this.channel =
      channel === 'whatsapp' || channel === 'call' ? channel : 'sms';
  }

  private service() {
    if (!/^VA[0-9a-f]{32}$/i.test(this.serviceSid)) {
      this.logger.error('TWILIO_VERIFY_SERVICE_SID is missing or invalid');
      throw new ServiceUnavailableException(
        'Phone verification is not set up yet. Please contact the temple office.',
      );
    }
    return this.client.verify.v2.services(this.serviceSid);
  }

  async start(to: string) {
    try {
      await this.service().verifications.create({ to, channel: this.channel });
      return {};
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const e = err as TwilioError;
      this.logger.error(
        `Twilio Verify send failed (${e.code ?? e.status}): ${e.message}`,
      );
      if (e.code === 60203) {
        throw new HttpException(
          'Too many codes requested for this number. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (e.code === 60200 || e.code === 21211) {
        throw new HttpException(
          'That mobile number is not valid.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new ServiceUnavailableException(
        'We could not send the code right now. Please try again in a minute.',
      );
    }
  }

  async check(to: string, _mobile: string, code: string) {
    try {
      const result = await this.service().verificationChecks.create({
        to,
        code,
      });
      return result.status === 'approved';
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const e = err as TwilioError;
      // 20404: no pending verification (already used or expired) - just "wrong".
      if (e.code === 20404) return false;
      this.logger.error(
        `Twilio Verify check failed (${e.code ?? e.status}): ${e.message}`,
      );
      throw new ServiceUnavailableException(
        'We could not check the code right now. Please try again in a minute.',
      );
    }
  }
}
