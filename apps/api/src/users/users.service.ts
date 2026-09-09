import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, Prisma } from '@fixly/database';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        profile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileDto) {
    const data: Prisma.ProfileUpdateInput = {
      ...input,
      serviceArea: input.serviceArea as Prisma.InputJsonValue | undefined,
    };
    const profile = await prisma.profile.update({
      where: { userId },
      data,
    });

    return this.getProfile(userId).then((user) => ({ ...user, profile }));
  }

  async getPublicProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId, suspendedAt: null },
      select: {
        id: true,
        role: true,
        profile: { select: { displayName: true, bio: true, ratingAverage: true, ratingCount: true, serviceArea: true } },
        offers: {
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: {
            request: {
              select: {
                id: true,
                title: true,
                status: true,
                service: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
        providerBookings: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            status: true,
            request: {
              select: {
                id: true,
                title: true,
                status: true,
                service: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Provider profile not found');

    const servicesMap = new Map<string, { id: string; name: string; slug: string }>();
    for (const offer of user.offers) {
      servicesMap.set(offer.request.service.id, offer.request.service);
    }
    for (const booking of user.providerBookings) {
      servicesMap.set(booking.request.service.id, booking.request.service);
    }

    const requests = user.providerBookings.map((booking) => ({
      id: booking.request.id,
      title: booking.request.title,
      status: booking.request.status,
      service: booking.request.service,
    }));

    return {
      id: user.id,
      role: user.role,
      profile: user.profile,
      services: [...servicesMap.values()],
      requests,
    };
  }
}
