export interface WhatsAppSender {
  sendTokenCalledMessage(mobile: string, tokenNumber: number): Promise<void>;
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
