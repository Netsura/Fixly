import { createCsrfToken, timingSafeEqualString, verifyCsrfToken } from './csrf';

describe('csrf tokens', () => {
  const sessionId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const otherSessionId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  it('accepts a token against the session it was minted for', () => {
    expect(verifyCsrfToken(createCsrfToken(sessionId), sessionId)).toBe(true);
  });

  it('rejects a token minted for a different session', () => {
    // This is the cookie-tossing case: an attacker's own valid token must not
    // validate against the victim's session.
    expect(verifyCsrfToken(createCsrfToken(otherSessionId), sessionId)).toBe(false);
  });

  it('rejects a token with a tampered signature', () => {
    const token = createCsrfToken(sessionId);
    const [nonce] = token.split('.');
    expect(verifyCsrfToken(`${nonce}.forged`, sessionId)).toBe(false);
  });

  it('rejects a token with a tampered nonce', () => {
    const token = createCsrfToken(sessionId);
    const signature = token.slice(token.lastIndexOf('.') + 1);
    expect(verifyCsrfToken(`tampered.${signature}`, sessionId)).toBe(false);
  });

  it('rejects missing and malformed tokens', () => {
    expect(verifyCsrfToken(undefined, sessionId)).toBe(false);
    expect(verifyCsrfToken('', sessionId)).toBe(false);
    expect(verifyCsrfToken('no-separator', sessionId)).toBe(false);
    expect(verifyCsrfToken('.onlysignature', sessionId)).toBe(false);
  });

  it('issues a distinct token each time', () => {
    expect(createCsrfToken(sessionId)).not.toEqual(createCsrfToken(sessionId));
  });
});

describe('timingSafeEqualString', () => {
  it('compares equal strings', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
  });

  it('rejects different strings without throwing on length mismatch', () => {
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualString('', 'a')).toBe(false);
  });
});
