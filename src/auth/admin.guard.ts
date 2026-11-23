import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from './roles';

/** Signed-in staff only; a route can narrow it further with @Roles(...). */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;

    const allowed = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user;
    if (!user?.role || !allowed.includes(user.role)) {
      throw new ForbiddenException('Your account cannot do this.');
    }
    return true;
  }
}
