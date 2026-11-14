import { randomInt } from 'crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EightByEightWhatsAppClient } from '../sms/eight-by-eight-whatsapp.client';
import { hashOtp, sameHash } from './otp-hash';
import { OtpProvider } from './otp.provider';

/**
 * Sends our own one-time code as a WhatsApp template through 8x8. The template
 * body has one variable, {{1}} = the code. If it is an Authentication template
 * with a "copy code" button, set EIGHTX8_WA_OTP_BUTTON=true so the code is also
 * passed to the button. We create and check the code ourselves (only a hash is stored).
 */
@Injectable()
export class EightByEightWhatsAppOtpProvider implements OtpProvider {
  private readonly client: EightByEightWhatsAppClient;
  private readonly template: string;
  private readonly language: string;
  private readonly withButton: boolean;
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.client = new EightByEightWhatsAppClient(config);
    this.template = config.get<string>('EIGHTX8_WA_OTP_TEMPLATE') ?? '';
    this.language =
      config.get<string>('EIGHTX8_WA_OTP_LANGUAGE') ||
      config.get<string>('EIGHTX8_WA_LANGUAGE') ||
      'en_US';
    this.withButton = config.get<string>('EIGHTX8_WA_OTP_BUTTON') === 'true';
    this.secret = config.get<string>('JWT_SECRET') ?? 'dev';
  }

  async start(to: string, mobile: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const param = [{ type: 'text', text: code }];

    try {
      await this.client.sendTemplate(to, this.template, this.language, [
        { type: 'body', parameters: param },
        ...(this.withButton
          ? [{ type: 'Button', subType: 1, index: 0, parameters: param }]
          : []),
      ]);
    } catch {
      // The client already logged the reason (a missing or unapproved template is
      // a setup problem, not the visitor's), so visitors only see a generic message.
      throw new ServiceUnavailableException(
        'We could not send the code on WhatsApp right now. Please try again in a minute.',
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
