import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const categories = [
    { slug: 'home-maintenance', name: 'Home maintenance' },
    { slug: 'moving', name: 'Moving' },
    { slug: 'cleaning', name: 'Cleaning' },
    { slug: 'garden', name: 'Garden and outdoor' },
  ];

  for (const category of categories) {
    const created = await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });

    if (category.slug === 'home-maintenance') {
      await prisma.service.upsert({
        where: { slug: 'plumbing' },
        update: { name: 'Plumbing', categoryId: created.id },
        create: { slug: 'plumbing', name: 'Plumbing', categoryId: created.id },
      });
      await prisma.service.upsert({
        where: { slug: 'electrical' },
        update: { name: 'Electrical', categoryId: created.id },
        create: { slug: 'electrical', name: 'Electrical', categoryId: created.id },
      });
      await prisma.service.upsert({
        where: { slug: 'repairs' },
        update: { name: 'General repairs', categoryId: created.id },
        create: { slug: 'repairs', name: 'General repairs', categoryId: created.id },
      });
    }

    if (category.slug === 'cleaning') {
      await prisma.service.upsert({
        where: { slug: 'house-cleaning' },
        update: { name: 'House cleaning', categoryId: created.id },
        create: { slug: 'house-cleaning', name: 'House cleaning', categoryId: created.id },
      });
    }

    if (category.slug === 'moving') {
      await prisma.service.upsert({
        where: { slug: 'local-moving' },
        update: { name: 'Local moving', categoryId: created.id },
        create: { slug: 'local-moving', name: 'Local moving', categoryId: created.id },
      });
    }

    if (category.slug === 'garden') {
      await prisma.service.upsert({
        where: { slug: 'gardening' },
        update: { name: 'Gardening', categoryId: created.id },
        create: { slug: 'gardening', name: 'Gardening', categoryId: created.id },
      });
      await prisma.service.upsert({
        where: { slug: 'lawn-care' },
        update: { name: 'Lawn care', categoryId: created.id },
        create: { slug: 'lawn-care', name: 'Lawn care', categoryId: created.id },
      });
    }
  }

  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const users = [
    { email: 'admin@fixly.test', role: UserRole.ADMIN, displayName: 'Fixly Admin' },
    { email: 'customer@fixly.test', role: UserRole.CUSTOMER, displayName: 'Casey Customer' },
    { email: 'provider@fixly.test', role: UserRole.PROVIDER, displayName: 'Pat Provider' },
  ] as const;

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        role: user.role,
        emailVerifiedAt: new Date(),
        profile: { upsert: { create: { displayName: user.displayName }, update: { displayName: user.displayName } } },
      },
      create: {
        email: user.email,
        passwordHash,
        role: user.role,
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: user.displayName } },
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
