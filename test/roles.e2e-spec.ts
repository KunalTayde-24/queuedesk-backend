import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../src/auth/admin.guard';
import { EventsAdminController } from '../src/events/events-admin.controller';
import { QueueActionsController } from '../src/queue-actions/queue-actions.controller';
import { AdminQueueController } from '../src/tokens/admin-queue.controller';

function contextFor(controller: new (...a: never[]) => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', email: 'a@b.c', role } }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard roles', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    // The JWT check itself is covered by passport; here we only test the role rule.
    jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true);
    guard = new AdminGuard(new Reflector());
  });
  afterEach(() => jest.restoreAllMocks());

  it('lets ADMIN into events and the queue', async () => {
    await expect(guard.canActivate(contextFor(EventsAdminController, 'ADMIN'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(QueueActionsController, 'ADMIN'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(AdminQueueController, 'ADMIN'))).resolves.toBe(true);
  });

  it('keeps QUEUE out of events but lets it run the queue', async () => {
    await expect(guard.canActivate(contextFor(EventsAdminController, 'QUEUE'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(contextFor(QueueActionsController, 'QUEUE'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(AdminQueueController, 'QUEUE'))).resolves.toBe(true);
  });
});

describe('events list for the queue page', () => {
  it('is readable by QUEUE, while editing stays admin-only', () => {
    const list = Reflect.getMetadata('roles', EventsAdminController.prototype.list);
    const create = Reflect.getMetadata('roles', EventsAdminController.prototype.create);
    expect(list).toEqual(['ADMIN', 'QUEUE']);
    expect(create).toBeUndefined(); // falls back to the class: ADMIN only
    expect(Reflect.getMetadata('roles', EventsAdminController)).toEqual(['ADMIN']);
  });
});
