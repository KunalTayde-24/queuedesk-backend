import { addDaysToKey, dayKeyOf } from '../common/dates';

// An event opens at most this many queue days (guards against a typo'd end date).
const MAX_EVENT_DAYS = 14;

/**
 * The Singapore calendar days an event covers, as "YYYY-MM-DD" keys: from the
 * day it starts to the day it ends (an event ending exactly at midnight does
 * not claim the next day). Days before `notBefore` are left out.
 */
export function eventDayKeys(
  event: { startsAt: Date; endsAt: Date },
  notBefore?: string,
): string[] {
  const first = dayKeyOf(event.startsAt);
  const last = dayKeyOf(new Date(event.endsAt.getTime() - 1));
  const keys: string[] = [];
  for (
    let key = first;
    key <= last && keys.length < MAX_EVENT_DAYS;
    key = addDaysToKey(key, 1)
  ) {
    if (!notBefore || key >= notBefore) keys.push(key);
  }
  return keys;
}
