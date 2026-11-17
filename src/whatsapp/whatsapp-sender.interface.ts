export interface WhatsAppSender {
  sendTokenCalledMessage(
    mobile: string,
    tokenNumber: number,
    name: string,
    /** The event whose queue the token is in (empty for old tokens without one). */
    eventTitle?: string,
  ): Promise<void>;
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}
