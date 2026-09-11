import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { WhatsAppSendError, WhatsAppSender } from './whatsapp-sender.interface';

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
      await this.client.messages.create({
        from: `whatsapp:${this.fromNumber}`,
        to: toNumber,
        contentSid: this.templateSid,
        contentVariables: JSON.stringify({ '1': String(tokenNumber) }),
      });
    } catch (err) {
      throw new WhatsAppSendError(
        err instanceof Error ? err.message : 'Failed to send WhatsApp message',
        err,
      );
    }
  }
}
