import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { BookingsModule } from './bookings/bookings.module';
import { ConversationsModule } from './conversations/conversations.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { RequestsModule } from './requests/requests.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ServicesModule } from './services/services.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { OriginCheckMiddleware } from './common/origin-check.middleware';
import { RateLimitGuard } from './common/rate-limit.guard';

@Module({
  imports: [
    AdminModule,
    AuthModule,
    BookingsModule,
    ConversationsModule,
    HealthModule,
    JobsModule,
    NotificationsModule,
    OffersModule,
    PaymentsModule,
    ReportsModule,
    RequestsModule,
    ReviewsModule,
    ServicesModule,
    StorageModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('*');
  }
}
