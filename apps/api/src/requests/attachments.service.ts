import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, UserRole } from '@fixly/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LocalStorageService } from '../storage/local-storage.service';

export type UploadedImage = { buffer: Buffer; mimetype: string; size: number };

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly storage: LocalStorageService) {}

  async upload(user: AuthenticatedUser, requestId: string, file: UploadedImage) {
    if (!file) throw new ForbiddenException('An image file is required');
    const sniffed = detectImageMime(file.buffer);
    if (!sniffed || sniffed !== file.mimetype) {
      throw new ForbiddenException('File content does not match an allowed image type');
    }
    const extension = allowedTypes.get(file.mimetype);
    if (!extension || file.size > 5 * 1024 * 1024) {
      throw new ForbiddenException('Only JPG, PNG, or WebP images up to 5MB are allowed');
    }
    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { customerId: true } });
    if (!request || request.customerId !== user.id) throw new NotFoundException('Request not found');
    const objectKey = await this.storage.put(file.buffer, extension);
    try {
      return await prisma.requestAttachment.create({
        data: { requestId, objectKey, mediaType: file.mimetype, sizeBytes: file.size },
      });
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async read(user: AuthenticatedUser, requestId: string, attachmentId: string) {
    const request = await prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        customerId: true,
        status: true,
        offers: { where: { providerId: user.id }, select: { id: true } },
        booking: { select: { providerId: true } },
      },
    });
    const attachment = await prisma.requestAttachment.findFirst({ where: { id: attachmentId, requestId } });
    if (!request || !attachment) throw new NotFoundException('Attachment not found');

    const isOwner = request.customerId === user.id;
    const isAssignedProvider = request.booking?.providerId === user.id;
    const hasOffer = request.offers.length > 0;
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isOwner && !isAssignedProvider && !hasOffer && !isAdmin) {
      throw new ForbiddenException('Attachment access denied');
    }

    return { buffer: await this.storage.read(attachment.objectKey), mediaType: attachment.mediaType };
  }
}
