import Stripe from 'stripe';
import {
  BookingStatus,
  bookingSourcesFor,
  canTransitionPayment,
  PaymentStatus,
  paymentSourcesFor,
  prisma,
  RequestStatus,
  requestSourcesFor,
} from '@fixly/database';
import { env } from '@fixly/config';

/** Only look at intents old enough that a webhook should already have landed. */
const STALE_AFTER_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;

const INTENT_STATUS_MAP: Record<string, PaymentStatus | undefined> = {
  succeeded: PaymentStatus.SUCCEEDED,
  canceled: PaymentStatus.FAILED,
  requires_payment_method: PaymentStatus.FAILED,
};

export type ReconciliationResult = {
  checked: number;
  repaired: number;
  skipped: number;
};

/**
 * Reconciles local payment rows against Stripe.
 *
 * Webhooks can be lost or dropped, which leaves a payment PENDING in Postgres
 * while Stripe has already charged the customer. This walks stale rows and
 * applies the authoritative Stripe status through the same guarded transitions
 * the webhook handler uses.
 */
export async function reconcilePayments(stripe: Stripe): Promise<ReconciliationResult> {
  const stale = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PENDING,
      createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      // Dev-mode payments never existed in Stripe.
      stripePaymentIntentId: { not: { startsWith: 'dev_pi_' } },
    },
    select: { id: true, stripePaymentIntentId: true, bookingId: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  let repaired = 0;
  let skipped = 0;

  for (const payment of stale) {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    } catch (error) {
      skipped += 1;
      console.error(JSON.stringify({
        event: 'reconcile.stripe_lookup_failed',
        paymentId: payment.id,
        message: error instanceof Error ? error.message : 'unknown error',
      }));
      continue;
    }

    const target = INTENT_STATUS_MAP[intent.status];
    if (!target || !canTransitionPayment(PaymentStatus.PENDING, target)) {
      skipped += 1;
      continue;
    }

    const applied = await applyStatus(payment.id, payment.bookingId, target);
    if (applied) {
      repaired += 1;
      console.log(JSON.stringify({
        event: 'reconcile.payment_repaired',
        paymentId: payment.id,
        intentStatus: intent.status,
        status: target,
      }));
    } else {
      skipped += 1;
    }
  }

  return { checked: stale.length, repaired, skipped };
}

async function applyStatus(paymentId: string, bookingId: string, status: PaymentStatus) {
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.payment.updateMany({
      where: { id: paymentId, status: { in: paymentSourcesFor(status) } },
      data: { status },
    });
    if (updated.count !== 1) return false;

    if (status === PaymentStatus.SUCCEEDED) {
      await transaction.booking.updateMany({
        where: { id: bookingId, status: { in: bookingSourcesFor(BookingStatus.PAID) } },
        data: { status: BookingStatus.PAID },
      });
      await transaction.serviceRequest.updateMany({
        where: { booking: { id: bookingId }, status: { in: requestSourcesFor(RequestStatus.PAID) } },
        data: { status: RequestStatus.PAID },
      });
    }
    return true;
  });
}

/**
 * Flags webhook claims that were recorded but never marked processed, which
 * means a handler crashed mid-transaction and the event needs manual review.
 */
export async function reportUnprocessedWebhooks() {
  const stuck = await prisma.paymentWebhookEvent.count({
    where: { processedAt: null, receivedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
  });
  if (stuck > 0) {
    console.error(JSON.stringify({ event: 'reconcile.unprocessed_webhooks', count: stuck }));
  }
  return stuck;
}

export function createStripeClient() {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}
