import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

/**
 * Minimal client for the 8x8 Connect SMS API (single-message endpoint):
 * POST {base}/api/v1/subaccounts/{subAccountId}/messages
 * with `Authorization: Bearer <API key>`. Create the key and note the sub-account
 * id in the 8x8 Connect portal (connect.8x8.com).
 */
export class EightByEightClient {
  private readonly logger = new Logger('8x8');
  private readonly apiKey: string;
  private readonly subAccountId: string;
  private readonly sender: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('EIGHTX8_API_KEY') ?? '';
    this.subAccountId = config.get<string>('EIGHTX8_SUBACCOUNT_ID') ?? '';
    this.sender = config.get<string>('EIGHTX8_SENDER_ID') ?? '';
    this.baseUrl = (
      config.get<string>('EIGHTX8_BASE_URL') || 'https://sms.8x8.com'
    ).replace(/\/+$/, '');
  }

  /** `to` is an E.164 number such as +6591234567. */
  async send(to: string, text: string): Promise<void> {
    if (!this.apiKey || !this.subAccountId) {
      throw new SmsSendError('8x8 SMS is not configured');
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
            ...(this.sender ? { source: this.sender } : {}),
            destination: to,
            text,
            encoding: 'AUTO',
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (err) {
      this.logger.error(`SMS request failed: ${(err as Error).message}`);
      throw new SmsSendError('Could not reach the SMS provider');
    }

    const body = (await res.json().catch(() => null)) as {
      status?: { code?: string; description?: string };
      message?: string;
    } | null;

    // 200 with status.code QUEUED means 8x8 accepted it; anything else is a failure.
    const code = body?.status?.code;
    if (!res.ok || (code && code !== 'QUEUED')) {
      const reason =
        body?.status?.description ?? body?.message ?? `HTTP ${res.status}`;
      this.logger.error(`SMS rejected (${res.status} ${code ?? ''}): ${reason}`);
      throw new SmsSendError(reason, res.status);
    }
  }
}
