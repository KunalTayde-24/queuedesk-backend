import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventStatus, TokenStatus } from '@prisma/client';
import { addDaysToKey, todayKey } from '../src/common/dates';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueDaysService } from '../src/tokens/queue-days.service';
import { TokensService } from '../src/tokens/tokens.service';

const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';

/** Moving waiting tokens between queues (mocked Prisma, no database). */
describe('TokensService.moveWaiting', () => {
  let service: TokensService;
  const FROM = addDaysToKey(todayKey(), 3);
  const TO = addDaysToKey(todayKey(), 5);
  const toDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

  const prismaMock: any = {
    token: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
    },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  const queueDaysMock = { isOpen: jest.fn() };

  const waiting = (id: string, tokenNumber: number, mobile: string) => ({
    id,
    tokenNumber,
    mobile,
    status: TokenStatus.WAITING,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    queueDaysMock.isOpen.mockResolvedValue(true);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: QueueDaysService, useValue: queueDaysMock },
        { provide: OtpService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(TokensService);
  });

  it('moves waiting tokens in order and numbers them after the existing ones', async () => {
    prismaMock.token.findMany
      .mockResolvedValueOnce([waiting('a', 1, '+65911'), waiting('b', 4, '+65922')])
      .mockResolvedValueOnce([]);
    prismaMock.token.aggregate.mockResolvedValue({ _max: { tokenNumber: 7 } });

    const result = await service.moveWaiting({ eventId: EVENT, from: FROM, to: TO });

    expect(result).toEqual({ moved: 2, skipped: 0 });
    // Only this event's waiting tokens on the source date are taken.
    expect(prismaMock.token.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { eventId: EVENT, date: toDate(FROM), status: TokenStatus.WAITING },
      }),
    );
    expect(prismaMock.token.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'a' },
      data: { eventId: EVENT, date: toDate(TO), tokenNumber: 8 },
    });
    expect(prismaMock.token.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b' },
      data: { eventId: EVENT, date: toDate(TO), tokenNumber: 9 },
    });
  });

  it('can move into another event’s queue and numbers them there', async () => {
    prismaMock.token.findMany
      .mockResolvedValueOnce([waiting('a', 2, '+65911')])
      .mockResolvedValueOnce([]);
    prismaMock.token.aggregate.mockResolvedValue({ _max: { tokenNumber: 3 } });

    await service.moveWaiting({ eventId: EVENT, from: FROM, to: FROM, toEventId: OTHER_EVENT });

    expect(queueDaysMock.isOpen).toHaveBeenCalledWith(OTHER_EVENT, FROM);
    expect(prismaMock.token.aggregate).toHaveBeenCalledWith({
      where: { eventId: OTHER_EVENT, date: toDate(FROM) },
      _max: { tokenNumber: true },
    });
    expect(prismaMock.token.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { eventId: OTHER_EVENT, date: toDate(FROM), tokenNumber: 4 },
    });
  });

  it('skips someone who already holds a live token in the target queue', async () => {
    prismaMock.token.findMany
      .mockResolvedValueOnce([waiting('a', 1, '+65911'), waiting('b', 2, '+65922')])
      .mockResolvedValueOnce([{ mobile: '+65911' }]);
    prismaMock.token.aggregate.mockResolvedValue({ _max: { tokenNumber: null } });

    const result = await service.moveWaiting({ eventId: EVENT, from: FROM, to: TO });

    expect(result).toEqual({ moved: 1, skipped: 1 });
    expect(prismaMock.token.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.token.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { eventId: EVENT, date: toDate(TO), tokenNumber: 1 },
    });
  });

  it('does nothing when nobody is waiting', async () => {
    prismaMock.token.findMany.mockResolvedValueOnce([]);
    await expect(service.moveWaiting({ eventId: EVENT, from: FROM, to: TO })).resolves.toEqual({
      moved: 0,
      skipped: 0,
    });
    expect(prismaMock.token.update).not.toHaveBeenCalled();
  });

  it('refuses the same queue, a past date and a queue that is not open', async () => {
    await expect(service.moveWaiting({ eventId: EVENT, from: FROM, to: FROM })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.moveWaiting({ eventId: EVENT, from: FROM, to: addDaysToKey(todayKey(), -1) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    queueDaysMock.isOpen.mockResolvedValueOnce(false);
    await expect(service.moveWaiting({ eventId: EVENT, from: FROM, to: TO })).rejects.toThrow('not open');
    expect(prismaMock.token.update).not.toHaveBeenCalled();
  });
});

describe('TokensService.findPublic', () => {
  it('returns a token without its name or phone number, or 404s', async () => {
    const prisma: any = { token: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueDaysService, useValue: {} },
        { provide: OtpService, useValue: {} },
      ],
    }).compile();
    const service = moduleRef.get(TokensService);

    prisma.token.findUnique.mockResolvedValueOnce({
      id: 't1',
      date: new Date('2026-11-05T00:00:00.000Z'),
      eventId: EVENT,
      event: { title: 'Diwali celebration' },
      tokenNumber: 3,
      name: 'Tan Wei Ming',
      mobile: '+6591234567',
      status: TokenStatus.WAITING,
      calledAt: null,
      createdAt: new Date(),
    });
    const view = await service.findPublic('t1');
    expect(view).toMatchObject({
      date: '2026-11-05',
      tokenNumber: 3,
      eventId: EVENT,
      eventTitle: 'Diwali celebration',
      name: '',
      mobile: '',
    });

    prisma.token.findUnique.mockResolvedValueOnce(null);
    await expect(service.findPublic('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** Taking tokens: each event has its own queue and numbering (mocked Prisma, no database). */
describe('TokensService token creation (one queue per event)', () => {
  let service: TokensService;
  const DAY = addDaysToKey(todayKey(), 2);
  const visitor = { name: 'Ann', mobile: '+6591234567', eventId: EVENT, date: DAY, verificationToken: 'v' };

  const prismaMock: any = {
    event: { findUnique: jest.fn() },
    token: { findFirst: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  const queueDaysMock = { isOpen: jest.fn() };
  const otpMock = { consume: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.event.findUnique.mockResolvedValue({ status: EventStatus.PUBLISHED, needsQueue: true });
    queueDaysMock.isOpen.mockResolvedValue(true);
    prismaMock.token.findFirst.mockResolvedValue(null);
    prismaMock.token.aggregate.mockResolvedValue({ _max: { tokenNumber: null } });
    prismaMock.token.create.mockImplementation(({ data }: any) => ({
      id: 't',
      ...data,
      status: TokenStatus.WAITING,
      calledAt: null,
      createdAt: new Date(),
      event: { title: 'E' },
    }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: QueueDaysService, useValue: queueDaysMock },
        { provide: OtpService, useValue: otpMock },
      ],
    }).compile();
    service = moduleRef.get(TokensService);
  });

  it('numbers each event’s queue from #1 on its own', async () => {
    const first = await service.createForVisitor(visitor);
    expect(first.tokenNumber).toBe(1);
    expect(prismaMock.token.aggregate).toHaveBeenCalledWith({
      where: { eventId: EVENT, date: new Date(`${DAY}T00:00:00.000Z`) },
      _max: { tokenNumber: true },
    });

    // The other event starts at 1 as well, even though the first queue already has tokens.
    prismaMock.token.aggregate.mockResolvedValueOnce({ _max: { tokenNumber: null } });
    const other = await service.createForVisitor({ ...visitor, eventId: OTHER_EVENT });
    expect(other).toMatchObject({ tokenNumber: 1, eventId: OTHER_EVENT });
  });

  it('lets one number hold a token for each event, but only one per event', async () => {
    await service.createForVisitor(visitor);
    expect(prismaMock.token.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: EVENT,
        date: new Date(`${DAY}T00:00:00.000Z`),
        mobile: '+6591234567',
        status: { not: TokenStatus.DONE },
      },
    });

    prismaMock.token.findFirst.mockResolvedValueOnce({ tokenNumber: 5 });
    await expect(service.createForVisitor(visitor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a queue that is closed, an event that needs no queue, and a past date', async () => {
    queueDaysMock.isOpen.mockResolvedValueOnce(false);
    await expect(service.createForVisitor(visitor)).rejects.toThrow('not open');

    prismaMock.event.findUnique.mockResolvedValueOnce({ status: EventStatus.PUBLISHED, needsQueue: false });
    await expect(service.createForVisitor(visitor)).rejects.toThrow('not taking queue tokens');

    prismaMock.event.findUnique.mockResolvedValueOnce({ status: EventStatus.DRAFT, needsQueue: true });
    await expect(service.createForVisitor(visitor)).rejects.toThrow('not taking queue tokens');

    await expect(
      service.createForVisitor({ ...visitor, date: addDaysToKey(todayKey(), -1) }),
    ).rejects.toThrow('already passed');
    expect(prismaMock.token.create).not.toHaveBeenCalled();
    expect(otpMock.consume).not.toHaveBeenCalled();
  });

  it('walk-ins join the event’s queue, and only when it is open', async () => {
    const token = await service.createWalkIn({ name: 'Ravi', mobile: '+6591234567', eventId: EVENT });
    expect(token).toMatchObject({ eventId: EVENT, tokenNumber: 1, name: 'Ravi' });
    expect(queueDaysMock.isOpen).toHaveBeenCalledWith(EVENT, todayKey());
    expect(otpMock.consume).not.toHaveBeenCalled();

    queueDaysMock.isOpen.mockResolvedValueOnce(false);
    await expect(
      service.createWalkIn({ name: 'Ravi', mobile: '+6591234567', eventId: EVENT }),
    ).rejects.toThrow('not open');
  });
});
