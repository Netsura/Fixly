import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@fixly/config';

export const CSRF_COOKIE = 'fixly_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF token bound to the auth session.
 *
 * The token is `<nonce>.<hmac>` where the HMAC covers the session id. Binding
 * to the session is what makes this safe against cookie tossing: a token an
 * attacker legitimately minted for their own session will not validate against
 * the victim's session cookie.
 */
export function createCsrfToken(sessionId: string) {
  const nonce = randomBytes(18).toString('base64url');
  return `${nonce}.${signCsrf(sessionId, nonce)}`;
}

export function verifyCsrfToken(token: string | undefined, sessionId: string) {
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  return timingSafeEqualString(signature, signCsrf(sessionId, nonce));
}

function signCsrf(sessionId: string, nonce: string) {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${sessionId}.${nonce}`).digest('base64url');
}

export function timingSafeEqualString(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
