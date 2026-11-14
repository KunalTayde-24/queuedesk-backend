import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toE164 } from '../common/mobile';
import {
  WhatsAppSendError,
  WhatsAppSender,
} from '../whatsapp/whatsapp-sender.interface';
import { EightByEightClient } from './eight-by-eight.client';

const DEFAULT_MESSAGE =
  'Hi {name}, your token number {token} has been called. Please proceed to the counter.';

/** "Token called" notification sent as a plain SMS through 8x8 Connect. */
@Injectable()
export class EightByEightSmsSender implements WhatsAppSender {
  private readonly client: EightByEightClient;
  private readonly countryCode: string;
  private readonly messageText: string;

  constructor(config: ConfigService) {
    this.client = new EightByEightClient(config);
    this.countryCode = config.get<string>('DEFAULT_COUNTRY_CODE') ?? '+65';
    this.messageText = config.get<string>('SMS_MESSAGE') || DEFAULT_MESSAGE;
  }

  async sendTokenCalledMessage(
    mobile: string,
    tokenNumber: number,
    name: string,
  ): Promise<void> {
    try {
      await this.client.send(
        toE164(mobile, this.countryCode),
        this.messageText
          .replace(/\{name\}/g, name)
          .replace(/\{token\}/g, String(tokenNumber)),
      );
    } catch (err) {
      throw new WhatsAppSendError(
        err instanceof Error ? err.message : 'Failed to send SMS',
        err,
      );
    }
  }
}
