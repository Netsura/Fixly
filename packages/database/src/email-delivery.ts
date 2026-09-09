import { Prisma } from '@prisma/client';
import { prisma } from './client';

export type DeliveryClaim = {
  key: string;
  recipient: string;
  subject: string;
};

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Reserves the right to send one email.
 *
 * Exactly one caller can flip `claimedAt` from null, so concurrent workers and
 * BullMQ retries of an already-sent job return false instead of sending again.
 * A failed send releases the claim via `releaseDelivery` so the next retry can
 * pick it back up.
 */
export async function claimDelivery(claim: DeliveryClaim): Promise<boolean> {
  const now = new Date();
  try {
    await prisma.emailDelivery.create({
      data: {
        idempotencyKey: claim.key,
        recipient: claim.recipient,
        subject: claim.subject,
        claimedAt: now,
        attempts: 1,
      },
    });
    return true;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const claimed = await prisma.emailDelivery.updateMany({
    where: { idempotencyKey: claim.key, claimedAt: null, sentAt: null },
    data: { claimedAt: now, failedAt: null, attempts: { increment: 1 } },
  });
  return claimed.count === 1;
}

export async function completeDelivery(key: string) {
  await prisma.emailDelivery.updateMany({
    where: { idempotencyKey: key, sentAt: null },
    data: { sentAt: new Date() },
  });
}

export async function releaseDelivery(key: string) {
  await prisma.emailDelivery.updateMany({
    where: { idempotencyKey: key, sentAt: null },
    data: { claimedAt: null, failedAt: new Date() },
  });
}

/** Runs `send` at most once per key, releasing the claim if it throws. */
export async function sendOnce(claim: DeliveryClaim, send: () => Promise<void>) {
  if (!(await claimDelivery(claim))) {
    return { sent: false, reason: 'duplicate' as const };
  }
  try {
    await send();
    await completeDelivery(claim.key);
    return { sent: true, reason: 'delivered' as const };
  } catch (error) {
    await releaseDelivery(claim.key);
    throw error;
  }
}
