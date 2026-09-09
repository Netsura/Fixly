import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, prisma, RequestStatus, requestSourcesFor } from '@fixly/database';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  async create(authorId: string, input: CreateReviewDto) {
    return prisma.$transaction(async (transaction) => {
      const booking = await transaction.booking.findUnique({
        where: { id: input.bookingId },
        include: { review: true, request: true },
      });
      if (!booking || booking.customerId !== authorId) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status !== BookingStatus.COMPLETED) {
        throw new ConflictException('Only completed bookings can be reviewed');
      }
      if (booking.review) {
        throw new ConflictException('Booking already has a review');
      }
      if (booking.providerId === authorId) {
        throw new ConflictException('You cannot review yourself');
      }

      const review = await transaction.review.create({
        data: {
          bookingId: booking.id,
          authorId,
          subjectId: booking.providerId,
          rating: input.rating,
          body: input.body.trim(),
        },
        include: {
          author: { select: { id: true, profile: true } },
          subject: { select: { id: true, profile: true } },
        },
      });

      await transaction.serviceRequest.updateMany({
        where: { id: booking.requestId, status: { in: requestSourcesFor(RequestStatus.REVIEWED) } },
        data: { status: RequestStatus.REVIEWED },
      });

      const aggregate = await transaction.review.aggregate({
        where: { subjectId: booking.providerId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      await transaction.profile.upsert({
        where: { userId: booking.providerId },
        create: {
          userId: booking.providerId,
          displayName: 'Provider',
          ratingAverage: new Prisma.Decimal(aggregate._avg.rating ?? input.rating),
          ratingCount: aggregate._count.rating,
        },
        update: {
          ratingAverage: new Prisma.Decimal(aggregate._avg.rating ?? input.rating),
          ratingCount: aggregate._count.rating,
        },
      });

      return review;
    });
  }

  async listForUser(subjectId: string) {
    return prisma.review.findMany({
      where: { subjectId },
      include: { author: { select: { id: true, profile: { select: { displayName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
