import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QueueActionsService } from '../src/queue-actions/queue-actions.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WHATSAPP_SENDER } from '../src/whatsapp/whatsapp.constants';
import { StubWhatsAppSender } from '../src/whatsapp/stub-whatsapp.sender';
import { TokenStatus } from '@prisma/client';

/**
 * Exercises queue-actions status transitions and the WhatsApp
 * success/warning contract using the in-memory StubWhatsAppSender, so this
 * runs without real Twilio credentials or a live database — Prisma calls are
 * mocked directly.
 */
describe('QueueActionsService (e2e-style, mocked Prisma)', () => {
  let service: QueueActionsService;
  let stub: StubWhatsAppSender;

  const baseToken = {
    id: 'token-1',
    date: new Date('2026-01-01'),
    tokenNumber: 1,
    name: 'Test User',
    mobile: '9876543210',
    status: TokenStatus.WAITING,
    createdAt: new Date(),
  };

  const prismaMock: any = {
    token: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));

  beforeEach(async () => {
    jest.clearAllMocks();
    stub = new StubWhatsAppSender();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        QueueActionsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WHATSAPP_SENDER, useValue: stub },
      ],
    }).compile();

    service = moduleRef.get(QueueActionsService);
  });

  it('calls a token, sends a WhatsApp message, and returns no warning on success', async () => {
    prismaMock.token.findUnique.mockResolvedValue(baseToken);
    prismaMock.token.findUniqueOrThrow.mockResolvedValue(baseToken);
    prismaMock.token.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.token.update.mockResolvedValue({
      ...baseToken,
      status: TokenStatus.CALLED,
    });

    const result = await service.call('token-1');

    expect(result.success).toBe(true);
    expect(result.token.status).toBe(TokenStatus.CALLED);
    expect(result.warning).toBeUndefined();
    expect(stub.sent).toEqual([{ mobile: '9876543210', tokenNumber: 1 }]);
  });

  it('un-calls any other currently CALLED token for the same day', async () => {
    prismaMock.token.findUnique.mockResolvedValue(baseToken);
    prismaMock.token.findUniqueOrThrow.mockResolvedValue(baseToken);
    prismaMock.token.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.token.update.mockResolvedValue({
      ...baseToken,
      status: TokenStatus.CALLED,
    });

    await service.call('token-1');

    expect(prismaMock.token.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: TokenStatus.CALLED,
          NOT: { id: 'token-1' },
        }),
        data: { status: TokenStatus.WAITING },
      }),
    );
  });

  it('still reports success with a warning when the WhatsApp send fails', async () => {
    prismaMock.token.findUnique.mockResolvedValue(baseToken);
    prismaMock.token.findUniqueOrThrow.mockResolvedValue(baseToken);
    prismaMock.token.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.token.update.mockResolvedValue({
      ...baseToken,
      status: TokenStatus.CALLED,
    });
    jest
      .spyOn(stub, 'sendTokenCalledMessage')
      .mockRejectedValue(new Error('Twilio unreachable'));

    const result = await service.call('token-1');

    expect(result.success).toBe(true);
    expect(result.token.status).toBe(TokenStatus.CALLED);
    expect(result.warning).toContain('Twilio unreachable');
  });

  it('rejects recall for a token that is not currently CALLED', async () => {
    prismaMock.token.findUnique.mockResolvedValue(baseToken); // status WAITING

    await expect(service.recall('token-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the token does not exist', async () => {
    prismaMock.token.findUnique.mockResolvedValue(null);

    await expect(service.done('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
