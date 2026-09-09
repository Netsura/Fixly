import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import Stripe from 'stripe';
import { BookingStatus, PaymentStatus, prisma, RequestStatus } from '@fixly/database';
import { env } from '@fixly/config';

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

    const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
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
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        const payment = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey } });
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

    const existingEvent = await prisma.paymentWebhookEvent.findUnique({ where: { eventId: event.id } });
    if (existingEvent) return { received: true, duplicate: true };

    if (event.type === 'payment_intent.succeeded') {
      await this.markSucceeded(event.data.object as Stripe.PaymentIntent);
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.markFailed(event.data.object as Stripe.PaymentIntent);
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      if (typeof charge.payment_intent === 'string') await this.markRefunded(charge.payment_intent);
    }
    try {
      await prisma.paymentWebhookEvent.create({ data: { eventId: event.id, eventType: event.type } });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('Unique constraint'))) throw error;
      return { received: true, duplicate: true };
    }
    return { received: true, duplicate: false };
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

  private async markSucceeded(intent: Stripe.PaymentIntent) {
    const bookingId = intent.metadata.bookingId;
    if (!bookingId) return;
    await prisma.$transaction(async (transaction) => {
      const payment = await transaction.payment.findUnique({ where: { stripePaymentIntentId: intent.id } });
      if (!payment || payment.status === PaymentStatus.SUCCEEDED) return;
      await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.SUCCEEDED } });
      await transaction.booking.updateMany({ where: { id: bookingId, status: BookingStatus.PAYMENT_PENDING }, data: { status: BookingStatus.PAID } });
      await transaction.serviceRequest.updateMany({
        where: { booking: { id: bookingId }, status: { in: [RequestStatus.PROVIDER_SELECTED, RequestStatus.PAYMENT_PENDING] } },
        data: { status: RequestStatus.PAID },
      });
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
      await transaction.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.PAID } });
      await transaction.serviceRequest.update({
        where: { id: booking.requestId },
        data: { status: RequestStatus.PAID },
      });
      return payment;
    });
  }

  private async markFailed(intent: Stripe.PaymentIntent) {
    await prisma.payment.updateMany({ where: { stripePaymentIntentId: intent.id }, data: { status: PaymentStatus.FAILED } });
  }

  private async markRefunded(paymentIntentId: string) {
    await prisma.payment.updateMany({ where: { stripePaymentIntentId: paymentIntentId }, data: { status: PaymentStatus.REFUNDED } });
  }
}
