import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { WhatsAppSendError, WhatsAppSender } from './whatsapp-sender.interface';

// A real Content Template SID always looks like HX followed by 32 hex chars.
// Anything else (empty, or the placeholder from .env.example) is treated as
// "no template configured" so we can fall back to a freeform text message —
// useful on the Twilio Sandbox, where Content Template Builder requires a
// paid/upgraded account but freeform messages work for free within 24 hours
// of the recipient's last inbound message (e.g. their sandbox join message).
const VALID_TEMPLATE_SID = /^HX[0-9a-f]{32}$/i;

@Injectable()
export class TwilioWhatsAppSender implements WhatsAppSender {
  private readonly client: Twilio;
  private readonly fromNumber: string;
  private readonly templateSid: string;
  private readonly countryCode: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Twilio(
      this.config.get<string>('TWILIO_ACCOUNT_SID'),
      this.config.get<string>('TWILIO_AUTH_TOKEN'),
    );
    this.fromNumber = this.config.get<string>('TWILIO_WHATSAPP_NUMBER') ?? '';
    this.templateSid = this.config.get<string>('TWILIO_TEMPLATE_SID') ?? '';
    this.countryCode = this.config.get<string>('DEFAULT_COUNTRY_CODE') ?? '';
  }

  async sendTokenCalledMessage(
    mobile: string,
    tokenNumber: number,
  ): Promise<void> {
    const toNumber = `whatsapp:${this.countryCode}${mobile}`;

    try {
      if (VALID_TEMPLATE_SID.test(this.templateSid)) {
        await this.client.messages.create({
          from: `whatsapp:${this.fromNumber}`,
          to: toNumber,
          contentSid: this.templateSid,
          contentVariables: JSON.stringify({ '1': String(tokenNumber) }),
        });
      } else {
        await this.client.messages.create({
          from: `whatsapp:${this.fromNumber}`,
          to: toNumber,
          body: `Your token number ${tokenNumber} has been called. Please proceed to the counter.`,
        });
      }
    } catch (err) {
      throw new WhatsAppSendError(
        err instanceof Error ? err.message : 'Failed to send WhatsApp message',
        err,
      );
    }
  }
}
