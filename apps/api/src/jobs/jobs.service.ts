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
};

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  private readonly emailQueue = new Queue('email', { connection: this.connection });

  enqueueMessageEmail(data: MessageEmailJob) {
    return this.emailQueue.add('message-email', data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 5000 },
    });
  }

  enqueueTransactionalEmail(data: TransactionalEmailJob) {
    return this.emailQueue.add('transactional-email', data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800, count: 5000 },
    });
  }

  async onModuleDestroy() {
    await this.emailQueue.close();
    await this.connection.quit();
  }
}
