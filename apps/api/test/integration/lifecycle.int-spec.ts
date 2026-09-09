import { INestApplication } from '@nestjs/common';
import { BookingStatus, prisma, RequestStatus } from '@fixly/database';
import {
  clearRateLimits,
  closeRateLimitRedis,
  createPaidBooking,
  createTestApp,
  futureDate,
  registerUser,
  requestPayload,
  resetDatabase,
  seedService,
} from './harness';

describe('booking and request lifecycle', () => {
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

  it('walks a booking through the full happy path', async () => {
    const { bookingId, customer, provider } = await createPaidBooking(app);

    expect((await customer.send('patch', `/api/bookings/${bookingId}/schedule`, {
      body: { scheduledAt: futureDate(24) },
    })).status).toBe(200);
    expect((await provider.send('patch', `/api/bookings/${bookingId}/start`)).status).toBe(200);
    expect((await provider.send('patch', `/api/bookings/${bookingId}/complete`)).status).toBe(200);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { request: true } });
    expect(booking.status).toBe(BookingStatus.COMPLETED);
    expect(booking.request.status).toBe(RequestStatus.COMPLETED);
  });

  it('refuses to start a booking that was never scheduled', async () => {
    const { bookingId, provider } = await createPaidBooking(app);
    const response = await provider.send('patch', `/api/bookings/${bookingId}/start`);
    expect(response.status).toBe(409);
  });

  it('refuses to complete a booking that was never started', async () => {
    const { bookingId, customer, provider } = await createPaidBooking(app);
    await customer.send('patch', `/api/bookings/${bookingId}/schedule`, { body: { scheduledAt: futureDate(24) } });

    const response = await provider.send('patch', `/api/bookings/${bookingId}/complete`);
    expect(response.status).toBe(409);
  });

  it('does not let a customer start the job', async () => {
    const { bookingId, customer } = await createPaidBooking(app);
    await customer.send('patch', `/api/bookings/${bookingId}/schedule`, { body: { scheduledAt: futureDate(24) } });

    const response = await customer.send('patch', `/api/bookings/${bookingId}/start`);
    expect(response.status).toBe(403);
  });

  it('refuses to cancel a job already in progress', async () => {
    const { bookingId, customer, provider } = await createPaidBooking(app);
    await customer.send('patch', `/api/bookings/${bookingId}/schedule`, { body: { scheduledAt: futureDate(24) } });
    await provider.send('patch', `/api/bookings/${bookingId}/start`);

    const response = await customer.send('patch', `/api/bookings/${bookingId}/cancel`);
    expect(response.status).toBe(409);
  });

  it('lets only one of two concurrent completions through', async () => {
    const { bookingId, customer, provider } = await createPaidBooking(app);
    await customer.send('patch', `/api/bookings/${bookingId}/schedule`, { body: { scheduledAt: futureDate(24) } });
    await provider.send('patch', `/api/bookings/${bookingId}/start`);

    const results = await Promise.all([
      provider.send('patch', `/api/bookings/${bookingId}/complete`),
      customer.send('patch', `/api/bookings/${bookingId}/complete`),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  });

  it('accepts only one offer per request when two are accepted at once', async () => {
    const service = await seedService();
    const customer = await registerUser(app, 'CUSTOMER');
    const first = await registerUser(app, 'PROVIDER');
    const second = await registerUser(app, 'PROVIDER');

    const created = await customer.send('post', '/api/requests', { body: requestPayload(service.id) });
    const requestId = created.body.id as string;

    const offerA = await first.send('post', `/api/requests/${requestId}/offers`, {
      body: { priceCents: 10_000, message: 'Ready to go', availableAt: futureDate(10) },
    });
    const offerB = await second.send('post', `/api/requests/${requestId}/offers`, {
      body: { priceCents: 11_000, message: 'Also ready', availableAt: futureDate(12) },
    });

    const results = await Promise.all([
      customer.send('patch', `/api/offers/${offerA.body.id}/accept`),
      customer.send('patch', `/api/offers/${offerB.body.id}/accept`),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await prisma.booking.count({ where: { requestId } })).toBe(1);
  });

  it('rejects a second offer from the same provider', async () => {
    const service = await seedService();
    const customer = await registerUser(app, 'CUSTOMER');
    const provider = await registerUser(app, 'PROVIDER');

    const created = await customer.send('post', '/api/requests', { body: requestPayload(service.id) });
    const offer = {
      body: { priceCents: 10_000, message: 'Ready to go', availableAt: futureDate(10) },
    };

    expect((await provider.send('post', `/api/requests/${created.body.id}/offers`, offer)).status).toBe(201);
    expect((await provider.send('post', `/api/requests/${created.body.id}/offers`, offer)).status).toBe(409);
  });

  describe('reviews', () => {
    async function completedBooking() {
      const context = await createPaidBooking(app);
      await context.customer.send('patch', `/api/bookings/${context.bookingId}/schedule`, {
        body: { scheduledAt: futureDate(24) },
      });
      await context.provider.send('patch', `/api/bookings/${context.bookingId}/start`);
      await context.provider.send('patch', `/api/bookings/${context.bookingId}/complete`);
      return context;
    }

    it('accepts a review on a completed booking and updates the provider rating', async () => {
      const { bookingId, customer, provider } = await completedBooking();

      const response = await customer.send('post', '/api/reviews', {
        body: { bookingId, rating: 5, body: 'Excellent work, arrived on time and fixed it fast.' },
      });
      expect(response.status).toBe(201);

      const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: provider.userId } });
      expect(Number(profile.ratingAverage)).toBe(5);
      expect(profile.ratingCount).toBe(1);
    });

    it('refuses a review before the job is complete', async () => {
      const { bookingId, customer } = await createPaidBooking(app);
      const response = await customer.send('post', '/api/reviews', {
        body: { bookingId, rating: 5, body: 'Great job even though nothing happened yet.' },
      });
      expect(response.status).toBe(409);
    });

    it('refuses a second review on the same booking', async () => {
      const { bookingId, customer } = await completedBooking();
      const review = { body: { bookingId, rating: 4, body: 'Good work overall, would hire again.' } };

      expect((await customer.send('post', '/api/reviews', review)).status).toBe(201);
      expect((await customer.send('post', '/api/reviews', review)).status).toBe(409);
    });

    it('refuses a review from the provider on their own work', async () => {
      const { bookingId, provider } = await completedBooking();
      const response = await provider.send('post', '/api/reviews', {
        body: { bookingId, rating: 5, body: 'Reviewing my own work, which should not be allowed.' },
      });
      // Reviewing is customer-only, so the role guard rejects it first.
      expect(response.status).toBe(403);
    });

    it('refuses a review from a customer who does not own the booking', async () => {
      const { bookingId } = await completedBooking();
      const stranger = await registerUser(app, 'CUSTOMER');

      const response = await stranger.send('post', '/api/reviews', {
        body: { bookingId, rating: 5, body: 'I was not involved in this job at all whatsoever.' },
      });
      expect(response.status).toBe(404);
    });

    it('rejects an out-of-range rating', async () => {
      const { bookingId, customer } = await completedBooking();
      const response = await customer.send('post', '/api/reviews', {
        body: { bookingId, rating: 9, body: 'Way beyond the allowed rating scale entirely.' },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('request publication', () => {
    it('publishes a draft exactly once', async () => {
      const service = await seedService();
      const customer = await registerUser(app, 'CUSTOMER');
      const created = await customer.send('post', '/api/requests', {
        body: requestPayload(service.id, { asDraft: true }),
      });

      expect((await customer.send('post', `/api/requests/${created.body.id}/publish`)).status).toBe(201);
      expect((await customer.send('post', `/api/requests/${created.body.id}/publish`)).status).toBe(409);
    });

    it('refuses to cancel a request whose job is already in progress', async () => {
      const { requestId, customer, provider, bookingId } = await createPaidBooking(app);
      await customer.send('patch', `/api/bookings/${bookingId}/schedule`, { body: { scheduledAt: futureDate(24) } });
      await provider.send('patch', `/api/bookings/${bookingId}/start`);

      const response = await customer.send('delete', `/api/requests/${requestId}`);
      expect(response.status).toBe(409);
    });
  });
});
