import { BadRequestException, Injectable } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { eventDayKeys } from '../events/events.days';
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

  /** Published events by the day they cover, from `fromKey` on (so dates can show their event). */
  private async eventsByDay(fromKey: string) {
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatus.PUBLISHED,
        endsAt: { gte: dateFromKey(addDaysToKey(fromKey, -1)) },
      },
      select: { id: true, title: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
    const byDay = new Map<string, { id: string; title: string }[]>();
    for (const event of events) {
      for (const key of eventDayKeys(event, fromKey)) {
        const list = byDay.get(key) ?? [];
        list.push({ id: event.id, title: event.title });
        byDay.set(key, list);
      }
    }
    return byDay;
  }

  /** What visitors may pick: today and later dates that are open. */
  async listOpenForVisitors() {
    const today = todayKey();
    const [days, byDay] = await Promise.all([
      this.prisma.queueDay.findMany({
        where: { date: { gte: dateFromKey(today) } },
        orderBy: { date: 'asc' },
      }),
      this.eventsByDay(today),
    ]);
    const dates = days.map((d) => keyFromDate(d.date));
    return {
      today,
      dates,
      events: dates.flatMap((date) =>
        (byDay.get(date) ?? []).map((e) => ({ date, id: e.id, title: e.title })),
      ),
    };
  }

  /** Every open date plus any recent date that has tokens, with token counts. */
  async listForAdmin() {
    const today = todayKey();
    const from = dateFromKey(addDaysToKey(today, -ADMIN_LOOKBACK_DAYS));

    const [open, counts, byDay] = await Promise.all([
      this.prisma.queueDay.findMany({ where: { date: { gte: from } } }),
      this.prisma.token.groupBy({
        by: ['date'],
        where: { date: { gte: from } },
        _count: { _all: true },
      }),
      this.eventsByDay(addDaysToKey(today, -ADMIN_LOOKBACK_DAYS)),
    ]);

    const byKey = new Map<
      string,
      {
        date: string;
        open: boolean;
        tokenCount: number;
        events: { id: string; title: string }[];
      }
    >();
    for (const d of open) {
      byKey.set(keyFromDate(d.date), {
        date: keyFromDate(d.date),
        open: true,
        tokenCount: 0,
        events: byDay.get(keyFromDate(d.date)) ?? [],
      });
    }
    for (const c of counts) {
      const key = keyFromDate(c.date);
      const entry = byKey.get(key) ?? {
        date: key,
        open: false,
        tokenCount: 0,
        events: byDay.get(key) ?? [],
      };
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
