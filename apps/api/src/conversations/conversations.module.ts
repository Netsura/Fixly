import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService } from './conversations.service';
import { PresenceService } from './presence.service';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [ConversationsController],
  providers: [ConversationsGateway, ConversationsService, PresenceService],
  exports: [ConversationsService, PresenceService],
})
export class ConversationsModule {}
