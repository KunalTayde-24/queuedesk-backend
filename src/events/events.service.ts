import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, RegistrationStatus } from '@prisma/client';
import { todayKey } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { QueueDaysService } from '../tokens/queue-days.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  ProcessedImage,
  UploadedImage,
  processEventImage,
} from './events.image';
import {
  EventDto,
  EventRecord,
  eventSelect,
  toEventDto,
} from './events.mapper';
import {
  ALL_WINDOW_FIELDS,
  EventWindows,
  assertDatesSensible,
  parseWindows,
} from './events.windows';
import { eventDayKeys } from './events.days';

export interface RegistrantDto {
  id: string;
  name: string;
  mobile: string;
  email: string;
  status: RegistrationStatus;
  confirmationRef: string;
  registeredAt: string;
}

export interface StoredImage {
  data: Buffer;
  mime: string;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueDays: QueueDaysService,
  ) {}

  async listPublic(): Promise<EventDto[]> {
    const events = await this.prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED },
      select: eventSelect,
      orderBy: { startsAt: 'asc' },
    });
    return events.map((event) => toEventDto(event));
  }

  async listAdmin(): Promise<EventDto[]> {
    const events = await this.prisma.event.findMany({
      select: eventSelect,
      orderBy: { updatedAt: 'desc' },
    });
    return events.map((event) => toEventDto(event));
  }

  async findPublic(id: string): Promise<EventDto> {
    const event = await this.findRecord(id);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException('Event not found');
    }
    return toEventDto(event);
  }

  async findAdmin(id: string): Promise<EventDto> {
    return toEventDto(await this.findRecord(id));
  }

  async create(
    adminId: string,
    dto: CreateEventDto,
    file?: UploadedImage,
  ): Promise<EventDto> {
    const windows = parseWindows(dto);
    assertDatesSensible(windows, ALL_WINDOW_FIELDS);
    const now = new Date();
    const image = file ? await processEventImage(file) : null;
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description ?? '',
        venue: dto.venue ?? '',
        ...windows,
        // Registration is no longer offered; these columns are kept (not null) with harmless values.
        registrationOpensAt: now,
        registrationClosesAt: windows.startsAt,
        createdByAdminId: adminId,
        ...imageData(image),
      },
      select: eventSelect,
    });
    return toEventDto(event);
  }

  async update(
    id: string,
    dto: UpdateEventDto,
    file?: UploadedImage,
  ): Promise<EventDto> {
    const current = await this.findRecord(id);
    const windows = parseWindows({
      startsAt: dto.startsAt ?? current.startsAt.toISOString(),
      endsAt: dto.endsAt ?? current.endsAt.toISOString(),
    });
    // Only dates this edit actually changed are checked against today.
    const changed = ALL_WINDOW_FIELDS.filter(
      (field: keyof EventWindows) =>
        windows[field].getTime() !== current[field].getTime(),
    );
    assertDatesSensible(windows, changed);

    const data: Prisma.EventUpdateInput = {
      title: dto.title,
      description: dto.description,
      venue: dto.venue,
      ...windows,
      registrationClosesAt: windows.startsAt,
    };

    if (file) {
      Object.assign(data, imageData(await processEventImage(file)));
    } else if (dto.removeImage) {
      data.imageData = null;
      data.imageMime = null;
      data.imageName = null;
    }

    const event = await this.prisma.event.update({
      where: { id },
      data,
      select: eventSelect,
    });
    // A published event keeps its queue days in step with its dates.
    if (event.status === EventStatus.PUBLISHED) {
      await this.openDays(event);
      await this.releaseDays(current, event);
    }
    return toEventDto(event);
  }

  async publish(id: string): Promise<EventDto> {
    const current = await this.findRecord(id);
    if (current.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Cancelled events cannot be published');
    }
    parseWindows({
      startsAt: current.startsAt.toISOString(),
      endsAt: current.endsAt.toISOString(),
    });
    const event = await this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.PUBLISHED },
      select: eventSelect,
    });
    // Publishing opens the event's dates in the queue so visitors can pick them.
    await this.openDays(event);
    return toEventDto(event);
  }

  async unpublish(id: string): Promise<EventDto> {
    const current = await this.findRecord(id);
    if (current.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Cancelled events stay cancelled');
    }
    const event = await this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.DRAFT },
      select: eventSelect,
    });
    await this.releaseDays(current);
    return toEventDto(event);
  }

  async cancel(id: string): Promise<EventDto> {
    const current = await this.findRecord(id);
    const event = await this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.CANCELLED },
      select: eventSelect,
    });
    await this.releaseDays(current);
    return toEventDto(event);
  }

  async remove(id: string): Promise<{ success: true }> {
    const current = await this.findRecord(id);
    if (current._count.registrations > 0) {
      throw new BadRequestException(
        'This event already has registrations, so it cannot be deleted. Unpublish it instead so those records stay available.',
      );
    }
    await this.prisma.event.delete({ where: { id } });
    await this.releaseDays(current);
    return { success: true };
  }

  async listRegistrations(eventId: string): Promise<RegistrantDto[]> {
    await this.findRecord(eventId);
    const rows = await this.prisma.eventRegistration.findMany({
      where: { eventId },
      orderBy: { registeredAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      email: row.email,
      status: row.status,
      confirmationRef: row.confirmationRef,
      registeredAt: row.registeredAt.toISOString(),
    }));
  }

  async getPublicImage(id: string): Promise<StoredImage> {
    const image = await this.loadImage(id);
    if (!image || image.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException('Image not found');
    }
    return { data: image.data, mime: image.mime };
  }

  async getAdminImage(id: string): Promise<StoredImage> {
    const image = await this.loadImage(id);
    if (!image) {
      throw new NotFoundException('Image not found');
    }
    return { data: image.data, mime: image.mime };
  }

  /** Opens every upcoming queue day the event covers. */
  private async openDays(event: { startsAt: Date; endsAt: Date }) {
    for (const key of eventDayKeys(event, todayKey())) {
      await this.queueDays.open(key);
    }
  }

  /**
   * Closes the event's upcoming queue days that no other published event still
   * needs. The event's own days after an edit (`after`) stay open. Tokens
   * already issued are never touched (closing only stops new ones).
   */
  private async releaseDays(
    before: { id: string; startsAt: Date; endsAt: Date },
    after?: { startsAt: Date; endsAt: Date },
  ) {
    const today = todayKey();
    const keep = new Set(after ? eventDayKeys(after, today) : []);
    const others = await this.prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED, id: { not: before.id } },
      select: { startsAt: true, endsAt: true },
    });
    for (const other of others) {
      for (const key of eventDayKeys(other, today)) keep.add(key);
    }
    for (const key of eventDayKeys(before, today)) {
      if (!keep.has(key)) await this.queueDays.close(key);
    }
  }

  private async findRecord(id: string): Promise<EventRecord> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: eventSelect,
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async loadImage(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: { status: true, imageData: true, imageMime: true },
    });
    if (!event?.imageData || !event.imageMime) {
      return null;
    }
    return {
      status: event.status,
      data: Buffer.from(event.imageData),
      mime: event.imageMime,
    };
  }
}

function imageData(
  image: ProcessedImage | null,
): Pick<Prisma.EventCreateInput, 'imageData' | 'imageMime' | 'imageName'> {
  if (!image) {
    return {};
  }
  return {
    imageData: image.data,
    imageMime: image.mime,
    imageName: image.name,
  };
}
