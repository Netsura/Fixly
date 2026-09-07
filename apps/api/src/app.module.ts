import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ConversationsModule } from './conversations/conversations.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { RequestsModule } from './requests/requests.module';
import { ServicesModule } from './services/services.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [AdminModule, AuthModule, ConversationsModule, HealthModule, JobsModule, NotificationsModule, OffersModule, PaymentsModule, RequestsModule, ServicesModule, StorageModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
