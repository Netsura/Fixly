import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const categories = [
    { slug: 'home-maintenance', name: 'Home maintenance' },
    { slug: 'moving', name: 'Moving' },
    { slug: 'cleaning', name: 'Cleaning' },
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
