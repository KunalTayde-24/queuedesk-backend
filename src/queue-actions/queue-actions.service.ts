import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Token, TokenStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_SENDER } from '../whatsapp/whatsapp.constants';
import { WhatsAppSender } from '../whatsapp/whatsapp-sender.interface';

export interface QueueActionResult {
  success: true;
  token: Token;
  warning?: string;
}

@Injectable()
export class QueueActionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_SENDER) private readonly whatsapp: WhatsAppSender,
  ) {}

  private async findOrThrow(id: string): Promise<Token> {
    const token = await this.prisma.token.findUnique({ where: { id } });
    if (!token) {
      throw new NotFoundException('Token not found');
    }
    return token;
  }

  private async notify(token: Token): Promise<string | undefined> {
    try {
      await this.whatsapp.sendTokenCalledMessage(
        token.mobile,
        token.tokenNumber,
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

    const token = await this.prisma.$transaction(async (tx) => {
      const target = await tx.token.findUniqueOrThrow({ where: { id } });

      await tx.token.updateMany({
        where: {
          date: target.date,
          status: TokenStatus.CALLED,
          NOT: { id: target.id },
        },
        data: { status: TokenStatus.WAITING },
      });

      return tx.token.update({
        where: { id },
        data: { status: TokenStatus.CALLED },
      });
    });

    const warning = await this.notify(token);
    return { success: true, token, ...(warning ? { warning } : {}) };
  }

  async recall(id: string): Promise<QueueActionResult> {
    const token = await this.findOrThrow(id);

    if (token.status !== TokenStatus.CALLED) {
      throw new BadRequestException('Token is not currently called');
    }

    const warning = await this.notify(token);
    return { success: true, token, ...(warning ? { warning } : {}) };
  }

  async skip(id: string): Promise<QueueActionResult> {
    await this.findOrThrow(id);
    const token = await this.prisma.token.update({
      where: { id },
      data: { status: TokenStatus.WAITING },
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
