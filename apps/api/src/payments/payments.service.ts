import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import Stripe from 'stripe';
import {
  BookingStatus,
  bookingSourcesFor,
  canTransitionPayment,
  PaymentStatus,
  paymentSourcesFor,
  Prisma,
  prisma,
  RequestStatus,
  requestSourcesFor,
} from '@fixly/database';
import { env } from '@fixly/config';
import { isUniqueConstraintError } from '../common/prisma-errors';

@Injectable()
export class PaymentsService {
  private readonly stripe = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY)
    : null;

  async createPaymentIntent(customerId: string, bookingId: string, idempotencyKey: string | undefined) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe payments are not configured');
    }
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 255) {
      throw new ConflictException('A valid Idempotency-Key header is required');
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { offer: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!booking || booking.customerId !== customerId) {
      throw new NotFoundException('Booking not found');
    }
    if (!([BookingStatus.PAYMENT_PENDING] as BookingStatus[]).includes(booking.status)) {
      throw new ConflictException('Booking is not awaiting payment');
    }

    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { booking: { select: { customerId: true } } },
    });
    if (existing) {
      if (existing.booking.customerId !== customerId) {
        throw new NotFoundException('Booking not found');
      }
      return { paymentId: existing.id, clientSecret: await this.getClientSecret(existing.stripePaymentIntentId), status: existing.status };
    }
    if (booking.payments.some((payment) => payment.status === PaymentStatus.SUCCEEDED)) {
      throw new ConflictException('Booking has already been paid');
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: booking.offer.priceCents,
      currency: 'usd',
      metadata: { bookingId: booking.id, customerId },
      automatic_payment_methods: { enabled: true },
    }, { idempotencyKey });

    try {
      const payment = await prisma.payment.create({
        data: {
          bookingId: booking.id,
          stripePaymentIntentId: paymentIntent.id,
          amountCents: booking.offer.priceCents,
          currency: paymentIntent.currency,
          idempotencyKey,
          status: PaymentStatus.PENDING,
        },
      });
      return { paymentId: payment.id, clientSecret: paymentIntent.client_secret, status: payment.status };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const payment = await prisma.payment.findUniqueOrThrow({
          where: { idempotencyKey },
          include: { booking: { select: { customerId: true } } },
        });
        if (payment.booking.customerId !== customerId) {
          throw new NotFoundException('Booking not found');
        }
        return { paymentId: payment.id, clientSecret: await this.getClientSecret(payment.stripePaymentIntentId), status: payment.status };
      }
      throw error;
    }
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!this.stripe || !env.STRIPE_WEBHOOK_SECRET || !signature) {
      throw new UnauthorizedException('Stripe webhook is not configured');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    // The dedupe claim and the side effects share one transaction: a concurrent
    // redelivery blocks on the unique index and then rolls back entirely, and a
    // failed handler releases the claim so Stripe's retry can reprocess.
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.paymentWebhookEvent.create({
          data: { eventId: event.id, eventType: event.type, processedAt: new Date() },
        });
        await this.applyEvent(transaction, event);
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'event_id')) {
        return { received: true, duplicate: true };
      }
      throw error;
    }
    return { received: true, duplicate: false };
  }

  private async applyEvent(transaction: Prisma.TransactionClient, event: Stripe.Event) {
    if (event.type === 'payment_intent.succeeded') {
      await this.markSucceeded(transaction, event.data.object as Stripe.PaymentIntent);
      return;
    }
    if (event.type === 'payment_intent.payment_failed') {
      await this.markFailed(transaction, event.data.object as Stripe.PaymentIntent);
      return;
    }
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      if (typeof charge.payment_intent === 'string') {
        await this.markRefunded(transaction, charge.payment_intent);
      }
    }
  }

  async getPayment(customerId: string, paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
    if (!payment || payment.booking.customerId !== customerId) throw new NotFoundException('Payment not found');
    return payment;
  }

  private async getClientSecret(paymentIntentId: string) {
    const intent = await this.stripe!.paymentIntents.retrieve(paymentIntentId);
    return intent.client_secret;
  }

  private async markSucceeded(transaction: Prisma.TransactionClient, intent: Stripe.PaymentIntent) {
    const payment = await transaction.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
      select: { id: true, status: true, bookingId: true },
    });
    if (!payment || !canTransitionPayment(payment.status, PaymentStatus.SUCCEEDED)) return;

    await transaction.payment.updateMany({
      where: { id: payment.id, status: { in: paymentSourcesFor(PaymentStatus.SUCCEEDED) } },
      data: { status: PaymentStatus.SUCCEEDED },
    });
    await transaction.booking.updateMany({
      where: { id: payment.bookingId, status: { in: bookingSourcesFor(BookingStatus.PAID) } },
      data: { status: BookingStatus.PAID },
    });
    await transaction.serviceRequest.updateMany({
      where: { booking: { id: payment.bookingId }, status: { in: requestSourcesFor(RequestStatus.PAID) } },
      data: { status: RequestStatus.PAID },
    });
  }

  async confirmDevPayment(customerId: string, bookingId: string) {
    if (this.stripe || env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Development payment confirmation is unavailable');
    }
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { offer: true },
    });
    if (!booking || booking.customerId !== customerId) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status !== BookingStatus.PAYMENT_PENDING) {
      throw new ConflictException('Booking is not awaiting payment');
    }

    return prisma.$transaction(async (transaction) => {
      const payment = await transaction.payment.upsert({
        where: { idempotencyKey: `dev-${bookingId}` },
        create: {
          bookingId,
          stripePaymentIntentId: `dev_pi_${bookingId}`,
          amountCents: booking.offer.priceCents,
          currency: 'usd',
          idempotencyKey: `dev-${bookingId}`,
          status: PaymentStatus.SUCCEEDED,
        },
        update: { status: PaymentStatus.SUCCEEDED },
      });
      const paid = await transaction.booking.updateMany({
        where: { id: bookingId, status: { in: bookingSourcesFor(BookingStatus.PAID) } },
        data: { status: BookingStatus.PAID },
      });
      if (paid.count !== 1) {
        throw new ConflictException('Booking state changed concurrently');
      }
      await transaction.serviceRequest.updateMany({
        where: { id: booking.requestId, status: { in: requestSourcesFor(RequestStatus.PAID) } },
        data: { status: RequestStatus.PAID },
      });
      return payment;
    });
  }

  private async markFailed(transaction: Prisma.TransactionClient, intent: Stripe.PaymentIntent) {
    await transaction.payment.updateMany({
      where: { stripePaymentIntentId: intent.id, status: { in: paymentSourcesFor(PaymentStatus.FAILED) } },
      data: { status: PaymentStatus.FAILED },
    });
  }

  private async markRefunded(transaction: Prisma.TransactionClient, paymentIntentId: string) {
    const payment = await transaction.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, bookingId: true },
    });
    if (!payment) return;

    const refunded = await transaction.payment.updateMany({
      where: { id: payment.id, status: { in: paymentSourcesFor(PaymentStatus.REFUNDED) } },
      data: { status: PaymentStatus.REFUNDED },
    });
    if (refunded.count !== 1) return;

    // A refund unwinds the job: cancel the booking and its request when they
    // have not already reached a terminal state.
    await transaction.booking.updateMany({
      where: { id: payment.bookingId, status: { in: bookingSourcesFor(BookingStatus.CANCELLED) } },
      data: { status: BookingStatus.CANCELLED },
    });
    await transaction.serviceRequest.updateMany({
      where: { booking: { id: payment.bookingId }, status: { in: requestSourcesFor(RequestStatus.CANCELLED) } },
      data: { status: RequestStatus.CANCELLED },
    });
  }
}
