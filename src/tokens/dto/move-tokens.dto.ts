import { Matches } from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Staff moving the waiting tokens of one queue date to another (e.g. after an event's dates change). */
export class MoveTokensDto {
  @Matches(DATE_KEY, { message: 'from must look like 2026-10-24' })
  from!: string;

  @Matches(DATE_KEY, { message: 'to must look like 2026-10-24' })
  to!: string;
}
