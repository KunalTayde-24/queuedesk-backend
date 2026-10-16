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
    date = new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
      ) - IST_OFFSET_MS,
    );
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
