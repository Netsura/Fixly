import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus, prisma, UserRole } from '@fixly/database';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';

@Injectable()
export class RequestsService {
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
    const textFilter: Prisma.ServiceRequestWhereInput = term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, { locationHash: { contains: term, mode: 'insensitive' } }, { service: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { slug: { contains: term.toLowerCase(), mode: 'insensitive' } }] } }] } : {};
    const where: Prisma.ServiceRequestWhereInput = user.role === UserRole.PROVIDER
      ? { ...textFilter, status: { in: [RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] }, offers: { none: { providerId: user.id } } }
      : { ...textFilter, customerId: user.id };
    const [items, total] = await prisma.$transaction([
      prisma.serviceRequest.findMany({
        where,
        include: { service: true, offers: user.role === UserRole.CUSTOMER, attachments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * boundedLimit,
        take: boundedLimit,
      }),
      prisma.serviceRequest.count({ where }),
    ]);
    return { items, page, limit: boundedLimit, total };
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
    return request;
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
    this.validateWindow(input.preferredStart ?? request.preferredStart.toISOString(), input.preferredEnd ?? request.preferredEnd.toISOString(), input.budgetMinCents ?? request.budgetMinCents ?? undefined, input.budgetMaxCents ?? request.budgetMaxCents ?? undefined);
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
    if (([RequestStatus.COMPLETED, RequestStatus.REVIEWED, RequestStatus.CANCELLED] as RequestStatus[]).includes(request.status)) {
      throw new ConflictException('Request cannot be cancelled in its current state');
    }
    return prisma.serviceRequest.update({ where: { id }, data: { status: RequestStatus.CANCELLED } });
  }

  async publish(customerId: string, id: string) {
    const request = await prisma.serviceRequest.findUnique({ where: { id } });
    if (!request || request.customerId !== customerId) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== RequestStatus.DRAFT) {
      throw new ConflictException('Only draft requests can be published');
    }
    return prisma.serviceRequest.update({
      where: { id },
      data: { status: RequestStatus.PUBLISHED },
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
