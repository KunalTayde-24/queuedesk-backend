import { BadRequestException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';

export const APP_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export type RegistrationState = 'OPENS_SOON' | 'OPEN' | 'CLOSED';

export interface EventWindowsInput {
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
}

export interface EventWindows {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
}

export function parseEventInstant(
  value: string | undefined,
  label: string,
): Date {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new BadRequestException(`${label} is required`);
  }

  const hasOffset = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  let date: Date;

  if (hasOffset) {
    date = new Date(trimmed);
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(trimmed);
    if (!match) {
      throw new BadRequestException(`${label} is not a valid date`);
    }
    const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    // Reject impossible dates such as 31 Feb, which Date.UTC would quietly roll into March.
    const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day ||
      probe.getUTCHours() !== hour ||
      probe.getUTCMinutes() !== minute
    ) {
      throw new BadRequestException(`${label} is not a valid date`);
    }
    date = new Date(probe.getTime() - IST_OFFSET_MS);
  }

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} is not a valid date`);
  }

  return date;
}

export function parseWindows(input: EventWindowsInput): EventWindows {
  const windows: EventWindows = {
    registrationOpensAt: parseEventInstant(
      input.registrationOpensAt,
      'Registration open',
    ),
    registrationClosesAt: parseEventInstant(
      input.registrationClosesAt,
      'Registration close',
    ),
    startsAt: parseEventInstant(input.startsAt, 'Event start'),
    endsAt: parseEventInstant(input.endsAt, 'Event end'),
  };
  assertWindowOrder(windows);
  return windows;
}

const MAX_YEARS_AHEAD = 3;

const FIELD_LABEL: Record<keyof EventWindows, string> = {
  registrationOpensAt: 'Registration open',
  registrationClosesAt: 'Registration close',
  startsAt: 'Event start',
  endsAt: 'Event end',
};

const PAST_MESSAGE: Partial<Record<keyof EventWindows, string>> = {
  registrationClosesAt: 'Registration cannot close in the past',
  startsAt: 'The event cannot start in the past',
  endsAt: 'The event cannot end in the past',
};

export const ALL_WINDOW_FIELDS: (keyof EventWindows)[] = [
  'registrationOpensAt',
  'registrationClosesAt',
  'startsAt',
  'endsAt',
];

/**
 * Checks only the dates that are new or were changed (so an old event can
 * still have its description edited): registration close, event start and
 * event end cannot be in the past, and no date may be more than 3 years away
 * (almost always a typo in the year). Registration may open in the past,
 * which just means "open now". Compared to the minute, so choosing the
 * current minute is fine.
 */
export function assertDatesSensible(
  windows: EventWindows,
  fields: (keyof EventWindows)[],
  now: Date = new Date(),
): void {
  const nowMinute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() + MAX_YEARS_AHEAD);

  for (const field of fields) {
    const value = windows[field];
    const pastMessage = PAST_MESSAGE[field];
    if (pastMessage && value < nowMinute) {
      throw new BadRequestException(pastMessage);
    }
    if (value > limit) {
      throw new BadRequestException(
        `${FIELD_LABEL[field]} is more than ${MAX_YEARS_AHEAD} years away. Please check the year.`,
      );
    }
  }
}

export function assertWindowOrder(windows: EventWindows): void {
  if (!(windows.registrationOpensAt < windows.registrationClosesAt)) {
    throw new BadRequestException(
      'Registration close must be after registration open',
    );
  }
  if (windows.registrationClosesAt > windows.startsAt) {
    throw new BadRequestException(
      'Registration must close at or before the event starts',
    );
  }
  if (!(windows.startsAt < windows.endsAt)) {
    throw new BadRequestException('Event end must be after the event starts');
  }
}

export function deriveRegistration(
  event: {
    status: EventStatus;
    registrationOpensAt: Date;
    registrationClosesAt: Date;
  },
  now: Date,
): { registrationState: RegistrationState; canRegister: boolean } {
  if (event.status === EventStatus.CANCELLED) {
    return { registrationState: 'CLOSED', canRegister: false };
  }

  let registrationState: RegistrationState = 'CLOSED';
  if (now < event.registrationOpensAt) {
    registrationState = 'OPENS_SOON';
  } else if (now <= event.registrationClosesAt) {
    registrationState = 'OPEN';
  }

  return {
    registrationState,
    canRegister:
      event.status === EventStatus.PUBLISHED && registrationState === 'OPEN',
  };
}
