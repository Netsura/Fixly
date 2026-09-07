import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@fixly/config';
import { prisma, Prisma } from '@fixly/database';

type MessageEmailJob = {
  messageId: string;
  conversationId: string;
  recipientIds: string[];
};

type NotificationJob = {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
};

class EmailProvider {
  async send(to: string[], subject: string, data: Record<string, unknown>) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Production email provider is not configured');
    }
    console.log(JSON.stringify({ event: 'email.sent', provider: 'console', to, subject, data }));
  }
}

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const emailProvider = new EmailProvider();
const emailWorker = new Worker<MessageEmailJob>('email', async (job: Job<MessageEmailJob>) => {
  const recipients = await prisma.user.findMany({ where: { id: { in: job.data.recipientIds } }, select: { email: true } });
  const message = await prisma.message.findUnique({ where: { id: job.data.messageId }, select: { body: true } });
  if (!recipients.length || !message) return;
  await emailProvider.send(recipients.map((recipient) => recipient.email), 'New Fixly message', {
    conversationId: job.data.conversationId,
    preview: message.body.slice(0, 160),
  });
}, { connection: connection.duplicate(), concurrency: 10 });

const notificationWorker = new Worker<NotificationJob>('notifications', async (job: Job<NotificationJob>) => {
  await prisma.notification.create({ data: { userId: job.data.userId, type: job.data.type, payload: job.data.payload as Prisma.InputJsonValue } });
}, { connection: connection.duplicate(), concurrency: 20 });

const cleanupQueue = new Queue('cleanup', { connection });
const cleanupWorker = new Worker('cleanup', async () => {
  const result = await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.log(JSON.stringify({ event: 'cleanup.expired_sessions', deleted: result.count }));
}, { connection: connection.duplicate(), concurrency: 1 });

void cleanupQueue.add('expired-auth-sessions', {}, {
  jobId: 'expired-auth-sessions',
  repeat: { every: 60 * 60 * 1000 },
  removeOnComplete: true,
  removeOnFail: { age: 604_800, count: 100 },
});

console.log(JSON.stringify({ service: 'worker', status: 'ready', queues: ['email', 'notifications', 'cleanup'] }));

const shutdown = async () => {
  await Promise.all([emailWorker.close(), notificationWorker.close(), cleanupWorker.close(), cleanupQueue.close()]);
  await prisma.$disconnect();
  await connection.quit();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
