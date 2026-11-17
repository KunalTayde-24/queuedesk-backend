import { IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Staff moving the waiting tokens of one event's queue date to another open queue: another date of
 * the same event (e.g. after the event's dates change), or another event's queue (`toEventId`).
 */
export class MoveTokensDto {
  @IsUUID()
  eventId!: string;

  @Matches(DATE_KEY, { message: 'from must look like 2026-10-24' })
  from!: string;

  @Matches(DATE_KEY, { message: 'to must look like 2026-10-24' })
  to!: string;

  @IsOptional()
  @IsUUID()
  toEventId?: string;
}
