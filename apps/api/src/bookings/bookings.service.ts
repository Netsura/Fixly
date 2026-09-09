import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BOOKING_TO_REQUEST_STATUS,
  BookingStatus,
  bookingSourcesFor,
  canTransitionBooking,
  prisma,
  requestSourcesFor,
  UserRole,
} from '@fixly/database';
import { ScheduleBookingDto } from './dto/schedule-booking.dto';
import { JobsService } from '../jobs/jobs.service';

const bookingInclude = {
  request: { include: { service: true } },
  offer: true,
  customer: { select: { id: true, email: true, profile: true } },
  provider: { select: { id: true, email: true, profile: true } },
  conversation: { select: { id: true } },
  review: true,
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

@Injectable()
export class BookingsService {
  constructor(private readonly jobsService: JobsService) {}

  async list(userId: string, role: UserRole) {
    const where = role === UserRole.PROVIDER
      ? { providerId: userId }
      : role === UserRole.ADMIN
        ? {}
        : { customerId: userId };
    return prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, role: UserRole, id: string) {
    const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertParticipant(booking, userId, role);
    return booking;
  }

  async schedule(userId: string, role: UserRole, id: string, input: ScheduleBookingDto) {
    return this.transition(userId, role, id, {
      to: BookingStatus.SCHEDULED,
      data: { scheduledAt: new Date(input.scheduledAt) },
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async start(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      to: BookingStatus.IN_PROGRESS,
      allowRoles: [UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async complete(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      to: BookingStatus.COMPLETED,
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async cancel(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      to: BookingStatus.CANCELLED,
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  /**
   * All booking state changes funnel through here. The legal source states come
   * from the shared state machine rather than per-method literals, and the
   * update is conditional on those states so a concurrent writer cannot land a
   * transition that the read-then-check would have rejected.
   */
  private async transition(
    userId: string,
    role: UserRole,
    id: string,
    options: {
      to: BookingStatus;
      data?: { scheduledAt?: Date };
      allowRoles: UserRole[];
    },
  ) {
    if (!options.allowRoles.includes(role) && role !== UserRole.ADMIN) {
      throw new ForbiddenException('You cannot perform this booking action');
    }

    const sources = bookingSourcesFor(options.to);
    const requestTo = BOOKING_TO_REQUEST_STATUS[options.to];

    const updated = await prisma.$transaction(async (transaction) => {
      const booking = await transaction.booking.findUnique({ where: { id } });
      if (!booking) throw new NotFoundException('Booking not found');
      this.assertParticipant(booking, userId, role);
      if (!canTransitionBooking(booking.status, options.to)) {
        throw new ConflictException(`Booking cannot move to ${options.to} from ${booking.status}`);
      }

      const updated = await transaction.booking.updateMany({
        where: { id, status: { in: sources } },
        data: { status: options.to, ...options.data },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Booking state changed concurrently');
      }

      await transaction.serviceRequest.updateMany({
        where: { id: booking.requestId, status: { in: requestSourcesFor(requestTo) } },
        data: { status: requestTo },
      });

      return transaction.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    });

    await this.notifyCounterparty(updated, userId, options.to);
    return updated;
  }

  /**
   * Tells the other participant about the change. The dedupe key is the
   * booking plus its new status, so a retried job can never produce a second
   * notification for the same transition.
   */
  private async notifyCounterparty(
    booking: { id: string; customerId: string; providerId: string },
    actorId: string,
    status: BookingStatus,
  ) {
    const recipientId = booking.customerId === actorId ? booking.providerId : booking.customerId;
    if (recipientId === actorId) return;

    try {
      await this.jobsService.enqueueNotification({
        userId: recipientId,
        type: 'BOOKING_STATUS',
        payload: { bookingId: booking.id, status },
        dedupeKey: `BOOKING_STATUS:${booking.id}:${status}`,
      });
    } catch (error) {
      // The transition is already committed; a queue outage must not undo it.
      console.error(JSON.stringify({
        event: 'booking.notification_enqueue_failed',
        bookingId: booking.id,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
    }
  }

  private assertParticipant(
    booking: { customerId: string; providerId: string },
    userId: string,
    role: UserRole,
  ) {
    if (role === UserRole.ADMIN) return;
    if (booking.customerId !== userId && booking.providerId !== userId) {
      throw new NotFoundException('Booking not found');
    }
  }
}
