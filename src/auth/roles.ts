import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Limits a controller or route to these roles. Routes without it allow any signed-in staff. */
export const Roles = (...roles: AdminRole[] | `${AdminRole}`[]) => SetMetadata(ROLES_KEY, roles);
