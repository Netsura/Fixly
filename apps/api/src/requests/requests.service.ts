import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionRequest, Prisma, RequestStatus, prisma, requestSourcesFor, UserRole } from '@fixly/database';
import { AuthenticatedUser } from '../auth/auth.types';
import { PresenceService } from '../conversations/presence.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';

@Injectable()
export class RequestsService {
  constructor(private readonly presenceService: PresenceService) {}

  async create(customerId: string, input: CreateRequestDto) {
    const service = await prisma.service.findFirst({ where: { id: input.serviceId, active: true } });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    this.validateWindow(input.preferredStart, input.preferredEnd, input.budgetMinCents, input.budgetMaxCents);

    return prisma.serviceRequest.create({
      data: {
        customerId,
        serviceId: input.serviceId,
        status: input.asDraft ? RequestStatus.DRAFT : RequestStatus.PUBLISHED,
        title: input.title.trim(),
        description: input.description.trim(),
        locationHash: input.locationHash.trim(),
        preferredStart: new Date(input.preferredStart),
        preferredEnd: new Date(input.preferredEnd),
        budgetMinCents: input.budgetMinCents,
        budgetMaxCents: input.budgetMaxCents,
      },
      include: { service: true, attachments: true },
    });
  }

  async list(user: AuthenticatedUser, page = 1, limit = 20, search?: string) {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const term = search?.trim();
    const textFilter: Prisma.ServiceRequestWhereInput = term
      ? {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { locationHash: { contains: term, mode: 'insensitive' } },
            { service: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { slug: { contains: term.toLowerCase(), mode: 'insensitive' } }] } },
          ],
        }
      : {};

    // Never filter marketplace discovery by online/presence status.
    // Providers still see open requests even when the customer is offline.
    // Requests they already offered on remain visible (with their offer).
    const where: Prisma.ServiceRequestWhereInput =
      user.role === UserRole.PROVIDER
        ? {
            ...textFilter,
            status: { in: [RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] },
            customer: { suspendedAt: null },
          }
        : user.role === UserRole.ADMIN
          ? { ...textFilter }
          : { ...textFilter, customerId: user.id };

    const [items, total] = await prisma.$transaction([
      prisma.serviceRequest.findMany({
        where,
        include: {
          service: true,
          customer: { select: { id: true, profile: { select: { displayName: true } } } },
          offers:
            user.role === UserRole.CUSTOMER
              ? true
              : { where: { providerId: user.id }, include: { provider: { select: { id: true, profile: true } } } },
          attachments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * boundedLimit,
        take: boundedLimit,
      }),
      prisma.serviceRequest.count({ where }),
    ]);

    const presence = await this.presenceService.areOnline(items.map((item) => item.customerId));
    return {
      items: items.map((item) => ({
        ...item,
        customerOnline: Boolean(presence[item.customerId]),
        myOffer: user.role === UserRole.PROVIDER ? item.offers[0] ?? null : undefined,
      })),
      page,
      limit: boundedLimit,
      total,
    };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const request = await prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        service: true,
        customer: { select: { id: true, role: true, profile: { select: { displayName: true, ratingAverage: true, ratingCount: true } } } },
        offers: { include: { provider: { select: { id: true, email: true, role: true, profile: true } } } },
        booking: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            providerId: true,
            customerId: true,
            conversation: { select: { id: true } },
            review: { select: { id: true, rating: true } },
            payments: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        attachments: true,
      },
    });
    if (!request || (user.role === UserRole.CUSTOMER && request.customerId !== user.id)) {
      throw new NotFoundException('Request not found');
    }
    if (user.role === UserRole.PROVIDER) {
      const isOpen = ([RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] as RequestStatus[]).includes(request.status);
      const hasOffer = request.offers.some((offer) => offer.providerId === user.id);
      const isBookedProvider = request.booking?.providerId === user.id;
      if (!isOpen && !hasOffer && !isBookedProvider) {
        throw new NotFoundException('Request not found');
      }
    }

    const [customerOnline, providerPresence] = await Promise.all([
      this.presenceService.isOnline(request.customerId),
      this.presenceService.areOnline(request.offers.map((offer) => offer.providerId)),
    ]);

    return {
      ...request,
      customerOnline,
      offers: request.offers.map((offer) => ({
        ...offer,
        providerOnline: Boolean(providerPresence[offer.providerId]),
      })),
    };
  }

  async update(customerId: string, id: string, input: UpdateRequestDto) {
    const request = await prisma.serviceRequest.findUnique({ where: { id } });
    if (!request || request.customerId !== customerId) {
      throw new NotFoundException('Request not found');
    }
    if (!([RequestStatus.DRAFT, RequestStatus.PUBLISHED] as RequestStatus[]).includes(request.status)) {
      throw new ConflictException('Request cannot be edited in its current state');
    }
    if (input.serviceId) {
      const service = await prisma.service.findFirst({ where: { id: input.serviceId, active: true } });
      if (!service) {
        throw new NotFoundException('Service not found');
      }
    }
    this.validateWindow(
      input.preferredStart ?? request.preferredStart.toISOString(),
      input.preferredEnd ?? request.preferredEnd.toISOString(),
      input.budgetMinCents ?? request.budgetMinCents ?? undefined,
      input.budgetMaxCents ?? request.budgetMaxCents ?? undefined,
    );
    return prisma.serviceRequest.update({
      where: { id },
      data: {
        ...input,
        title: input.title?.trim(),
        description: input.description?.trim(),
        locationHash: input.locationHash?.trim(),
        preferredStart: input.preferredStart ? new Date(input.preferredStart) : undefined,
        preferredEnd: input.preferredEnd ? new Date(input.preferredEnd) : undefined,
      },
      include: { service: true, attachments: true },
    });
  }

  async cancel(customerId: string, id: string) {
    const request = await prisma.serviceRequest.findUnique({ where: { id } });
    if (!request || request.customerId !== customerId) {
      throw new NotFoundException('Request not found');
    }
    if (!canTransitionRequest(request.status, RequestStatus.CANCELLED)) {
      throw new ConflictException('Request cannot be cancelled in its current state');
    }
    const cancelled = await prisma.serviceRequest.updateMany({
      where: { id, status: { in: requestSourcesFor(RequestStatus.CANCELLED) } },
      data: { status: RequestStatus.CANCELLED },
    });
    if (cancelled.count !== 1) {
      throw new ConflictException('Request cannot be cancelled in its current state');
    }
    return prisma.serviceRequest.findUniqueOrThrow({ where: { id } });
  }

  async publish(customerId: string, id: string) {
    const request = await prisma.serviceRequest.findUnique({ where: { id } });
    if (!request || request.customerId !== customerId) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== RequestStatus.DRAFT) {
      throw new ConflictException('Only draft requests can be published');
    }
    const published = await prisma.serviceRequest.updateMany({
      where: { id, status: { in: requestSourcesFor(RequestStatus.PUBLISHED) } },
      data: { status: RequestStatus.PUBLISHED },
    });
    if (published.count !== 1) {
      throw new ConflictException('Only draft requests can be published');
    }
    return prisma.serviceRequest.findUniqueOrThrow({
      where: { id },
      include: { service: true, attachments: true },
    });
  }

  private validateWindow(start: string, end: string, min?: number, max?: number) {
    if (new Date(start) >= new Date(end)) {
      throw new ConflictException('Preferred end must be after preferred start');
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new ConflictException('Minimum budget cannot exceed maximum budget');
    }
  }
}
