import { Injectable } from '@nestjs/common';
import { WhatsAppSender } from './whatsapp-sender.interface';

interface SentMessage {
  mobile: string;
  tokenNumber: number;
}

/**
 * In-memory WhatsApp sender used in tests/local dev without real Twilio
 * credentials. Records every "sent" message instead of calling out.
 */
@Injectable()
export class StubWhatsAppSender implements WhatsAppSender {
  readonly sent: SentMessage[] = [];

  async sendTokenCalledMessage(
    mobile: string,
    tokenNumber: number,
  ): Promise<void> {
    this.sent.push({ mobile, tokenNumber });
  }
}
