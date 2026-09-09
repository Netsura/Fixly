import { Injectable } from '@nestjs/common';
import { prisma } from '@fixly/database';

@Injectable()
export class NotificationsService {
  list(userId: string) {
    return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  markRead(userId: string, notificationId: string) {
    return prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } }).then(() => ({ success: true }));
  }
}
