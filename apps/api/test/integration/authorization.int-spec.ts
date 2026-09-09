import { INestApplication } from '@nestjs/common';
import { prisma } from '@fixly/database';
import {
  ApiClient,
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

describe('authorization', () => {
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

  describe('role boundaries', () => {
    it('stops a provider from creating a service request', async () => {
      const provider = await registerUser(app, 'PROVIDER');
      const service = await seedService();

      const response = await provider.send('post', '/api/requests', { body: requestPayload(service.id) });
      expect(response.status).toBe(403);
    });

    it('stops a customer from making an offer', async () => {
      const service = await seedService();
      const customer = await registerUser(app, 'CUSTOMER');
      const other = await registerUser(app, 'CUSTOMER');

      const created = await customer.send('post', '/api/requests', { body: requestPayload(service.id) });
      const response = await other.send('post', `/api/requests/${created.body.id}/offers`, {
        body: { priceCents: 1000, message: 'Let me try', availableAt: futureDate(10) },
      });
      expect(response.status).toBe(403);
    });

    it('keeps non-admins out of the admin surface', async () => {
      const customer = await registerUser(app, 'CUSTOMER');
      expect((await customer.send('get', '/api/admin/statistics')).status).toBe(403);
      expect((await customer.send('get', '/api/admin/users')).status).toBe(403);
      expect((await customer.send('get', '/api/admin/audit-logs')).status).toBe(403);
    });

    it('lets an admin read the admin surface', async () => {
      const admin = await registerUser(app, 'ADMIN');
      expect((await admin.send('get', '/api/admin/statistics')).status).toBe(200);
    });

    it('rejects unauthenticated access to protected reads', async () => {
      const anonymous = new ApiClient(app);
      expect((await anonymous.send('get', '/api/users/me')).status).toBe(401);
      expect((await anonymous.send('get', '/api/requests')).status).toBe(401);
      expect((await anonymous.send('get', '/api/bookings')).status).toBe(401);
    });
  });

  describe('object-level ownership', () => {
    it('hides another customer\'s request', async () => {
      const service = await seedService();
      const owner = await registerUser(app, 'CUSTOMER');
      const stranger = await registerUser(app, 'CUSTOMER');

      const created = await owner.send('post', '/api/requests', { body: requestPayload(service.id) });
      const response = await stranger.send('get', `/api/requests/${created.body.id}`);
      expect(response.status).toBe(404);
    });

    it('stops a stranger from cancelling someone else\'s request', async () => {
      const service = await seedService();
      const owner = await registerUser(app, 'CUSTOMER');
      const stranger = await registerUser(app, 'CUSTOMER');

      const created = await owner.send('post', '/api/requests', { body: requestPayload(service.id) });
      const response = await stranger.send('delete', `/api/requests/${created.body.id}`);
      expect(response.status).toBe(404);

      const untouched = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(untouched.status).not.toBe('CANCELLED');
    });

    it('stops a stranger from accepting an offer on a request they do not own', async () => {
      const service = await seedService();
      const owner = await registerUser(app, 'CUSTOMER');
      const stranger = await registerUser(app, 'CUSTOMER');
      const provider = await registerUser(app, 'PROVIDER');

      const created = await owner.send('post', '/api/requests', { body: requestPayload(service.id) });
      const offer = await provider.send('post', `/api/requests/${created.body.id}/offers`, {
        body: { priceCents: 5000, message: 'Available now', availableAt: futureDate(10) },
      });

      const response = await stranger.send('patch', `/api/offers/${offer.body.id}/accept`);
      expect(response.status).toBe(404);
    });

    it('hides a booking from users who are not a participant', async () => {
      const { bookingId } = await createPaidBooking(app);
      const stranger = await registerUser(app, 'CUSTOMER');

      expect((await stranger.send('get', `/api/bookings/${bookingId}`)).status).toBe(404);
      expect((await stranger.send('patch', `/api/bookings/${bookingId}/cancel`)).status).toBe(404);
    });

    it('hides a payment from a customer who does not own the booking', async () => {
      const { bookingId } = await createPaidBooking(app);
      const stranger = await registerUser(app, 'CUSTOMER');
      const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });

      expect((await stranger.send('get', `/api/payments/${payment.id}`)).status).toBe(404);
    });

    it('stops a stranger from paying for someone else\'s booking', async () => {
      const { bookingId } = await createPaidBooking(app);
      const stranger = await registerUser(app, 'CUSTOMER');

      const response = await stranger.send('post', '/api/payments/dev-confirm', { body: { bookingId } });
      expect(response.status).toBe(404);
    });
  });

  describe('suspension', () => {
    it('cuts existing sessions when an admin suspends a user', async () => {
      const admin = await registerUser(app, 'ADMIN');
      const victim = await registerUser(app, 'CUSTOMER');
      expect((await victim.send('get', '/api/users/me')).status).toBe(200);

      const suspended = await admin.send('patch', `/api/admin/users/${victim.userId}/suspension?suspended=true`);
      expect(suspended.status).toBe(200);

      const live = await prisma.authSession.count({ where: { userId: victim.userId, revokedAt: null } });
      expect(live).toBe(0);
      expect((await victim.send('post', '/api/auth/refresh')).status).toBe(401);
    });

    it('refuses to suspend another admin', async () => {
      const admin = await registerUser(app, 'ADMIN');
      const other = await registerUser(app, 'ADMIN');

      const response = await admin.send('patch', `/api/admin/users/${other.userId}/suspension?suspended=true`);
      expect(response.status).toBe(409);
    });
  });
});
