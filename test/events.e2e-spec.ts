import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { EventStatus, Prisma, RegistrationStatus } from '@prisma/client';
import { AdminGuard } from '../src/auth/admin.guard';
import { EventsAdminController } from '../src/events/events-admin.controller';
import { processEventImage } from '../src/events/events.image';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';
import { PrismaService } from '../src/prisma/prisma.service';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Diwali Celebration',
    description: 'Lights, music, and sweets for the whole neighbourhood.',
    venue: 'Main Hall',
    imageMime: null,
    registrationOpensAt: new Date('2026-10-01T00:00:00.000Z'),
    registrationClosesAt: new Date('2026-10-10T12:00:00.000Z'),
    startsAt: new Date('2026-10-10T12:00:00.000Z'),
    endsAt: new Date('2026-10-10T16:00:00.000Z'),
    status: EventStatus.PUBLISHED,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    _count: { registrations: 0 },
    ...overrides,
  };
}

// Dates are relative to "now": new events cannot be scheduled in the past.
const inDays = (days: number, hours = 0) =>
  new Date(Date.now() + (days * 24 + hours) * 3_600_000).toISOString();

const validDto = {
  title: 'Diwali Celebration',
  description: 'Lights, music, and sweets for the whole neighbourhood.',
  venue: 'Main Hall',
  registrationOpensAt: inDays(1),
  registrationClosesAt: inDays(5),
  startsAt: inDays(6),
  endsAt: inDays(6, 4),
};

describe('EventsService', () => {
  let service: EventsService;

  const prismaMock: any = {
    event: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    eventRegistration: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(EventsService);
  });

  it('asks the database only for published events on the public list', async () => {
    prismaMock.event.findMany.mockResolvedValue([eventRow()]);

    const result = await service.listPublic(
      new Date('2026-10-05T00:00:00.000Z'),
    );

    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: EventStatus.PUBLISHED } }),
    );
    expect(result[0].registrationState).toBe('OPEN');
    expect(result[0].canRegister).toBe(true);
    expect(result[0]).not.toHaveProperty('imageData');
  });

  it('keeps drafts off the public detail route', async () => {
    prismaMock.event.findUnique.mockResolvedValue(
      eventRow({ status: EventStatus.DRAFT }),
    );

    await expect(
      service.findPublic('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still lets an admin see a draft', async () => {
    prismaMock.event.findMany.mockResolvedValue([
      eventRow({ status: EventStatus.DRAFT }),
    ]);

    const result = await service.listAdmin(
      new Date('2026-10-05T00:00:00.000Z'),
    );

    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: { status: EventStatus.PUBLISHED } }),
    );
    expect(result[0].status).toBe(EventStatus.DRAFT);
    expect(result[0].canRegister).toBe(false);
  });

  it('rejects a registration window that closes before it opens', async () => {
    await expect(
      service.create('admin-1', {
        ...validDto,
        registrationClosesAt: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it('rejects registration that stays open after the event starts', async () => {
    await expect(
      service.create('admin-1', {
        ...validDto,
        registrationClosesAt: inDays(7),
        startsAt: inDays(6),
      }),
    ).rejects.toThrow('Registration must close at or before the event starts');
  });

  it('rejects an event that ends before it starts', async () => {
    await expect(
      service.create('admin-1', {
        ...validDto,
        endsAt: '2026-10-10T12:00:00.000Z',
      }),
    ).rejects.toThrow('Event end must be after the event starts');
  });

  it('rejects an event scheduled in the past', async () => {
    await expect(
      service.create('admin-1', {
        ...validDto,
        registrationOpensAt: inDays(-10),
        registrationClosesAt: inDays(-5),
        startsAt: inDays(-4),
        endsAt: inDays(-4, 4),
      }),
    ).rejects.toThrow('Registration cannot close in the past');
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date instead of rolling it into the next month', async () => {
    await expect(
      service.create('admin-1', { ...validDto, startsAt: '2027-02-31T10:00' }),
    ).rejects.toThrow('Event start is not a valid date');
  });

  it('rejects a date that is more than 3 years away (a typo in the year)', async () => {
    await expect(
      service.create('admin-1', { ...validDto, endsAt: '2099-01-01T00:00:00.000Z' }),
    ).rejects.toThrow('more than 3 years away');
  });

  it('lets an admin edit an old event without touching its dates', async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce(eventRow());
    prismaMock.event.update.mockResolvedValueOnce(eventRow({ title: 'New title' }));
    await expect(
      service.update('11111111-1111-4111-8111-111111111111', { title: 'New title' }),
    ).resolves.toBeDefined();
  });

  it('does not let an edit move a date into the past', async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce(eventRow());
    await expect(
      service.update('11111111-1111-4111-8111-111111111111', { endsAt: inDays(-1) }),
    ).rejects.toThrow('The event cannot end in the past');
  });

  it('publishes a draft and refuses to publish a cancelled event', async () => {
    prismaMock.event.findUnique.mockResolvedValueOnce(
      eventRow({ status: EventStatus.DRAFT }),
    );
    prismaMock.event.update.mockResolvedValueOnce(
      eventRow({ status: EventStatus.PUBLISHED }),
    );

    const published = await service.publish(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(published.status).toBe(EventStatus.PUBLISHED);

    prismaMock.event.findUnique.mockResolvedValueOnce(
      eventRow({ status: EventStatus.CANCELLED }),
    );
    await expect(
      service.publish('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('registers a guest while the window is open', async () => {
    prismaMock.event.findUnique.mockResolvedValue(eventRow());
    prismaMock.eventRegistration.create.mockResolvedValue({
      id: 'reg-1',
      confirmationRef: 'QD-TEST12',
      eventId: '11111111-1111-4111-8111-111111111111',
      name: 'Asha Patil',
      email: 'asha@example.com',
      registeredAt: new Date('2026-10-05T00:00:00.000Z'),
    });

    const result = await service.register(
      '11111111-1111-4111-8111-111111111111',
      { name: 'Asha Patil', mobile: '9876543210', email: 'asha@example.com' },
      new Date('2026-10-05T00:00:00.000Z'),
    );

    expect(result.confirmationRef).toBe('QD-TEST12');
  });

  it('rejects registration before the window opens and after it closes', async () => {
    prismaMock.event.findUnique.mockResolvedValue(eventRow());

    await expect(
      service.register(
        '11111111-1111-4111-8111-111111111111',
        { name: 'Asha Patil', mobile: '9876543210', email: 'asha@example.com' },
        new Date('2026-09-01T00:00:00.000Z'),
      ),
    ).rejects.toThrow('Registration has not opened yet');

    await expect(
      service.register(
        '11111111-1111-4111-8111-111111111111',
        { name: 'Asha Patil', mobile: '9876543210', email: 'asha@example.com' },
        new Date('2026-10-11T00:00:00.000Z'),
      ),
    ).rejects.toThrow('Registration is closed for this event');
  });

  it('hides registration for cancelled and unpublished events', async () => {
    prismaMock.event.findUnique.mockResolvedValue(
      eventRow({ status: EventStatus.CANCELLED }),
    );

    await expect(
      service.register(
        '11111111-1111-4111-8111-111111111111',
        { name: 'Asha Patil', mobile: '9876543210', email: 'asha@example.com' },
        new Date('2026-10-05T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('turns a duplicate mobile number into a conflict', async () => {
    prismaMock.event.findUnique.mockResolvedValue(eventRow());
    prismaMock.eventRegistration.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.0',
        meta: { target: ['eventId', 'mobile'] },
      }),
    );

    await expect(
      service.register(
        '11111111-1111-4111-8111-111111111111',
        { name: 'Asha Patil', mobile: '9876543210', email: 'asha@example.com' },
        new Date('2026-10-05T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete an event that already has registrations', async () => {
    prismaMock.event.findUnique.mockResolvedValue(
      eventRow({ _count: { registrations: 2 } }),
    );

    await expect(
      service.remove('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('Cancel it instead');
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
  });

  it('stores a compressed webp banner and rejects oversized or unreadable files', async () => {
    prismaMock.event.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        eventRow({ imageMime: data.imageMime, status: EventStatus.DRAFT }),
    );

    const created = await service.create('admin-1', validDto, {
      buffer: ONE_PIXEL_PNG,
      mimetype: 'image/png',
      size: ONE_PIXEL_PNG.length,
      originalname: 'diwali.png',
    });
    expect(created.hasImage).toBe(true);
    expect(created.imageUrl).toBe(
      '/events/11111111-1111-4111-8111-111111111111/image',
    );
    expect(prismaMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageMime: 'image/webp' }),
      }),
    );

    await expect(
      processEventImage({
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        mimetype: 'image/jpeg',
        size: 2 * 1024 * 1024 + 1,
        originalname: 'huge.jpg',
      }),
    ).rejects.toThrow('2 MB or smaller');

    await expect(
      processEventImage({
        buffer: Buffer.from('not-an-image'),
        mimetype: 'image/jpeg',
        size: 12,
        originalname: 'notes.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not serve a draft banner on the public image route', async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      status: EventStatus.DRAFT,
      imageData: Buffer.from('abc'),
      imageMime: 'image/webp',
    });

    await expect(
      service.getPublicImage('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists registrants for an admin without exposing image bytes', async () => {
    prismaMock.event.findUnique.mockResolvedValue(eventRow());
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        name: 'Asha Patil',
        mobile: '9876543210',
        email: 'asha@example.com',
        status: RegistrationStatus.REGISTERED,
        confirmationRef: 'QD-TEST12',
        registeredAt: new Date('2026-10-05T00:00:00.000Z'),
      },
    ]);

    const rows = await service.listRegistrations(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        mobile: '9876543210',
        confirmationRef: 'QD-TEST12',
      }),
    ]);
  });
});

describe('event authorization', () => {
  it('protects admin event routes and leaves public event routes open', () => {
    const adminGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EventsAdminController,
    );
    const publicGuards = Reflect.getMetadata(GUARDS_METADATA, EventsController);

    expect(adminGuards).toEqual(expect.arrayContaining([AdminGuard]));
    expect(publicGuards ?? []).not.toEqual(
      expect.arrayContaining([AdminGuard]),
    );
  });
});
