import { Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AttachmentsService } from './attachments.service';
import type { UploadedImage } from './attachments.service';

@Controller('requests/:requestId/attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) }))
  async upload(@CurrentUser() user: AuthenticatedUser, @Param('requestId', ParseUUIDPipe) requestId: string, @UploadedFile() file: UploadedImage) {
    return this.attachmentsService.upload(user, requestId, file);
  }

  @Get(':attachmentId')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('requestId', ParseUUIDPipe) requestId: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string) {
    const result = await this.attachmentsService.read(user, requestId, attachmentId);
    return new StreamableFile(result.buffer, { type: result.mediaType });
  }
}
