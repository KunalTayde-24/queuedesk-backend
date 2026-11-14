import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsSendError } from './eight-by-eight.client';

export type WaComponent = Record<string, unknown>;

/**
 * Minimal client for 8x8 Connect Chat Apps (WhatsApp) template messages:
 * POST https://chatapps.8x8.com/api/v1/subaccounts/{subAccountId}/messages
 * WhatsApp only allows a business to start a chat with an approved template,
 * so every send names a template created and approved in the 8x8 portal.
 * Uses the Chat Apps sub-account (EIGHTX8_WA_SUBACCOUNT_ID, e.g. *_CA_WA_*),
 * not the SMS sub-account.
 */
export class EightByEightWhatsAppClient {
  private readonly logger = new Logger('8x8-WA');
  private readonly apiKey: string;
  private readonly subAccountId: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('EIGHTX8_API_KEY') ?? '';
    this.subAccountId = config.get<string>('EIGHTX8_WA_SUBACCOUNT_ID') ?? '';
    this.baseUrl = (
      config.get<string>('EIGHTX8_CHATAPPS_BASE_URL') ||
      'https://chatapps.8x8.com'
    ).replace(/\/+$/, '');
  }

  /** `to` is an E.164 number such as +6591234567. */
  async sendTemplate(
    to: string,
    name: string,
    language: string,
    components: WaComponent[],
  ): Promise<void> {
    if (!this.apiKey || !this.subAccountId || !name) {
      throw new SmsSendError('8x8 WhatsApp is not configured');
    }

    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/api/v1/subaccounts/${encodeURIComponent(this.subAccountId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user: { msisdn: to },
            type: 'template',
            content: { template: { language, name, components } },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (err) {
      this.logger.error(`WhatsApp request failed: ${(err as Error).message}`);
      throw new SmsSendError('Could not reach the WhatsApp provider');
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        code?: number;
        message?: string;
      } | null;
      const reason = body?.message ?? `HTTP ${res.status}`;
      this.logger.error(
        `WhatsApp rejected (${res.status}${body?.code != null ? ` code ${body.code}` : ''}): ${reason}`,
      );
      throw new SmsSendError(reason, res.status);
    }
  }
}
