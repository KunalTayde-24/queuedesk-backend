import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Token, TokenStatus } from '@prisma/client';
import { TokenWithEvent, withEvent } from '../tokens/tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_SENDER } from '../whatsapp/whatsapp.constants';
import { WhatsAppSender } from '../whatsapp/whatsapp-sender.interface';

export interface QueueActionResult {
  success: true;
  token: TokenWithEvent;
  warning?: string;
}

@Injectable()
export class QueueActionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_SENDER) private readonly whatsapp: WhatsAppSender,
  ) {}

  private async findOrThrow(id: string): Promise<TokenWithEvent> {
    const token = await this.prisma.token.findUnique({ where: { id }, include: withEvent });
    if (!token) {
      throw new NotFoundException('Token not found');
    }
    return token;
  }

  private async notify(token: TokenWithEvent): Promise<string | undefined> {
    try {
      await this.whatsapp.sendTokenCalledMessage(
        token.mobile,
        token.tokenNumber,
        token.name,
        token.event?.title ?? '',
      );
      return undefined;
    } catch (err) {
      return `Failed to send WhatsApp notification: ${
        err instanceof Error ? err.message : 'unknown error'
      }`;
    }
  }

  async call(id: string): Promise<QueueActionResult> {
    await this.findOrThrow(id);

    // Calling a token never changes anyone else's status: several tokens can be
    // CALLED at once, and the most recently called one is "now serving".
    const token = await this.prisma.token.update({
      where: { id },
      data: { status: TokenStatus.CALLED, calledAt: new Date() },
      include: withEvent,
    });

    const warning = await this.notify(token);
    return { success: true, token, ...(warning ? { warning } : {}) };
  }

  async recall(id: string): Promise<QueueActionResult> {
    const token = await this.findOrThrow(id);

    if (token.status !== TokenStatus.CALLED) {
      throw new BadRequestException('Token is not currently called');
    }

    const recalled = await this.prisma.token.update({
      where: { id },
      data: { calledAt: new Date() },
      include: withEvent,
    });
    const warning = await this.notify(recalled);
    return { success: true, token: recalled, ...(warning ? { warning } : {}) };
  }

  async skip(id: string): Promise<QueueActionResult> {
    await this.findOrThrow(id);
    const token = await this.prisma.token.update({
      where: { id },
      data: { status: TokenStatus.WAITING, calledAt: null },
    });
    return { success: true, token };
  }

  async done(id: string): Promise<QueueActionResult> {
    await this.findOrThrow(id);
    const token = await this.prisma.token.update({
      where: { id },
      data: { status: TokenStatus.DONE },
    });
    return { success: true, token };
  }

  async remove(id: string): Promise<{ success: true }> {
    try {
      await this.prisma.token.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException('Token not found');
      }
      throw err;
    }
  }
}
