import { Injectable } from '@nestjs/common';
import { Prisma, Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { startOfToday } from './today.util';

const MAX_RETRIES = 5;

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async createToken(dto: CreateTokenDto): Promise<Token> {
    const today = startOfToday();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Uses Prisma's own aggregate (not a raw query) so "today" is
            // serialized identically to how `create` below writes it to the
            // @db.Date column — a raw $queryRaw parameter for a JS Date does
            // not reliably match rows written via the ORM's Date mapping.
            const result = await tx.token.aggregate({
              where: { date: today },
              _max: { tokenNumber: true },
            });
            const next = (result._max.tokenNumber ?? 0) + 1;

            return tx.token.create({
              data: {
                date: today,
                tokenNumber: next,
                name: dto.name,
                mobile: dto.mobile,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        const isRetryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2002' || err.code === 'P2034');

        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    // Unreachable: the loop above always returns or throws.
    throw new Error('Failed to allocate a token number');
  }

  async findToday(): Promise<Token[]> {
    const today = startOfToday();

    return this.prisma.token.findMany({
      where: { date: today },
      orderBy: { tokenNumber: 'desc' },
    });
  }
}
