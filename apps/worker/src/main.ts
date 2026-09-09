import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@fixly/config';
import { prisma, Prisma, sendOnce } from '@fixly/database';
import { createStripeClient, reconcilePayments, reportUnprocessedWebhooks } from './reconciliation';

type MessageEmailJob = {
  messageId: string;
  conversationId: string;
  recipientIds: string[];
};

type TransactionalEmailJob = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

type NotificationJob = {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

class EmailProvider {
  async send(to: string[], subject: string, data: Record<string, unknown>) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Production email provider is not configured');
    }
    console.log(JSON.stringify({ event: 'email.sent', provider: 'console', to, subject, data }));
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const emailProvider = new EmailProvider();

const emailWorker = new Worker('email', async (job: Job) => {
  if (job.name === 'transactional-email') {
    const data = job.data as TransactionalEmailJob;
    const result = await sendOnce(
      { key: data.idempotencyKey, recipient: data.to, subject: data.subject },
      () => emailProvider.send([data.to], data.subject, { text: data.text }),
    );
    if (!result.sent) {
      console.log(JSON.stringify({ event: 'email.skipped_duplicate', key: data.idempotencyKey }));
    }
    return;
  }

  const data = job.data as MessageEmailJob;
  const recipients = await prisma.user.findMany({ where: { id: { in: data.recipientIds } }, select: { email: true } });
  const message = await prisma.message.findUnique({ where: { id: data.messageId }, select: { body: true } });
  if (!recipients.length || !message) return;

  const result = await sendOnce(
    {
      key: `message-email:${data.messageId}`,
      recipient: recipients.map((recipient) => recipient.email).join(','),
      subject: 'New Fixly message',
    },
    () => emailProvider.send(recipients.map((recipient) => recipient.email), 'New Fixly message', {
      conversationId: data.conversationId,
      preview: message.body.slice(0, 160),
    }),
  );
  if (!result.sent) {
    console.log(JSON.stringify({ event: 'email.skipped_duplicate', key: `message-email:${data.messageId}` }));
  }
}, { connection: connection.duplicate(), concurrency: 10 });

const notificationWorker = new Worker<NotificationJob>('notifications', async (job: Job<NotificationJob>) => {
  const { userId, type, payload, dedupeKey } = job.data;
  try {
    await prisma.notification.create({
      data: {
        userId,
        type,
        payload: payload as Prisma.InputJsonValue,
        // Falls back to the BullMQ job id so older jobs without a key still
        // get a stable dedupe value across retries.
        dedupeKey: dedupeKey ?? `job:${job.id}`,
      },
    });
  } catch (error) {
    // A retry of an already-inserted notification is a success, not a failure.
    if (!isUniqueConstraintError(error)) throw error;
    console.log(JSON.stringify({ event: 'notification.skipped_duplicate', dedupeKey }));
  }
}, { connection: connection.duplicate(), concurrency: 20 });

const cleanupQueue = new Queue('cleanup', { connection });
const cleanupWorker = new Worker('cleanup', async () => {
  const cutoff = new Date();
  const [sessions, tokens] = await prisma.$transaction([
    prisma.authSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { not: null } }] } }),
  ]);
  console.log(JSON.stringify({ event: 'cleanup.expired_auth', sessions: sessions.count, tokens: tokens.count }));
}, { connection: connection.duplicate(), concurrency: 1 });

const stripe = createStripeClient();
const reconciliationQueue = new Queue('reconciliation', { connection });
const reconciliationWorker = new Worker('reconciliation', async () => {
  await reportUnprocessedWebhooks();
  if (!stripe) {
    console.log(JSON.stringify({ event: 'reconcile.skipped', reason: 'stripe_not_configured' }));
    return;
  }
  const result = await reconcilePayments(stripe);
  console.log(JSON.stringify({ event: 'reconcile.completed', ...result }));
}, { connection: connection.duplicate(), concurrency: 1 });

void cleanupQueue.add('expired-auth-sessions', {}, {
  jobId: 'expired-auth-sessions',
  repeat: { every: 60 * 60 * 1000 },
  removeOnComplete: true,
  removeOnFail: { age: 604_800, count: 100 },
});

void reconciliationQueue.add('stripe-payments', {}, {
  jobId: 'stripe-payments',
  // Runs on boot as well as on the interval, so a restart after downtime
  // catches up on webhooks missed while the worker was down.
  repeat: { every: 5 * 60 * 1000, immediately: true },
  removeOnComplete: true,
  removeOnFail: { age: 604_800, count: 100 },
});

console.log(JSON.stringify({
  service: 'worker',
  status: 'ready',
  queues: ['email', 'notifications', 'cleanup', 'reconciliation'],
  stripeReconciliation: Boolean(stripe),
}));

const shutdown = async () => {
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    cleanupWorker.close(),
    cleanupQueue.close(),
    reconciliationWorker.close(),
    reconciliationQueue.close(),
  ]);
  await prisma.$disconnect();
  await connection.quit();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
