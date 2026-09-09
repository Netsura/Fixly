import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { StorageModule } from '../storage/storage.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [AuthModule, ConversationsModule, StorageModule],
  controllers: [RequestsController, AttachmentsController],
  providers: [RequestsService, AttachmentsService],
})
export class RequestsModule {}
