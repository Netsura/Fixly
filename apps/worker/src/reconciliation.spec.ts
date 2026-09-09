import type Stripe from 'stripe';
import { BookingStatus, OfferStatus, PaymentStatus, prisma, RequestStatus } from '@fixly/database';
import { reconcilePayments, reportUnprocessedWebhooks } from './reconciliation';

/** Older than the reconciler's staleness window, so rows are eligible. */
const STALE = new Date(Date.now() - 60 * 60 * 1000);

function stripeReturning(status: Stripe.PaymentIntent.Status | 'unknown') {
  const retrieve = jest.fn(async (id: string) => ({ id, status }) as Stripe.PaymentIntent);
  return { stub: { paymentIntents: { retrieve } } as unknown as Stripe, retrieve };
}

function failingStripe() {
  const retrieve = jest.fn(async () => {
    throw new Error('stripe unreachable');
  });
  return { stub: { paymentIntents: { retrieve } } as unknown as Stripe, retrieve };
}

async function seedPendingPayment(intentId: string, createdAt = STALE) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const customer = await prisma.user.create({
    data: { email: `customer-${suffix}@fixly.test`, passwordHash: 'x', role: 'CUSTOMER' },
  });
  const provider = await prisma.user.create({
    data: { email: `provider-${suffix}@fixly.test`, passwordHash: 'x', role: 'PROVIDER' },
  });
  const category = await prisma.serviceCategory.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const service = await prisma.service.create({
    data: { categoryId: category.id, name: `Svc ${suffix}`, slug: `svc-${suffix}` },
  });
  const request = await prisma.serviceRequest.create({
    data: {
      customerId: customer.id,
      serviceId: service.id,
      title: 'Reconciliation fixture',
      description: 'A request used to exercise payment reconciliation.',
      locationHash: 'geo-test',
      preferredStart: new Date(),
      preferredEnd: new Date(Date.now() + 3_600_000),
      status: RequestStatus.PAYMENT_PENDING,
    },
  });
  const offer = await prisma.offer.create({
    data: {
      requestId: request.id,
      providerId: provider.id,
      priceCents: 5000,
      message: 'Fixture offer',
      availableAt: new Date(),
      status: OfferStatus.ACCEPTED,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      requestId: request.id,
      offerId: offer.id,
      customerId: customer.id,
      providerId: provider.id,
      status: BookingStatus.PAYMENT_PENDING,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: intentId,
      amountCents: 5000,
      currency: 'usd',
      idempotencyKey: `key-${suffix}`,
      status: PaymentStatus.PENDING,
      createdAt,
    },
  });
  return { payment, booking, request };
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "Report", "Review", "PaymentWebhookEvent", "Payment", "EmailDelivery",
      "Message", "ConversationParticipant", "Conversation", "Booking", "Offer",
      "RequestAttachment", "ServiceRequest", "Notification", "AuthToken", "AuthSession",
      "Profile", "User", "Service", "ServiceCategory"
    RESTART IDENTITY CASCADE
  `);
}

describe('payment reconciliation', () => {
  beforeEach(resetDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('settles a payment that Stripe already succeeded', async () => {
    const { payment, booking, request } = await seedPendingPayment('pi_succeeded');
    const { stub } = stripeReturning('succeeded');

    const result = await reconcilePayments(stub);
    expect(result).toEqual({ checked: 1, repaired: 1, skipped: 0 });

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status)
      .toBe(PaymentStatus.SUCCEEDED);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status)
      .toBe(BookingStatus.PAID);
    expect((await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status)
      .toBe(RequestStatus.PAID);
  });

  it('fails a payment that Stripe cancelled', async () => {
    const { payment, booking } = await seedPendingPayment('pi_canceled');
    const { stub } = stripeReturning('canceled');

    expect(await reconcilePayments(stub)).toEqual({ checked: 1, repaired: 1, skipped: 0 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status)
      .toBe(PaymentStatus.FAILED);
    // A failed payment must not advance the booking.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status)
      .toBe(BookingStatus.PAYMENT_PENDING);
  });

  it('leaves a payment alone while Stripe still shows it in flight', async () => {
    const { payment } = await seedPendingPayment('pi_processing');
    const { stub } = stripeReturning('processing');

    expect(await reconcilePayments(stub)).toEqual({ checked: 1, repaired: 0, skipped: 1 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status)
      .toBe(PaymentStatus.PENDING);
  });

  it('ignores payments too recent for a webhook to be considered lost', async () => {
    const { retrieve, stub } = stripeReturning('succeeded');
    await seedPendingPayment('pi_fresh', new Date());

    expect(await reconcilePayments(stub)).toEqual({ checked: 0, repaired: 0, skipped: 0 });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('ignores dev-mode payments that never existed in Stripe', async () => {
    const { retrieve, stub } = stripeReturning('succeeded');
    await seedPendingPayment('dev_pi_local');

    expect(await reconcilePayments(stub)).toEqual({ checked: 0, repaired: 0, skipped: 0 });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('is a no-op on a second pass once a payment has settled', async () => {
    await seedPendingPayment('pi_twice');
    const { stub } = stripeReturning('succeeded');

    expect((await reconcilePayments(stub)).repaired).toBe(1);
    expect(await reconcilePayments(stub)).toEqual({ checked: 0, repaired: 0, skipped: 0 });
  });

  it('skips a payment when the Stripe lookup fails and leaves it for the next pass', async () => {
    const { payment } = await seedPendingPayment('pi_error');
    const { stub } = failingStripe();

    expect(await reconcilePayments(stub)).toEqual({ checked: 1, repaired: 0, skipped: 1 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status)
      .toBe(PaymentStatus.PENDING);
  });

  it('counts webhook claims that were never marked processed', async () => {
    await prisma.paymentWebhookEvent.create({
      data: {
        eventId: 'evt_stuck',
        eventType: 'payment_intent.succeeded',
        receivedAt: STALE,
        processedAt: null,
      },
    });
    await prisma.paymentWebhookEvent.create({
      data: {
        eventId: 'evt_done',
        eventType: 'payment_intent.succeeded',
        receivedAt: STALE,
        processedAt: new Date(),
      },
    });

    expect(await reportUnprocessedWebhooks()).toBe(1);
  });
});
