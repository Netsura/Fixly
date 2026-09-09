import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import Redis from 'ioredis';
import request from 'supertest';
import { prisma } from '@fixly/database';
import { env } from '@fixly/config';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'fixly_csrf';
export const ACCESS_COOKIE = 'fixly_access_token';
export const REFRESH_COOKIE = 'fixly_refresh_token';

export async function createTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/**
 * Tables are truncated rather than deleted row-by-row so tests never depend on
 * leftover state from an earlier file.
 */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "Report", "Review", "PaymentWebhookEvent", "Payment", "EmailDelivery",
      "Message", "ConversationParticipant", "Conversation", "Booking", "Offer",
      "RequestAttachment", "ServiceRequest", "Notification", "AuthToken", "AuthSession",
      "Profile", "User", "Service", "ServiceCategory"
    RESTART IDENTITY CASCADE
  `);
}

let rateLimitRedis: Redis | null = null;

/** The rate limiter is left enabled, so its counters are cleared between tests. */
export async function clearRateLimits() {
  rateLimitRedis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const keys = await rateLimitRedis.keys('rl:*');
  if (keys.length) await rateLimitRedis.del(keys);
}

export async function closeRateLimitRedis() {
  await rateLimitRedis?.quit();
  rateLimitRedis = null;
}

export type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  /** Set false to deliberately omit the CSRF header. */
  csrf?: boolean;
};

/**
 * Supertest with a cookie jar, so tests exercise the same cookie + CSRF flow a
 * browser would.
 */
export class ApiClient {
  private readonly cookies = new Map<string, string>();
  csrfToken: string | null = null;
  userId = '';
  email = '';

  constructor(private readonly app: INestApplication) {}

  get cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`);
  }

  getCookie(name: string) {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string) {
    this.cookies.set(name, value);
  }

  clearCookies() {
    this.cookies.clear();
    this.csrfToken = null;
  }

  async send(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, options: RequestOptions = {}) {
    let call = request(this.app.getHttpServer())[method](path);
    if (this.cookies.size) call = call.set('Cookie', this.cookieHeader);

    const needsCsrf = options.csrf !== false && method !== 'get';
    if (needsCsrf && this.csrfToken) call = call.set(CSRF_HEADER, this.csrfToken);
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) call = call.set(key, value);
    }
    if (options.body !== undefined) call = call.send(options.body as object);

    const response = await call;
    this.absorbCookies(response.headers['set-cookie']);
    return response;
  }

  private absorbCookies(header: string | string[] | undefined) {
    if (!header) return;
    for (const raw of Array.isArray(header) ? header : [header]) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '') {
        this.cookies.delete(name);
        continue;
      }
      this.cookies.set(name, value);
      if (name === CSRF_COOKIE) this.csrfToken = decodeURIComponent(value);
    }
  }
}

let userCounter = 0;

export function uniqueEmail(prefix = 'user') {
  userCounter += 1;
  return `${prefix}-${Date.now()}-${userCounter}@fixly.test`;
}

/** Satisfies the registration policy: 12+ chars with upper, lower, and digit. */
export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

export async function registerUser(
  app: INestApplication,
  role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN' = 'CUSTOMER',
  displayName = 'Test User',
) {
  const client = new ApiClient(app);
  const email = uniqueEmail(role.toLowerCase());
  const response = await client.send('post', '/api/auth/register', {
    body: { email, password: TEST_PASSWORD, displayName, role: role === 'ADMIN' ? 'CUSTOMER' : role },
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Registration failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  client.email = email;
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  client.userId = user.id;

  if (role === 'ADMIN') {
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    // The role lives in the JWT, so a fresh session is needed for it to apply.
    await client.send('post', '/api/auth/refresh');
  }
  return client;
}

export async function seedService() {
  const category = await prisma.serviceCategory.upsert({
    where: { slug: 'home' },
    create: { name: 'Home', slug: 'home' },
    update: {},
  });
  return prisma.service.upsert({
    where: { slug: 'plumbing' },
    create: { categoryId: category.id, name: 'Plumbing', slug: 'plumbing' },
    update: { active: true },
  });
}

export function futureDate(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export function requestPayload(serviceId: string, overrides: Record<string, unknown> = {}) {
  return {
    serviceId,
    title: 'Leaky tap in the kitchen',
    description: 'The kitchen tap has been dripping for a week and needs a new washer.',
    locationHash: 'geo-abc123',
    preferredStart: futureDate(24),
    preferredEnd: futureDate(48),
    ...overrides,
  };
}

/** Drives the marketplace flow up to a paid booking, returning every actor. */
export async function createPaidBooking(app: INestApplication) {
  const service = await seedService();
  const customer = await registerUser(app, 'CUSTOMER', 'Casey Customer');
  const provider = await registerUser(app, 'PROVIDER', 'Pat Provider');

  const created = await customer.send('post', '/api/requests', { body: requestPayload(service.id) });
  if (created.status !== 201) throw new Error(`Request creation failed: ${JSON.stringify(created.body)}`);
  const requestId = created.body.id as string;

  const offered = await provider.send('post', `/api/requests/${requestId}/offers`, {
    body: { priceCents: 12_500, message: 'I can fix that tomorrow morning.', availableAt: futureDate(30) },
  });
  if (offered.status !== 201) throw new Error(`Offer creation failed: ${JSON.stringify(offered.body)}`);
  const offerId = offered.body.id as string;

  const accepted = await customer.send('patch', `/api/offers/${offerId}/accept`);
  if (accepted.status !== 200) throw new Error(`Offer accept failed: ${JSON.stringify(accepted.body)}`);
  const bookingId = accepted.body.id as string;

  const paid = await customer.send('post', '/api/payments/dev-confirm', { body: { bookingId } });
  if (paid.status !== 201) throw new Error(`Dev payment failed: ${JSON.stringify(paid.body)}`);

  return { service, customer, provider, requestId, offerId, bookingId };
}
