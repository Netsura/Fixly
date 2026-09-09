import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@fixly/database';
import { ListServicesQuery } from './dto/list-services.query';

@Injectable()
export class ServicesService {
  async list(query: ListServicesQuery) {
    const where: Prisma.ServiceWhereInput = {
      active: true,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search.trim(), mode: 'insensitive' } }, { slug: { contains: query.search.trim().toLowerCase(), mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.service.findMany({
        where,
        include: { category: true },
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.service.count({ where }),
    ]);

    return { items, page: query.page, limit: query.limit, total };
  }

  async findOne(id: string) {
    const service = await prisma.service.findFirst({
      where: { id, active: true },
      include: { category: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  async findBySlug(slug: string) {
    const service = await prisma.service.findFirst({ where: { slug: slug.toLowerCase(), active: true }, include: { category: true } });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }
}
