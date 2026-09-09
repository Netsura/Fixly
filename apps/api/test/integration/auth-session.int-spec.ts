import { INestApplication } from '@nestjs/common';
import { AuthTokenType, prisma } from '@fixly/database';
import { createHash, randomBytes } from 'node:crypto';
import {
  ACCESS_COOKIE,
  ApiClient,
  clearRateLimits,
  closeRateLimitRedis,
  createTestApp,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  registerUser,
  resetDatabase,
  TEST_PASSWORD,
} from './harness';

type SessionSnapshot = { refresh: string; access?: string; csrf: string };

/** Captures the cookie set as a browser would hold it, before any rotation. */
function snapshotSession(client: ApiClient): SessionSnapshot {
  return {
    refresh: client.getCookie(REFRESH_COOKIE)!,
    access: client.getCookie(ACCESS_COOKIE),
    csrf: client.csrfToken!,
  };
}

/**
 * A client replaying a captured cookie set. The CSRF pair is intact, so these
 * tests exercise the session checks rather than tripping the CSRF guard.
 */
function replayClient(app: INestApplication, session: SessionSnapshot) {
  const client = new ApiClient(app);
  client.setCookie(REFRESH_COOKIE, session.refresh);
  if (session.access) client.setCookie(ACCESS_COOKIE, session.access);
  client.setCookie(CSRF_COOKIE, session.csrf);
  client.csrfToken = session.csrf;
  return client;
}

describe('auth session security', () => {
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

  describe('refresh token rotation', () => {
    it('rotates the refresh token on every use', async () => {
      const client = await registerUser(app);
      const first = client.getCookie(REFRESH_COOKIE);

      const response = await client.send('post', '/api/auth/refresh');
      expect(response.status).toBe(201);
      expect(client.getCookie(REFRESH_COOKIE)).not.toEqual(first);
    });

    it('rejects a refresh token that was already rotated', async () => {
      const client = await registerUser(app);
      const stale = snapshotSession(client);
      await client.send('post', '/api/auth/refresh');

      const response = await replayClient(app, stale).send('post', '/api/auth/refresh');
      expect(response.status).toBe(401);
    });

    it('revokes the whole token family when a rotated token is replayed', async () => {
      const client = await registerUser(app);
      const stale = snapshotSession(client);
      await client.send('post', '/api/auth/refresh');

      const replay = await replayClient(app, stale).send('post', '/api/auth/refresh');
      expect(replay.status).toBe(401);

      // The replay is treated as a leak, so the live session dies with it.
      const afterBreach = await client.send('post', '/api/auth/refresh');
      expect(afterBreach.status).toBe(401);

      const live = await prisma.authSession.count({
        where: { userId: client.userId, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('lets only one of several concurrent refreshes win', async () => {
      const client = await registerUser(app);
      const session = snapshotSession(client);

      const results = await Promise.all([
        replayClient(app, session).send('post', '/api/auth/refresh'),
        replayClient(app, session).send('post', '/api/auth/refresh'),
        replayClient(app, session).send('post', '/api/auth/refresh'),
      ]);
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    });

    it('rejects a refresh token whose session was revoked by logout', async () => {
      const client = await registerUser(app);
      const session = snapshotSession(client);
      await client.send('post', '/api/auth/logout');

      const response = await replayClient(app, session).send('post', '/api/auth/refresh');
      expect(response.status).toBe(401);
    });

    it('stops the access token working the moment the session is revoked', async () => {
      const client = await registerUser(app);
      expect((await client.send('get', '/api/users/me')).status).toBe(200);

      await prisma.authSession.updateMany({
        where: { userId: client.userId },
        data: { revokedAt: new Date() },
      });
      expect((await client.send('get', '/api/users/me')).status).toBe(401);
    });
  });

  describe('password reset tokens', () => {
    async function issueResetToken(userId: string) {
      const rawToken = randomBytes(32).toString('hex');
      await prisma.authToken.create({
        data: {
          userId,
          type: AuthTokenType.PASSWORD_RESET,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      return rawToken;
    }

    it('accepts a reset token exactly once', async () => {
      const client = await registerUser(app);
      const token = await issueResetToken(client.userId);
      const anonymous = new ApiClient(app);

      const first = await anonymous.send('post', '/api/auth/reset-password', {
        body: { token, password: 'A-brand-new-password-1' },
      });
      expect(first.status).toBe(201);

      const second = await anonymous.send('post', '/api/auth/reset-password', {
        body: { token, password: 'Another-password-entirely-2' },
      });
      expect(second.status).toBe(401);
    });

    it('lets only one of two concurrent redemptions succeed', async () => {
      const client = await registerUser(app);
      const token = await issueResetToken(client.userId);

      const redeem = (password: string) =>
        new ApiClient(app).send('post', '/api/auth/reset-password', { body: { token, password } });

      const results = await Promise.all([
        redeem('Concurrent-password-one-1'),
        redeem('Concurrent-password-two-2'),
      ]);
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    });

    it('revokes every session when the password changes', async () => {
      const client = await registerUser(app);
      const token = await issueResetToken(client.userId);

      await new ApiClient(app).send('post', '/api/auth/reset-password', {
        body: { token, password: 'Yet-another-strong-pass-3' },
      });

      const live = await prisma.authSession.count({ where: { userId: client.userId, revokedAt: null } });
      expect(live).toBe(0);
      expect((await client.send('get', '/api/users/me')).status).toBe(401);
    });

    it('invalidates sibling reset tokens once one is used', async () => {
      const client = await registerUser(app);
      const first = await issueResetToken(client.userId);
      const second = await issueResetToken(client.userId);

      await new ApiClient(app).send('post', '/api/auth/reset-password', {
        body: { token: first, password: 'Password-after-reset-01' },
      });

      const response = await new ApiClient(app).send('post', '/api/auth/reset-password', {
        body: { token: second, password: 'Password-after-reset-02' },
      });
      expect(response.status).toBe(401);
    });

    it('rejects an expired reset token', async () => {
      const client = await registerUser(app);
      const rawToken = randomBytes(32).toString('hex');
      await prisma.authToken.create({
        data: {
          userId: client.userId,
          type: AuthTokenType.PASSWORD_RESET,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const response = await new ApiClient(app).send('post', '/api/auth/reset-password', {
        body: { token: rawToken, password: 'Password-for-expired-tok1' },
      });
      expect(response.status).toBe(401);
    });

    it('will not let an email-verification token reset a password', async () => {
      const client = await registerUser(app);
      const rawToken = randomBytes(32).toString('hex');
      await prisma.authToken.create({
        data: {
          userId: client.userId,
          type: AuthTokenType.EMAIL_VERIFICATION,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const response = await new ApiClient(app).send('post', '/api/auth/reset-password', {
        body: { token: rawToken, password: 'Cross-type-token-abuse-1' },
      });
      expect(response.status).toBe(401);
    });
  });

  describe('email verification tokens', () => {
    it('verifies once and rejects replays', async () => {
      const client = await registerUser(app);
      const rawToken = randomBytes(32).toString('hex');
      await prisma.authToken.create({
        data: {
          userId: client.userId,
          type: AuthTokenType.EMAIL_VERIFICATION,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const anonymous = new ApiClient(app);
      expect((await anonymous.send('post', '/api/auth/verify-email', { body: { token: rawToken } })).status).toBe(201);
      expect((await anonymous.send('post', '/api/auth/verify-email', { body: { token: rawToken } })).status).toBe(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
      expect(user.emailVerifiedAt).not.toBeNull();
    });
  });

  describe('account state', () => {
    it('refuses login for a suspended account', async () => {
      const client = await registerUser(app);
      await prisma.user.update({ where: { id: client.userId }, data: { suspendedAt: new Date() } });

      const response = await new ApiClient(app).send('post', '/api/auth/login', {
        body: { email: client.email, password: TEST_PASSWORD },
      });
      expect(response.status).toBe(401);
    });

    it('does not reveal whether an email exists on forgot-password', async () => {
      const client = await registerUser(app);
      const anonymous = new ApiClient(app);

      const known = await anonymous.send('post', '/api/auth/forgot-password', { body: { email: client.email } });
      const unknown = await anonymous.send('post', '/api/auth/forgot-password', { body: { email: 'nobody@fixly.test' } });

      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
    });
  });
});
