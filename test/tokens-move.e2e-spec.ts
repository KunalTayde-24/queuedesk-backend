import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TokenStatus } from '@prisma/client';
import { addDaysToKey, todayKey } from '../src/common/dates';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueDaysService } from '../src/tokens/queue-days.service';
import { TokensService } from '../src/tokens/tokens.service';

/** Moving waiting tokens to another date (mocked Prisma, no database). */
describe('TokensService.moveWaiting', () => {
  let service: TokensService;
  const FROM = addDaysToKey(todayKey(), 3);
  const TO = addDaysToKey(todayKey(), 5);

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

    const result = await service.moveWaiting(FROM, TO);

    expect(result).toEqual({ moved: 2, skipped: 0 });
    expect(prismaMock.token.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'a' },
      data: { date: new Date(`${TO}T00:00:00.000Z`), tokenNumber: 8 },
    });
    expect(prismaMock.token.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b' },
      data: { date: new Date(`${TO}T00:00:00.000Z`), tokenNumber: 9 },
    });
  });

  it('skips someone who already holds a live token on the new date', async () => {
    prismaMock.token.findMany
      .mockResolvedValueOnce([waiting('a', 1, '+65911'), waiting('b', 2, '+65922')])
      .mockResolvedValueOnce([{ mobile: '+65911' }]);
    prismaMock.token.aggregate.mockResolvedValue({ _max: { tokenNumber: null } });

    const result = await service.moveWaiting(FROM, TO);

    expect(result).toEqual({ moved: 1, skipped: 1 });
    expect(prismaMock.token.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.token.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { date: new Date(`${TO}T00:00:00.000Z`), tokenNumber: 1 },
    });
  });

  it('does nothing when nobody is waiting', async () => {
    prismaMock.token.findMany.mockResolvedValueOnce([]);
    await expect(service.moveWaiting(FROM, TO)).resolves.toEqual({ moved: 0, skipped: 0 });
    expect(prismaMock.token.update).not.toHaveBeenCalled();
  });

  it('refuses the same date, a past date and a date that is not open', async () => {
    await expect(service.moveWaiting(FROM, FROM)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.moveWaiting(FROM, addDaysToKey(todayKey(), -1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    queueDaysMock.isOpen.mockResolvedValueOnce(false);
    await expect(service.moveWaiting(FROM, TO)).rejects.toThrow('not open');
    expect(prismaMock.token.update).not.toHaveBeenCalled();
  });
});

describe('TokensService.findPublic', () => {
  it('returns a token without its phone number, or 404s', async () => {
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
      tokenNumber: 3,
      name: 'Tan Wei Ming',
      mobile: '+6591234567',
      status: TokenStatus.WAITING,
      createdAt: new Date(),
    });
    const view = await service.findPublic('t1');
    expect(view).toMatchObject({ date: '2026-11-05', tokenNumber: 3, mobile: '' });

    prisma.token.findUnique.mockResolvedValueOnce(null);
    await expect(service.findPublic('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
