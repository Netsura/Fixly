import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@fixly/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly jobsService: JobsService) {}

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, suspendedAt: true },
    });
    if (!user || user.suspendedAt) return null;
    return { id: user.id, email: user.email, role: user.role };
  }

  async create(userId: string, input: { bookingId?: string; participantUserId?: string }) {
    if (input.participantUserId) {
      return this.startWithUser(userId, input.participantUserId);
    }
    if (!input.bookingId) {
      throw new BadRequestException('bookingId or participantUserId is required');
    }
    return this.createForBooking(userId, input.bookingId);
  }

  async startWithUser(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('You cannot start a chat with yourself');
    }

    const otherUser = await prisma.user.findFirst({
      where: { id: otherUserId, suspendedAt: null },
      select: { id: true },
    });
    if (!otherUser) {
      throw new NotFoundException('User not found');
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [{ participants: { some: { userId } } }, { participants: { some: { userId: otherUserId } } }],
      },
      include: { participants: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return existing;
    }

    const booking = await prisma.booking.findFirst({
      where: {
        OR: [
          { customerId: userId, providerId: otherUserId },
          { customerId: otherUserId, providerId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (booking) {
      return this.createForBooking(userId, booking.id);
    }

    throw new ForbiddenException('You can only message users you have a booking with');
  }

  async createForBooking(userId: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, customerId: true, providerId: true },
    });
    if (!booking || ![booking.customerId, booking.providerId].includes(userId)) {
      throw new NotFoundException('Booking not found');
    }

    return prisma.conversation.upsert({
      where: { bookingId },
      update: {},
      create: {
        bookingId,
        participants: {
          create: [{ userId: booking.customerId }, { userId: booking.providerId }],
        },
      },
      include: { participants: true },
    });
  }

  async list(userId: string) {
    return prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        booking: { include: { request: { include: { service: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true, senderId: true } },
        participants: { select: { userId: true, lastReadAt: true, user: { select: { id: true, email: true, role: true, profile: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMessages(userId: string, conversationId: string, cursor?: string, limit = 50) {
    await this.assertParticipant(userId, conversationId);
    return prisma.message.findMany({
      where: { conversationId },
      take: Math.min(Math.max(limit, 1), 100),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: { id: true, email: true, role: true, profile: true } } },
    });
  }

  async assertParticipant(userId: string, conversationId: string) {
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException('Conversation access denied');
    }
    return participant;
  }

  async sendMessage(userId: string, conversationId: string, body: string) {
    const cleanBody = body.trim();
    if (!cleanBody || cleanBody.length > 5000) {
      throw new ForbiddenException('Message must be between 1 and 5000 characters');
    }
    await this.assertParticipant(userId, conversationId);
    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true } });
    const recipientIds = participants.filter((participant) => participant.userId !== userId).map((participant) => participant.userId);
    const message = await prisma.message.create({
      data: { conversationId, senderId: userId, body: cleanBody },
      include: { sender: { select: { id: true, email: true, role: true, profile: true } } },
    });
    await prisma.notification.createMany({
      data: recipientIds.map((recipientId) => ({
        userId: recipientId,
        type: 'NEW_MESSAGE',
        payload: { conversationId, messageId: message.id },
        dedupeKey: `NEW_MESSAGE:${message.id}:${recipientId}`,
      })),
      skipDuplicates: true,
    });
    await this.jobsService.enqueueMessageEmail({ messageId: message.id, conversationId, recipientIds });
    return {
      message,
      recipientIds,
    };
  }

  async markRead(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    return prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });
  }
}
