import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@fixly/config';

export type MessageEmailJob = {
  messageId: string;
  conversationId: string;
  recipientIds: string[];
};

export type TransactionalEmailJob = {
  to: string;
  subject: string;
  text: string;
  /** Claimed in EmailDelivery so a retried job cannot send the mail twice. */
  idempotencyKey: string;
};

export type NotificationJob = {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  /** Unique per intended notification; enforced by both BullMQ and Postgres. */
  dedupeKey: string;
};

const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800, count: 5000 },
} as const;

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  private readonly emailQueue = new Queue('email', { connection: this.connection });
  private readonly notificationQueue = new Queue('notifications', { connection: this.connection });

  enqueueMessageEmail(data: MessageEmailJob) {
    return this.emailQueue.add('message-email', data, {
      ...JOB_OPTIONS,
      jobId: `message-email:${data.messageId}`,
    });
  }

  enqueueTransactionalEmail(data: TransactionalEmailJob) {
    return this.emailQueue.add('transactional-email', data, {
      ...JOB_OPTIONS,
      jobId: `transactional-email:${data.idempotencyKey}`,
    });
  }

  enqueueNotification(data: NotificationJob) {
    return this.notificationQueue.add('notification', data, {
      ...JOB_OPTIONS,
      jobId: `notification:${data.dedupeKey}`,
    });
  }

  async onModuleDestroy() {
    await Promise.all([this.emailQueue.close(), this.notificationQueue.close()]);
    await this.connection.quit();
  }
}
