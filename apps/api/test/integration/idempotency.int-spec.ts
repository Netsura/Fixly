import { INestApplication } from '@nestjs/common';
import type Stripe from 'stripe';
import {
  BookingStatus,
  PaymentStatus,
  prisma,
  RequestStatus,
  sendOnce,
} from '@fixly/database';
import { env } from '@fixly/config';
import { JobsService } from '../../src/jobs/jobs.service';
import { PaymentsService } from '../../src/payments/payments.service';
import {
  clearRateLimits,
  closeRateLimitRedis,
  createPaidBooking,
  createTestApp,
  futureDate,
  resetDatabase,
} from './harness';

type WebhookStub = {
  webhooks: { constructEvent: (body: Buffer, signature: string, secret: string) => Stripe.Event };
  paymentIntents: { retrieve: (id: string) => Promise<Stripe.PaymentIntent> };
};

/**
 * Signature verification is Stripe's job and is covered by their library, so
 * the stub returns a pre-built event and the tests focus on what we own:
 * exactly-once application of its side effects.
 */
function stubStripe(service: PaymentsService, event: Stripe.Event) {
  const stub: WebhookStub = {
    webhooks: { constructEvent: () => event },
    paymentIntents: { retrieve: async () => event.data.object as Stripe.PaymentIntent },
  };
  Reflect.set(service, 'stripe', stub);
}

function paymentIntentEvent(
  id: string,
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
  intentId: string,
) {
  return {
    id,
    type,
    data: { object: { id: intentId, status: 'succeeded', metadata: {} } },
  } as unknown as Stripe.Event;
}

describe('idempotency', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await clearRateLimits();
  });

  afterAll(async () => {
    await app.close();
    await closeRateLimitRedis();
  });

  describe('stripe webhooks', () => {
    // Webhook handling is gated on Stripe being configured. The suite stubs the
    // client per test and restores it afterwards, because `confirmDevPayment`
    // (used to build fixtures) deliberately refuses to run when Stripe is live.
    let originalStripe: unknown;
    let originalWebhookSecret: string | undefined;

    beforeEach(() => {
      const service = app.get(PaymentsService);
      originalStripe = Reflect.get(service, 'stripe');
      originalWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
      Reflect.set(env, 'STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');
    });

    afterEach(() => {
      Reflect.set(app.get(PaymentsService), 'stripe', originalStripe);
      Reflect.set(env, 'STRIPE_WEBHOOK_SECRET', originalWebhookSecret);
    });

    async function pendingPayment() {
      const { bookingId, customer } = await createPaidBooking(app);
      // Rewind to the pre-payment state so the webhook has work to do.
      await prisma.payment.updateMany({ where: { bookingId }, data: { status: PaymentStatus.PENDING } });
      await prisma.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.PAYMENT_PENDING } });
      const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
      await prisma.serviceRequest.updateMany({
        where: { booking: { id: bookingId } },
        data: { status: RequestStatus.PAYMENT_PENDING },
      });
      return { bookingId, payment, customer };
    }

    it('applies a payment_intent.succeeded event exactly once', async () => {
      const { bookingId, payment } = await pendingPayment();
      const service = app.get(PaymentsService);
      const event = paymentIntentEvent('evt_once', 'payment_intent.succeeded', payment.stripePaymentIntentId);
      stubStripe(service, event);

      const first = await service.handleWebhook(Buffer.from('{}'), 'sig');
      expect(first).toEqual({ received: true, duplicate: false });

      const second = await service.handleWebhook(Buffer.from('{}'), 'sig');
      expect(second).toEqual({ received: true, duplicate: true });

      expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_once' } })).toBe(1);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe(BookingStatus.PAID);
    });

    it('records only one event row when the same delivery arrives concurrently', async () => {
      const { payment } = await pendingPayment();
      const service = app.get(PaymentsService);
      stubStripe(service, paymentIntentEvent('evt_race', 'payment_intent.succeeded', payment.stripePaymentIntentId));

      const results = await Promise.all([
        service.handleWebhook(Buffer.from('{}'), 'sig'),
        service.handleWebhook(Buffer.from('{}'), 'sig'),
        service.handleWebhook(Buffer.from('{}'), 'sig'),
      ]);

      expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
      expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_race' } })).toBe(1);
    });

    it('leaves no event row behind when the handler fails', async () => {
      const { payment } = await pendingPayment();
      const service = app.get(PaymentsService);
      const event = paymentIntentEvent('evt_fail', 'payment_intent.succeeded', payment.stripePaymentIntentId);
      stubStripe(service, event);

      const applyEvent = jest
        .spyOn(service as unknown as { applyEvent: () => Promise<void> }, 'applyEvent')
        .mockRejectedValueOnce(new Error('downstream exploded'));

      await expect(service.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow('downstream exploded');
      // The claim rolled back with the side effects, so Stripe's retry can work.
      expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_fail' } })).toBe(0);

      applyEvent.mockRestore();
      const retry = await service.handleWebhook(Buffer.from('{}'), 'sig');
      expect(retry).toEqual({ received: true, duplicate: false });
      expect(await prisma.paymentWebhookEvent.count({ where: { eventId: 'evt_fail' } })).toBe(1);
    });

    it('rejects a webhook with no signature', async () => {
      const service = app.get(PaymentsService);
      await expect(service.handleWebhook(Buffer.from('{}'), undefined)).rejects.toThrow();
    });
  });

  describe('dev payment confirmation', () => {
    it('is safe to call twice', async () => {
      const { bookingId, customer } = await createPaidBooking(app);
      const repeat = await customer.send('post', '/api/payments/dev-confirm', { body: { bookingId } });

      // The booking already moved past PAYMENT_PENDING, so the second attempt
      // is refused rather than double-charging.
      expect(repeat.status).toBe(409);
      expect(await prisma.payment.count({ where: { bookingId } })).toBe(1);
    });
  });

  describe('email delivery', () => {
    it('sends only once for a given key', async () => {
      let sends = 0;
      const claim = { key: 'welcome:1', recipient: 'a@fixly.test', subject: 'Welcome' };
      const send = async () => { sends += 1; };

      expect(await sendOnce(claim, send)).toEqual({ sent: true, reason: 'delivered' });
      expect(await sendOnce(claim, send)).toEqual({ sent: false, reason: 'duplicate' });
      expect(sends).toBe(1);
    });

    it('sends once when workers race on the same key', async () => {
      let sends = 0;
      const claim = { key: 'welcome:race', recipient: 'a@fixly.test', subject: 'Welcome' };
      const send = async () => { sends += 1; };

      const results = await Promise.all([sendOnce(claim, send), sendOnce(claim, send), sendOnce(claim, send)]);
      expect(results.filter((result) => result.sent)).toHaveLength(1);
      expect(sends).toBe(1);
    });

    it('releases the claim so a failed send can be retried', async () => {
      const claim = { key: 'welcome:retry', recipient: 'a@fixly.test', subject: 'Welcome' };
      await expect(sendOnce(claim, async () => { throw new Error('smtp down'); })).rejects.toThrow('smtp down');

      const afterFailure = await prisma.emailDelivery.findUniqueOrThrow({ where: { idempotencyKey: claim.key } });
      expect(afterFailure.sentAt).toBeNull();
      expect(afterFailure.failedAt).not.toBeNull();

      let sends = 0;
      expect(await sendOnce(claim, async () => { sends += 1; })).toEqual({ sent: true, reason: 'delivered' });
      expect(sends).toBe(1);

      const afterRetry = await prisma.emailDelivery.findUniqueOrThrow({ where: { idempotencyKey: claim.key } });
      expect(afterRetry.sentAt).not.toBeNull();
      expect(afterRetry.attempts).toBe(2);
    });
  });

  describe('notification dedupe', () => {
    it('refuses a second notification with the same dedupe key', async () => {
      const { customer } = await createPaidBooking(app);
      const data = {
        userId: customer.userId,
        type: 'BOOKING_UPDATE',
        payload: {},
        dedupeKey: 'BOOKING_UPDATE:test',
      };

      await prisma.notification.create({ data });
      await expect(prisma.notification.create({ data })).rejects.toThrow();
      expect(await prisma.notification.count({ where: { dedupeKey: data.dedupeKey } })).toBe(1);
    });

    it('enqueues one notification job per booking transition', async () => {
      const { bookingId, customer, provider } = await createPaidBooking(app);
      const jobs = app.get(JobsService);
      const enqueue = jest.spyOn(jobs, 'enqueueNotification');

      await customer.send('patch', `/api/bookings/${bookingId}/schedule`, {
        body: { scheduledAt: futureDate(24) },
      });
      await provider.send('patch', `/api/bookings/${bookingId}/start`);

      const keys = enqueue.mock.calls.map(([job]) => job.dedupeKey);
      expect(keys).toEqual([
        `BOOKING_STATUS:${bookingId}:SCHEDULED`,
        `BOOKING_STATUS:${bookingId}:IN_PROGRESS`,
      ]);

      // The counterparty is notified, never the actor.
      expect(enqueue.mock.calls[0]?.[0].userId).toBe(provider.userId);
      expect(enqueue.mock.calls[1]?.[0].userId).toBe(customer.userId);
      enqueue.mockRestore();
    });

    it('does not retry a transition notification that already exists', async () => {
      const { bookingId, customer, provider } = await createPaidBooking(app);
      await customer.send('patch', `/api/bookings/${bookingId}/schedule`, {
        body: { scheduledAt: futureDate(24) },
      });

      // A repeat of the same transition is refused, so no second job is queued.
      const repeat = await provider.send('patch', `/api/bookings/${bookingId}/schedule`, {
        body: { scheduledAt: futureDate(48) },
      });
      expect(repeat.status).toBe(409);
    });

    it('creates one notification per recipient when a message is sent twice', async () => {
      const { bookingId, customer, provider } = await createPaidBooking(app);
      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { bookingId } });

      await customer.send('post', `/api/conversations/${conversation.id}/messages`, {
        body: { body: 'Hello there, are we still on for tomorrow?' },
      });
      await customer.send('post', `/api/conversations/${conversation.id}/messages`, {
        body: { body: 'Hello there, are we still on for tomorrow?' },
      });

      const notifications = await prisma.notification.findMany({
        where: { userId: provider.userId, type: 'NEW_MESSAGE' },
      });
      // Two distinct messages, so two notifications - each with its own key.
      expect(notifications).toHaveLength(2);
      expect(new Set(notifications.map((entry) => entry.dedupeKey)).size).toBe(2);
    });
  });
});
