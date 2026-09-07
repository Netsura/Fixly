import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, RequestStatus, UserRole } from '@fixly/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LocalStorageService } from '../storage/local-storage.service';

export type UploadedImage = { buffer: Buffer; mimetype: string; size: number };

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

@Injectable()
export class AttachmentsService {
  constructor(private readonly storage: LocalStorageService) {}

  async upload(user: AuthenticatedUser, requestId: string, file: UploadedImage) {
    if (!file) throw new ForbiddenException('An image file is required');
    const extension = allowedTypes.get(file.mimetype);
    if (!extension || file.size > 5 * 1024 * 1024) throw new ForbiddenException('Only JPG, PNG, or WebP images up to 5MB are allowed');
    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { customerId: true } });
    if (!request || request.customerId !== user.id) throw new NotFoundException('Request not found');
    const objectKey = await this.storage.put(file.buffer, extension);
    try {
      return await prisma.requestAttachment.create({ data: { requestId, objectKey, mediaType: file.mimetype, sizeBytes: file.size } });
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async read(user: AuthenticatedUser, requestId: string, attachmentId: string) {
    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { customerId: true, status: true } });
    const attachment = await prisma.requestAttachment.findFirst({ where: { id: attachmentId, requestId } });
    if (!request || !attachment) throw new NotFoundException('Attachment not found');
    const providerCanRead = user.role === UserRole.PROVIDER && ([RequestStatus.PUBLISHED, RequestStatus.OFFER_RECEIVED] as RequestStatus[]).includes(request.status);
    if (request.customerId !== user.id && !providerCanRead) throw new ForbiddenException('Attachment access denied');
    return { buffer: await this.storage.read(attachment.objectKey), mediaType: attachment.mediaType };
  }
}
