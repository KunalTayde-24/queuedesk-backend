import { randomInt } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { hashOtp, sameHash } from './otp-hash';
import { OtpProvider } from './otp.provider';

type TwilioError = { code?: number; status?: number; message?: string };

// A real Content Template SID is HX followed by 32 hex characters.
const VALID_TEMPLATE_SID = /^HX[0-9a-f]{32}$/i;

const DEFAULT_MESSAGE =
  'Your temple queue verification code is {code}. It is valid for 5 minutes. Do not share it with anyone.';

/**
 * Sends the code as a WhatsApp message through Twilio's Messages API, using
 * the same Twilio account as the "your token is called" message. We create and
 * check the code ourselves (only a hash is stored).
 *
 * - Twilio sandbox: works with a plain text message, for numbers that joined
 *   the sandbox in the last 24 hours. Fine for testing.
 * - Real WhatsApp sender: WhatsApp only allows business-initiated messages
 *   from an approved template, so set OTP_TEMPLATE_SID to an approved
 *   Authentication/Utility template whose body has one variable, {{1}}.
 */
@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');
  private readonly client: Twilio;
  private readonly from: string;
  private readonly templateSid: string;
  private readonly messageText: string;
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.client = new Twilio(
      config.get<string>('TWILIO_ACCOUNT_SID'),
      config.get<string>('TWILIO_AUTH_TOKEN'),
    );
    // OTP_WHATSAPP_FROM lets the OTP use a different sender than the "token called" message.
    this.from =
      config.get<string>('OTP_WHATSAPP_FROM') ||
      config.get<string>('TWILIO_WHATSAPP_NUMBER') ||
      '';
    const template = config.get<string>('OTP_TEMPLATE_SID') ?? '';
    this.templateSid = VALID_TEMPLATE_SID.test(template) ? template : '';
    this.messageText = config.get<string>('OTP_MESSAGE') || DEFAULT_MESSAGE;
    this.secret = config.get<string>('JWT_SECRET') ?? 'dev';
  }

  async start(to: string, mobile: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    try {
      await this.client.messages.create({
        from: `whatsapp:${this.from}`,
        to: `whatsapp:${to}`,
        ...(this.templateSid
          ? {
              contentSid: this.templateSid,
              contentVariables: JSON.stringify({ '1': code }),
            }
          : { body: this.messageText.replace('{code}', code) }),
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const e = err as TwilioError;
      this.logger.error(
        `WhatsApp OTP send failed (${e.code ?? e.status}): ${e.message}`,
      );
      if (e.code === 63015) {
        // Sandbox only: the recipient has not joined it yet.
        throw new HttpException(
          'This WhatsApp number has not joined the Twilio sandbox yet. Send the sandbox "join" message to the sandbox number from this WhatsApp, then try again.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (e.code === 21211 || e.code === 21614) {
        throw new HttpException(
          'That mobile number is not valid.',
          HttpStatus.BAD_REQUEST,
        );
      }
      // 63016 = outside the 24h window (a template is required); 63007 = the
      // sender is not a WhatsApp sender. Both are setup problems, not the visitor's.
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
