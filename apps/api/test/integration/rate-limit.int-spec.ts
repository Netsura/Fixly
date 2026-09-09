import { INestApplication } from '@nestjs/common';
import { ApiClient, clearRateLimits, closeRateLimitRedis, createTestApp, registerUser, resetDatabase, TEST_PASSWORD, uniqueEmail } from './harness';

describe('rate limiting', () => {
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

  it('throttles repeated failed logins', async () => {
    const client = await registerUser(app);
    const anonymous = new ApiClient(app);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await anonymous.send('post', '/api/auth/login', {
        csrf: false,
        body: { email: client.email, password: 'Definitely-the-wrong-pw-9' },
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeGreaterThan(0);
  });

  it('throttles repeated registrations from one address', async () => {
    const anonymous = new ApiClient(app);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await anonymous.send('post', '/api/auth/register', {
        csrf: false,
        body: { email: uniqueEmail('flood'), password: TEST_PASSWORD, displayName: 'Flood', role: 'CUSTOMER' },
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });

  it('does not throttle ordinary authenticated reads', async () => {
    const client = await registerUser(app);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      statuses.push((await client.send('get', '/api/users/me')).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
