import { redactMetadata, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('replaces values whose key looks sensitive', () => {
    expect(redactSensitive({ email: 'a@b.com', password: 'hunter2' })).toEqual({
      email: 'a@b.com',
      password: '[redacted]',
    });
  });

  it('matches sensitive keys regardless of casing or separators', () => {
    expect(redactSensitive({
      passwordHash: 'x',
      API_KEY: 'x',
      'api-key': 'x',
      refreshToken: 'x',
      Authorization: 'x',
      cardNumber: 'x',
      stripeSignature: 'x',
    })).toEqual({
      passwordHash: '[redacted]',
      API_KEY: '[redacted]',
      'api-key': '[redacted]',
      refreshToken: '[redacted]',
      Authorization: '[redacted]',
      cardNumber: '[redacted]',
      stripeSignature: '[redacted]',
    });
  });

  it('redacts nested objects and arrays', () => {
    expect(redactSensitive({
      actor: { id: '1', secret: 'x' },
      entries: [{ token: 'x', name: 'ok' }],
    })).toEqual({
      actor: { id: '1', secret: '[redacted]' },
      entries: [{ token: '[redacted]', name: 'ok' }],
    });
  });

  it('truncates deep nesting instead of recursing without bound', () => {
    const deep = { a: { b: { c: { d: { e: 'too far' } } } } };
    expect(redactSensitive(deep)).toEqual({ a: { b: { c: { d: '[truncated]' } } } });
  });

  it('caps long strings', () => {
    const result = redactSensitive({ note: 'x'.repeat(1000) }) as { note: string };
    expect(result.note.length).toBeLessThanOrEqual(513);
    expect(result.note.endsWith('…')).toBe(true);
  });

  it('keeps primitives and dates serialisable', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(redactSensitive({ n: 1, b: true, d: date, nothing: null })).toEqual({
      n: 1,
      b: true,
      d: '2026-01-01T00:00:00.000Z',
      nothing: null,
    });
  });

  it('drops functions rather than serialising them', () => {
    expect(redactSensitive({ fn: () => 'x' })).toEqual({ fn: '[unsupported]' });
  });
});

describe('redactMetadata', () => {
  it('passes undefined through so no metadata is stored', () => {
    expect(redactMetadata(undefined)).toBeUndefined();
  });

  it('redacts a DTO spread into audit metadata', () => {
    expect(redactMetadata({ name: 'Plumbing', slug: 'plumbing', adminToken: 'leak' })).toEqual({
      name: 'Plumbing',
      slug: 'plumbing',
      adminToken: '[redacted]',
    });
  });
});
