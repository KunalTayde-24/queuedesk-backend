import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

/**
 * Which events' queues are open for visitors, and on which dates. One row = one
 * event's queue on one date; every event numbers its own queue.
 */
@Injectable()
export class QueueDaysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Is this event's queue open on that date? */
  async isOpen(eventId: string, key: string): Promise<boolean> {
    const day = await this.prisma.queueDay.findUnique({
      where: { date_eventId: { date: dateFromKey(key), eventId } },
    });
    return day !== null;
  }

  /** What visitors may pick: open queues from today on, one entry per event and date. */
  async listOpenForVisitors() {
    const today = todayKey();
    const days = await this.prisma.queueDay.findMany({
      where: {
        date: { gte: dateFromKey(today) },
        event: { is: { status: EventStatus.PUBLISHED, needsQueue: true } },
      },
      select: {
        date: true,
        event: { select: { id: true, title: true, startsAt: true, endsAt: true } },
      },
      orderBy: [{ date: 'asc' }, { event: { startsAt: 'asc' } }],
    });
    return {
      today,
      queues: days.flatMap((d) =>
        d.event
          ? [
              {
                eventId: d.event.id,
                title: d.event.title,
                date: keyFromDate(d.date),
                startsAt: d.event.startsAt.toISOString(),
                endsAt: d.event.endsAt.toISOString(),
              },
            ]
          : [],
      ),
    };
  }

  /** Every open queue plus any recent queue that has tokens, with token counts. */
  async listForAdmin() {
    const today = todayKey();
    const from = dateFromKey(addDaysToKey(today, -ADMIN_LOOKBACK_DAYS));

    const [open, counts] = await Promise.all([
      this.prisma.queueDay.findMany({
        where: { date: { gte: from } },
        select: { date: true, eventId: true },
      }),
      this.prisma.token.groupBy({
        by: ['date', 'eventId'],
        where: { date: { gte: from } },
        _count: { _all: true },
      }),
    ]);

    const eventIds = [
      ...new Set([...open.map((d) => d.eventId), ...counts.map((c) => c.eventId)]),
    ].filter((id): id is string => id !== null);
    const titles = new Map(
      (
        await this.prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true },
        })
      ).map((e) => [e.id, e.title]),
    );

    type Entry = {
      date: string;
      eventId: string | null;
      eventTitle: string | null;
      open: boolean;
      tokenCount: number;
    };
    const entryKey = (date: string, eventId: string | null) => `${date}|${eventId ?? ''}`;
    const byKey = new Map<string, Entry>();
    const entryFor = (date: string, eventId: string | null): Entry => {
      const key = entryKey(date, eventId);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          date,
          eventId,
          eventTitle: eventId ? (titles.get(eventId) ?? null) : null,
          open: false,
          tokenCount: 0,
        };
        byKey.set(key, entry);
      }
      return entry;
    };

    for (const d of open) entryFor(keyFromDate(d.date), d.eventId).open = true;
    for (const c of counts) {
      entryFor(keyFromDate(c.date), c.eventId).tokenCount = c._count._all;
    }

    return {
      today,
      days: [...byKey.values()].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.eventTitle ?? '').localeCompare(b.eventTitle ?? ''),
      ),
    };
  }

  /** Opens an event's queue on one of the event's own dates. */
  async open(eventId: string, key: string) {
    if (key < todayKey()) {
      throw new BadRequestException('You cannot open a date that has already passed.');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, needsQueue: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.PUBLISHED || !event.needsQueue) {
      throw new BadRequestException(
        'Only a published event that needs a queue can open its queue.',
      );
    }
    if (!eventDayKeys(event).includes(key)) {
      throw new BadRequestException('That date is not one of this event’s days.');
    }
    const date = dateFromKey(key);
    await this.prisma.queueDay.upsert({
      where: { date_eventId: { date, eventId } },
      update: {},
      create: { date, eventId },
    });
    return { date: key, eventId, open: true };
  }

  async close(eventId: string, key: string) {
    // Tokens already issued for the date are kept; closing only stops new ones.
    await this.prisma.queueDay.deleteMany({
      where: { date: dateFromKey(key), eventId },
    });
    return { date: key, eventId, open: false };
  }
}
