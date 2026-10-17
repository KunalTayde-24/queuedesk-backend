import { BadRequestException } from '@nestjs/common';

// The queue runs on Indian time no matter where the server is hosted. Dates
// are passed around as plain "YYYY-MM-DD" keys and stored in @db.Date columns
// as UTC midnight, so the stored day never shifts with the server's timezone.
const QUEUE_TIME_ZONE = 'Asia/Kolkata';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in India, e.g. "2026-10-17". */
export function todayKey(now: Date = new Date()): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: QUEUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !DATE_KEY.test(key)) return false;
  const date = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

/** Parses a date key into the Date Prisma stores for a @db.Date column. */
export function dateFromKey(key: string): Date {
  if (!isValidDateKey(key)) {
    throw new BadRequestException('Date must look like 2026-10-24');
  }
  return new Date(`${key}T00:00:00.000Z`);
}

export function keyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysToKey(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromDate(date);
}
