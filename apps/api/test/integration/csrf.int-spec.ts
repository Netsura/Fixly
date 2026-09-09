import { INestApplication } from '@nestjs/common';
import { env } from '@fixly/config';
import {
  ACCESS_COOKIE,
  ApiClient,
  clearRateLimits,
  closeRateLimitRedis,
  createTestApp,
  CSRF_COOKIE,
  CSRF_HEADER,
  registerUser,
  requestPayload,
  resetDatabase,
  seedService,
  TEST_PASSWORD,
} from './harness';

describe('CSRF and origin protection', () => {
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

  it('issues a readable CSRF cookie on login', async () => {
    const client = await registerUser(app);
    expect(client.getCookie(CSRF_COOKIE)).toBeTruthy();
    expect(client.csrfToken).toBeTruthy();
  });

  it('rejects a cookie-authenticated mutation with no CSRF header', async () => {
    const client = await registerUser(app);
    const response = await client.send('patch', '/api/users/me', {
      body: { displayName: 'No CSRF' },
      csrf: false,
    });
    expect(response.status).toBe(403);
  });

  it('accepts the same mutation once the CSRF header is present', async () => {
    const client = await registerUser(app);
    const response = await client.send('patch', '/api/users/me', { body: { displayName: 'With CSRF' } });
    expect(response.status).toBe(200);
  });

  it('rejects a CSRF token minted for a different session', async () => {
    const victim = await registerUser(app);
    const attacker = await registerUser(app);

    // Cookie tossing: the victim's session cookie rides along, but the CSRF
    // cookie and header are a matching pair the attacker minted for themselves.
    const tossed = new ApiClient(app);
    tossed.setCookie(ACCESS_COOKIE, victim.getCookie(ACCESS_COOKIE)!);
    tossed.setCookie(CSRF_COOKIE, attacker.csrfToken!);
    tossed.csrfToken = attacker.csrfToken;

    const response = await tossed.send('patch', '/api/users/me', {
      body: { displayName: 'Tossed cookie' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a header that does not match the cookie', async () => {
    const client = await registerUser(app);
    const response = await client.send('patch', '/api/users/me', {
      body: { displayName: 'Mismatch' },
      csrf: false,
      headers: { [CSRF_HEADER]: 'not-the-cookie-value' },
    });
    expect(response.status).toBe(403);
  });

  it('protects every state-changing verb, not just PATCH', async () => {
    const customer = await registerUser(app);
    const service = await seedService();

    const response = await customer.send('post', '/api/requests', {
      csrf: false,
      body: requestPayload(service.id),
    });
    expect(response.status).toBe(403);
  });

  it('leaves safe methods alone', async () => {
    const client = await registerUser(app);
    const response = await client.send('get', '/api/users/me');
    expect(response.status).toBe(200);
  });

  it('exempts login so a first-time visitor can authenticate', async () => {
    const client = await registerUser(app);
    client.clearCookies();

    const response = await client.send('post', '/api/auth/login', {
      csrf: false,
      body: { email: client.email, password: TEST_PASSWORD },
    });
    expect(response.status).toBe(201);
  });

  it('rejects mutations from a foreign origin', async () => {
    const client = await registerUser(app);
    const response = await client.send('patch', '/api/users/me', {
      body: { displayName: 'Evil' },
      headers: { Origin: 'https://attacker.example' },
    });
    expect(response.status).toBe(403);
  });

  it('allows mutations from the configured web origin', async () => {
    const client = await registerUser(app);
    const response = await client.send('patch', '/api/users/me', {
      body: { displayName: 'Legit' },
      headers: { Origin: new URL(env.WEB_URL).origin },
    });
    expect(response.status).toBe(200);
  });

  it('does not require CSRF from a client with no session cookie', async () => {
    // Unauthenticated callers have no ambient credential to abuse; they should
    // fail authentication rather than CSRF.
    const response = await new ApiClient(app).send('patch', '/api/users/me', {
      body: { displayName: 'Anonymous' },
      csrf: false,
    });
    expect(response.status).toBe(401);
  });
});
