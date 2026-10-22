import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateRegistrationDto } from './dto/create-registration.dto';
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

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_REF_ATTEMPTS = 5;

export interface RegistrationDto {
  id: string;
  confirmationRef: string;
  eventId: string;
  name: string;
  email: string;
  registeredAt: string;
}

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
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(now = new Date()): Promise<EventDto[]> {
    const events = await this.prisma.event.findMany({
      where: { status: EventStatus.PUBLISHED },
      select: eventSelect,
      orderBy: { startsAt: 'asc' },
    });
    return events.map((event) => toEventDto(event, now));
  }

  async listAdmin(now = new Date()): Promise<EventDto[]> {
    const events = await this.prisma.event.findMany({
      select: eventSelect,
      orderBy: { updatedAt: 'desc' },
    });
    return events.map((event) => toEventDto(event, now));
  }

  async findPublic(id: string, now = new Date()): Promise<EventDto> {
    const event = await this.findRecord(id);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException('Event not found');
    }
    return toEventDto(event, now);
  }

  async findAdmin(id: string, now = new Date()): Promise<EventDto> {
    return toEventDto(await this.findRecord(id), now);
  }

  async create(
    adminId: string,
    dto: CreateEventDto,
    file?: UploadedImage,
  ): Promise<EventDto> {
    const windows = parseWindows(dto);
    assertDatesSensible(windows, ALL_WINDOW_FIELDS);
    const image = file ? await processEventImage(file) : null;
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        venue: dto.venue,
        ...windows,
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
      registrationOpensAt:
        dto.registrationOpensAt ?? current.registrationOpensAt.toISOString(),
      registrationClosesAt:
        dto.registrationClosesAt ?? current.registrationClosesAt.toISOString(),
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
    return toEventDto(event);
  }

  async publish(id: string): Promise<EventDto> {
    const current = await this.findRecord(id);
    if (current.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Cancelled events cannot be published');
    }
    parseWindows({
      registrationOpensAt: current.registrationOpensAt.toISOString(),
      registrationClosesAt: current.registrationClosesAt.toISOString(),
      startsAt: current.startsAt.toISOString(),
      endsAt: current.endsAt.toISOString(),
    });
    const event = await this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.PUBLISHED },
      select: eventSelect,
    });
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
    return toEventDto(event);
  }

  async cancel(id: string): Promise<EventDto> {
    await this.findRecord(id);
    const event = await this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.CANCELLED },
      select: eventSelect,
    });
    return toEventDto(event);
  }

  async remove(id: string): Promise<{ success: true }> {
    const current = await this.findRecord(id);
    if (current._count.registrations > 0) {
      throw new BadRequestException(
        'This event already has registrations. Cancel it instead so those records stay available.',
      );
    }
    await this.prisma.event.delete({ where: { id } });
    return { success: true };
  }

  async register(
    eventId: string,
    dto: CreateRegistrationDto,
    now = new Date(),
  ): Promise<RegistrationDto> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: eventSelect,
    });
    if (!event || event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException('Event not found');
    }

    const view = toEventDto(event, now);
    if (!view.canRegister) {
      if (view.registrationState === 'OPENS_SOON') {
        throw new BadRequestException('Registration has not opened yet');
      }
      throw new BadRequestException('Registration is closed for this event');
    }

    for (let attempt = 0; attempt < MAX_REF_ATTEMPTS; attempt++) {
      try {
        const created = await this.prisma.eventRegistration.create({
          data: {
            eventId,
            name: dto.name,
            mobile: dto.mobile,
            email: dto.email,
            confirmationRef: makeConfirmationRef(),
          },
        });
        return {
          id: created.id,
          confirmationRef: created.confirmationRef,
          eventId: created.eventId,
          name: created.name,
          email: created.email,
          registeredAt: created.registeredAt.toISOString(),
        };
      } catch (err) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== 'P2002'
        ) {
          throw err;
        }
        const target = constraintName(err);
        if (target.includes('mobile') || target.includes('eventId')) {
          throw new ConflictException(
            'This mobile number is already registered for this event',
          );
        }
        if (attempt === MAX_REF_ATTEMPTS - 1) {
          throw new ConflictException(
            'Could not finish registration. Please try again.',
          );
        }
      }
    }

    throw new ConflictException(
      'Could not finish registration. Please try again.',
    );
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

function makeConfirmationRef(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) {
    code += REF_ALPHABET[byte % REF_ALPHABET.length];
  }
  return `QD-${code}`;
}

function constraintName(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.join(',');
  }
  return typeof target === 'string' ? target : '';
}
