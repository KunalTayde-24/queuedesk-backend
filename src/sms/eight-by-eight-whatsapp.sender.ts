import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toE164 } from '../common/mobile';
import {
  WhatsAppSendError,
  WhatsAppSender,
} from '../whatsapp/whatsapp-sender.interface';
import { EightByEightWhatsAppClient } from './eight-by-eight-whatsapp.client';

/**
 * "Token called" message as a WhatsApp template through 8x8. The template body
 * has one variable, {{1}} = the token number (same as the Twilio template).
 */
@Injectable()
export class EightByEightWhatsAppSender implements WhatsAppSender {
  private readonly client: EightByEightWhatsAppClient;
  private readonly countryCode: string;
  private readonly template: string;
  private readonly language: string;

  constructor(config: ConfigService) {
    this.client = new EightByEightWhatsAppClient(config);
    this.countryCode = config.get<string>('DEFAULT_COUNTRY_CODE') ?? '+65';
    this.template = config.get<string>('EIGHTX8_WA_TOKEN_TEMPLATE') ?? '';
    this.language =
      config.get<string>('EIGHTX8_WA_TOKEN_LANGUAGE') ||
      config.get<string>('EIGHTX8_WA_LANGUAGE') ||
      'en_US';
  }

  async sendTokenCalledMessage(
    mobile: string,
    tokenNumber: number,
    _name: string,
  ): Promise<void> {
    try {
      await this.client.sendTemplate(
        toE164(mobile, this.countryCode),
        this.template,
        this.language,
        [
          {
            type: 'body',
            parameters: [{ type: 'text', text: String(tokenNumber) }],
          },
        ],
      );
    } catch (err) {
      throw new WhatsAppSendError(
        err instanceof Error ? err.message : 'Failed to send WhatsApp message',
        err,
      );
    }
  }
}
