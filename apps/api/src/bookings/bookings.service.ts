import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, prisma, RequestStatus, UserRole } from '@fixly/database';
import { ScheduleBookingDto } from './dto/schedule-booking.dto';

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
      from: [BookingStatus.PAID],
      to: BookingStatus.SCHEDULED,
      requestTo: RequestStatus.SCHEDULED,
      data: { scheduledAt: new Date(input.scheduledAt) },
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async start(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      from: [BookingStatus.SCHEDULED],
      to: BookingStatus.IN_PROGRESS,
      requestTo: RequestStatus.IN_PROGRESS,
      allowRoles: [UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async complete(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      from: [BookingStatus.IN_PROGRESS],
      to: BookingStatus.COMPLETED,
      requestTo: RequestStatus.COMPLETED,
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  async cancel(userId: string, role: UserRole, id: string) {
    return this.transition(userId, role, id, {
      from: [BookingStatus.PAYMENT_PENDING, BookingStatus.PAID, BookingStatus.SCHEDULED],
      to: BookingStatus.CANCELLED,
      requestTo: RequestStatus.CANCELLED,
      allowRoles: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.ADMIN],
    });
  }

  private async transition(
    userId: string,
    role: UserRole,
    id: string,
    options: {
      from: BookingStatus[];
      to: BookingStatus;
      requestTo: RequestStatus;
      data?: { scheduledAt?: Date };
      allowRoles: UserRole[];
    },
  ) {
    if (!options.allowRoles.includes(role) && role !== UserRole.ADMIN) {
      throw new ForbiddenException('You cannot perform this booking action');
    }

    return prisma.$transaction(async (transaction) => {
      const booking = await transaction.booking.findUnique({ where: { id } });
      if (!booking) throw new NotFoundException('Booking not found');
      this.assertParticipant(booking, userId, role);
      if (!options.from.includes(booking.status)) {
        throw new ConflictException(`Booking cannot move to ${options.to} from ${booking.status}`);
      }

      const updated = await transaction.booking.updateMany({
        where: { id, status: { in: options.from } },
        data: { status: options.to, ...options.data },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Booking state changed concurrently');
      }

      await transaction.serviceRequest.update({
        where: { id: booking.requestId },
        data: { status: options.requestTo },
      });

      return transaction.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    });
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
