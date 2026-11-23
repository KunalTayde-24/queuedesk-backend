import { AdminRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Creates (or updates the password and role of) one staff login.
 *   USER_EMAIL=queue@cileigong USER_PASSWORD=... USER_ROLE=QUEUE npm run create-user
 * ADMIN can manage events and the queue; QUEUE can only run the queue.
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.env.USER_EMAIL?.trim().toLowerCase();
  const password = process.env.USER_PASSWORD;
  const role = process.env.USER_ROLE as AdminRole | undefined;

  if (!email || !password || !role || !(role in AdminRole)) {
    throw new Error('Set USER_EMAIL, USER_PASSWORD and USER_ROLE (ADMIN or QUEUE).');
  }
  if (password.length < 10) throw new Error('Use a password of at least 10 characters.');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash, role },
    create: { email, passwordHash, role },
  });
  console.log(`${user.role} login ready: ${user.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
