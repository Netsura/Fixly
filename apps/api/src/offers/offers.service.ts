import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, OfferStatus, prisma, RequestStatus, UserRole } from '@fixly/database';
import { CreateOfferDto } from './dto/create-offer.dto';

@Injectable()
export class OffersService {
  async listForRequest(userId: string, role: UserRole, requestId: string) {
    const request = await prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        customerId: true,
        status: true,
        offers: { where: { providerId: userId }, select: { id: true } },
        booking: { select: { providerId: true } },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    const isCustomerOwner = role === UserRole.CUSTOMER && request.customerId === userId;
    const isProviderParticipant =
      role === UserRole.PROVIDER &&
      (request.offers.length > 0 ||
        request.booking?.providerId === userId ||
        ([RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] as RequestStatus[]).includes(request.status));
    const isAdmin = role === UserRole.ADMIN;
    if (!isCustomerOwner && !isProviderParticipant && !isAdmin) {
      throw new NotFoundException('Request not found');
    }
    const offers = await prisma.offer.findMany({
      where: { requestId, ...(role === UserRole.PROVIDER ? { providerId: userId } : {}) },
      include: { provider: { select: { id: true, email: true, role: true, profile: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return offers;
  }

  async create(providerId: string, requestId: string, input: CreateOfferDto) {
    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { customerId: true, status: true } });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.customerId === providerId) {
      throw new ForbiddenException('You cannot offer on your own request');
    }
    if (!([RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] as RequestStatus[]).includes(request.status)) {
      throw new ConflictException('Request is not accepting offers');
    }

    try {
      return await prisma.$transaction(async (transaction) => {
        const offer = await transaction.offer.create({
          data: {
            requestId,
            providerId,
            priceCents: input.priceCents,
            message: input.message.trim(),
            availableAt: new Date(input.availableAt),
          },
          include: { provider: { select: { id: true, email: true, role: true, profile: true } } },
        });
        await transaction.serviceRequest.update({
          where: { id: requestId },
          data: { status: RequestStatus.OFFER_RECEIVED },
        });
        return offer;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        throw new ConflictException('Provider already submitted an offer for this request');
      }
      throw error;
    }
  }

  async accept(customerId: string, offerId: string) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const offer = await transaction.offer.findUnique({
          where: { id: offerId },
          include: { request: true },
        });
        if (!offer || offer.request.customerId !== customerId) {
          throw new NotFoundException('Offer not found');
        }
        if (offer.status !== OfferStatus.PENDING || offer.request.status !== RequestStatus.OFFER_RECEIVED) {
          throw new ConflictException('Offer cannot be accepted in the current state');
        }

        const claimed = await transaction.serviceRequest.updateMany({
          where: { id: offer.requestId, status: RequestStatus.OFFER_RECEIVED },
          data: { status: RequestStatus.PROVIDER_SELECTED },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Another offer was accepted first');
        }

        await transaction.offer.update({ where: { id: offer.id }, data: { status: OfferStatus.ACCEPTED } });
        await transaction.offer.updateMany({
          where: { requestId: offer.requestId, id: { not: offer.id }, status: OfferStatus.PENDING },
          data: { status: OfferStatus.REJECTED },
        });
        const booking = await transaction.booking.create({
          data: {
            requestId: offer.requestId,
            offerId: offer.id,
            customerId,
            providerId: offer.providerId,
            status: BookingStatus.PAYMENT_PENDING,
          },
        });
        await transaction.serviceRequest.update({
          where: { id: offer.requestId },
          data: { status: RequestStatus.PAYMENT_PENDING },
        });
        await transaction.conversation.create({
          data: {
            bookingId: booking.id,
            participants: {
              create: [{ userId: customerId }, { userId: offer.providerId }],
            },
          },
        });
        return transaction.booking.findUnique({
          where: { id: booking.id },
          include: { request: true, offer: true, conversation: true },
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      throw error;
    }
  }
}
