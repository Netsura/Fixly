import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fixly/database';
import { CreateReportDto } from './dto/create-report.dto';
import { writeAudit } from '../common/audit';

@Injectable()
export class ReportsService {
  create(reporterId: string, input: CreateReportDto) {
    return prisma.report.create({
      data: {
        reporterId,
        targetType: input.targetType.trim().toLowerCase(),
        targetId: input.targetId,
        reason: input.reason.trim(),
      },
    });
  }

  listOpen() {
    return prisma.report.findMany({
      where: { resolvedAt: null },
      include: { reporter: { select: { id: true, email: true, profile: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resolve(actorId: string, id: string) {
    return prisma.$transaction(async (transaction) => {
      const resolved = await transaction.report.updateMany({
        where: { id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      if (resolved.count !== 1) {
        const exists = await transaction.report.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Report not found');
        // Already resolved by another admin; treat as idempotent.
        return transaction.report.findUniqueOrThrow({ where: { id } });
      }

      await writeAudit(transaction, {
        actorId,
        action: 'report.resolve',
        entityType: 'Report',
        entityId: id,
      });
      return transaction.report.findUniqueOrThrow({ where: { id } });
    });
  }
}
