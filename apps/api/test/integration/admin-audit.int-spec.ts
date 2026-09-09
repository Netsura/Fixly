import { INestApplication } from '@nestjs/common';
import { prisma } from '@fixly/database';
import { clearRateLimits, closeRateLimitRedis, createTestApp, registerUser, resetDatabase } from './harness';

describe('admin actions and audit logging', () => {
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

  it('writes an audit entry alongside a suspension', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const victim = await registerUser(app, 'CUSTOMER');

    await admin.send('patch', `/api/admin/users/${victim.userId}/suspension?suspended=true`);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: victim.userId } });
    expect(entry.action).toBe('user.suspend');
    expect(entry.actorId).toBe(admin.userId);
  });

  it('writes no audit entry when the action fails', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const other = await registerUser(app, 'ADMIN');

    const response = await admin.send('patch', `/api/admin/users/${other.userId}/suspension?suspended=true`);
    expect(response.status).toBe(409);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rolls back the audit entry when service creation conflicts', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const category = await prisma.serviceCategory.upsert({
      where: { slug: 'outdoor' },
      create: { name: 'Outdoor', slug: 'outdoor' },
      update: {},
    });
    const payload = { body: { categoryId: category.id, name: 'Gardening', slug: 'gardening-audit' } };

    expect((await admin.send('post', '/api/admin/services', payload)).status).toBe(201);
    const afterFirst = await prisma.auditLog.count({ where: { action: 'service.create' } });

    expect((await admin.send('post', '/api/admin/services', payload)).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: 'service.create' } })).toBe(afterFirst);
  });

  it('redacts sensitive fields before storing audit metadata', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const category = await prisma.serviceCategory.upsert({
      where: { slug: 'indoor' },
      create: { name: 'Indoor', slug: 'indoor' },
      update: {},
    });
    const service = await prisma.service.create({
      data: { categoryId: category.id, name: 'Painting', slug: 'painting-audit' },
    });

    // `name` is the only writable field, but the redactor is what stands
    // between any future sensitive DTO field and the shared audit log.
    await admin.send('patch', `/api/admin/services/${service.id}`, { body: { name: 'Interior painting' } });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'service.update' } });
    expect(entry.metadata).toEqual({ name: 'Interior painting' });

    await prisma.auditLog.create({
      data: {
        actorId: admin.userId,
        action: 'test.redaction',
        entityType: 'Test',
        entityId: service.id,
        metadata: { password: 'hunter2' },
      },
    });
    const raw = await prisma.auditLog.findFirstOrThrow({ where: { action: 'test.redaction' } });
    // Written directly, so it is NOT redacted - proving the service layer is
    // where redaction happens and must stay.
    expect(raw.metadata).toEqual({ password: 'hunter2' });
  });

  it('resolves a report once and records who did it', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const reporter = await registerUser(app, 'CUSTOMER');

    const created = await reporter.send('post', '/api/reports', {
      body: { targetType: 'user', targetId: admin.userId, reason: 'Spam messages in the conversation thread.' },
    });
    expect(created.status).toBe(201);

    expect((await admin.send('patch', `/api/reports/${created.body.id}/resolve`)).status).toBe(200);
    expect((await admin.send('patch', `/api/reports/${created.body.id}/resolve`)).status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { action: 'report.resolve' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorId).toBe(admin.userId);
  });

  it('keeps non-admins from resolving reports', async () => {
    const admin = await registerUser(app, 'ADMIN');
    const reporter = await registerUser(app, 'CUSTOMER');
    const created = await reporter.send('post', '/api/reports', {
      body: { targetType: 'user', targetId: admin.userId, reason: 'Another report that should stay open.' },
    });

    expect((await reporter.send('patch', `/api/reports/${created.body.id}/resolve`)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'report.resolve' } })).toBe(0);
  });
});
