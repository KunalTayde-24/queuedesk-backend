import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToKey,
  dateFromKey,
  keyFromDate,
  todayKey,
} from '../common/dates';

// How far back the admin calendar looks for days that still have tokens.
const ADMIN_LOOKBACK_DAYS = 60;

/** Which dates the admin has opened for visitors to take tokens. */
@Injectable()
export class QueueDaysService {
  constructor(private readonly prisma: PrismaService) {}

  async isOpen(key: string): Promise<boolean> {
    const day = await this.prisma.queueDay.findUnique({
      where: { date: dateFromKey(key) },
    });
    return day !== null;
  }

  /** What visitors may pick: today and later dates that are open. */
  async listOpenForVisitors() {
    const today = todayKey();
    const days = await this.prisma.queueDay.findMany({
      where: { date: { gte: dateFromKey(today) } },
      orderBy: { date: 'asc' },
    });
    return { today, dates: days.map((d) => keyFromDate(d.date)) };
  }

  /** Every open date plus any recent date that has tokens, with token counts. */
  async listForAdmin() {
    const today = todayKey();
    const from = dateFromKey(addDaysToKey(today, -ADMIN_LOOKBACK_DAYS));

    const [open, counts] = await Promise.all([
      this.prisma.queueDay.findMany({ where: { date: { gte: from } } }),
      this.prisma.token.groupBy({
        by: ['date'],
        where: { date: { gte: from } },
        _count: { _all: true },
      }),
    ]);

    const byKey = new Map<string, { date: string; open: boolean; tokenCount: number }>();
    for (const d of open) {
      byKey.set(keyFromDate(d.date), { date: keyFromDate(d.date), open: true, tokenCount: 0 });
    }
    for (const c of counts) {
      const key = keyFromDate(c.date);
      const entry = byKey.get(key) ?? { date: key, open: false, tokenCount: 0 };
      entry.tokenCount = c._count._all;
      byKey.set(key, entry);
    }

    return {
      today,
      days: [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async open(key: string) {
    if (key < todayKey()) {
      throw new BadRequestException('You cannot open a date that has already passed.');
    }
    const date = dateFromKey(key);
    await this.prisma.queueDay.upsert({ where: { date }, update: {}, create: { date } });
    return { date: key, open: true };
  }

  async close(key: string) {
    // Tokens already issued for the date are kept; closing only stops new ones.
    await this.prisma.queueDay.deleteMany({ where: { date: dateFromKey(key) } });
    return { date: key, open: false };
  }
}
