import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, prisma, UserRole } from '@fixly/database';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class AdminService {
  async statistics() {
    const [users, customers, providers, requests, completedJobs, payments, activeJobs, ratings] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
      prisma.user.count({ where: { role: UserRole.PROVIDER } }),
      prisma.serviceRequest.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCEEDED }, _sum: { amountCents: true } }),
      prisma.booking.count({ where: { status: { in: ['PAID', 'SCHEDULED', 'IN_PROGRESS'] } } }),
      prisma.review.aggregate({ _avg: { rating: true } }),
    ]);
    return {
      users,
      customers,
      providers,
      requests,
      completedJobs,
      revenueCents: payments._sum.amountCents ?? 0,
      activeJobs,
      averageRating: ratings._avg.rating ?? 0,
    };
  }

  async listUsers(page = 1, limit = 25, search?: string) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const where: Prisma.UserWhereInput = search
      ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { profile: { displayName: { contains: search, mode: 'insensitive' } } }] }
      : {};
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: { id: true, email: true, role: true, suspendedAt: true, createdAt: true, profile: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * boundedLimit, take: boundedLimit }),
      prisma.user.count({ where }),
    ]);
    return { items, page, limit: boundedLimit, total };
  }

  async suspendUser(actorId: string, userId: string, suspended: boolean) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN) throw new ConflictException('Admin accounts cannot be suspended here');
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: suspended ? new Date() : null },
      select: { id: true, email: true, role: true, suspendedAt: true },
    });
    await this.audit(actorId, suspended ? 'user.suspend' : 'user.unsuspend', 'User', userId, { email: updated.email });
    return updated;
  }

  async createService(actorId: string, input: CreateServiceDto) {
    const category = await prisma.serviceCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new NotFoundException('Service category not found');
    try {
      const service = await prisma.service.create({
        data: { categoryId: input.categoryId, name: input.name.trim(), slug: input.slug.trim().toLowerCase() },
        include: { category: true },
      });
      await this.audit(actorId, 'service.create', 'Service', service.id, { slug: service.slug });
      return service;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) throw new ConflictException('Service slug already exists');
      throw error;
    }
  }

  async updateService(actorId: string, id: string, input: UpdateServiceDto) {
    try {
      const service = await prisma.service.update({ where: { id }, data: input, include: { category: true } });
      await this.audit(actorId, 'service.update', 'Service', id, { ...input } as Prisma.InputJsonValue);
      return service;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('Service not found');
      throw error;
    }
  }

  async listAuditLogs(page = 1, limit = 50) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        include: { actor: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * boundedLimit,
        take: boundedLimit,
      }),
      prisma.auditLog.count(),
    ]);
    return { items, page, limit: boundedLimit, total };
  }

  private audit(actorId: string, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) {
    return prisma.auditLog.create({
      data: { actorId, action, entityType, entityId, metadata },
    });
  }
}
