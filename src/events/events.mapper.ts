import { EventStatus, Prisma } from '@prisma/client';
import { deriveRegistration, RegistrationState } from './events.windows';

export const eventSelect = {
  id: true,
  title: true,
  description: true,
  venue: true,
  imageMime: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  startsAt: true,
  endsAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { registrations: true } },
} satisfies Prisma.EventSelect;

export type EventRecord = Prisma.EventGetPayload<{
  select: typeof eventSelect;
}>;

export interface EventDto {
  id: string;
  title: string;
  description: string;
  venue: string;
  hasImage: boolean;
  imageUrl: string | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  registrationState: RegistrationState;
  canRegister: boolean;
  registrationCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toEventDto(event: EventRecord, now = new Date()): EventDto {
  const derived = deriveRegistration(event, now);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    hasImage: Boolean(event.imageMime),
    imageUrl: event.imageMime ? `/events/${event.id}/image` : null,
    registrationOpensAt: event.registrationOpensAt.toISOString(),
    registrationClosesAt: event.registrationClosesAt.toISOString(),
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    status: event.status,
    registrationState: derived.registrationState,
    canRegister: derived.canRegister,
    registrationCount: event._count.registrations,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
