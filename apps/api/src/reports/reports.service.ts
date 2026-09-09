import { Injectable } from '@nestjs/common';
import { prisma } from '@fixly/database';
import { CreateReportDto } from './dto/create-report.dto';

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

  resolve(id: string) {
    return prisma.report.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }
}
