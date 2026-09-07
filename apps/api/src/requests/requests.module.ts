import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [AuthModule],
  controllers: [AttachmentsController, RequestsController],
  providers: [AttachmentsService, RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
