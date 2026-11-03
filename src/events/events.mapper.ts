import { EventStatus, Prisma } from '@prisma/client';

export const eventSelect = {
  id: true,
  title: true,
  description: true,
  venue: true,
  imageMime: true,
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
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
}

export function toEventDto(event: EventRecord): EventDto {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    hasImage: Boolean(event.imageMime),
    imageUrl: event.imageMime ? `/events/${event.id}/image` : null,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    status: event.status,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
