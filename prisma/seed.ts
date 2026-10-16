import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before seeding.',
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log(`Admin ready: ${admin.email}`);

  const sampleTitle = 'Diwali Celebration';
  const existingEvent = await prisma.event.findFirst({
    where: { title: sampleTitle },
  });
  if (!existingEvent) {
    const opensAt = new Date();
    const startsAt = new Date(opensAt.getTime() + 10 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);

    await prisma.event.create({
      data: {
        title: sampleTitle,
        description:
          'Join us for an evening of lights, music, and sweets. Bring your family, wear something festive, and register before the celebration begins.',
        venue: 'Main Hall',
        registrationOpensAt: opensAt,
        registrationClosesAt: startsAt,
        startsAt,
        endsAt,
        status: 'PUBLISHED',
        createdByAdminId: admin.id,
      },
    });
    console.log(`Sample event ready: ${sampleTitle}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
