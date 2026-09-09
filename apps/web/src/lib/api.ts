export type UserRole = 'CUSTOMER' | 'PROVIDER' | 'ADMIN';

export type Service = {
  id: string;
  slug: string;
  name: string;
  category: { id: string; name: string; slug: string };
};

export type ServiceRequest = {
  id: string;
  status: string;
  title: string;
  description: string;
  locationHash?: string;
  preferredStart: string;
  preferredEnd: string;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  service: Service;
  offers?: Offer[];
  customer?: { id: string; profile: { displayName: string } | null };
  customerOnline?: boolean;
  booking?: BookingSummary | null;
  myOffer?: { id: string; priceCents: number; status: string } | null;
};

export type Offer = {
  id: string;
  priceCents: number;
  message: string;
  availableAt: string;
  status: string;
  providerOnline?: boolean;
  provider: {
    id: string;
    email: string;
    role: UserRole;
    profile: { displayName: string; ratingAverage: string; ratingCount: number } | null;
  };
};

export type BookingSummary = {
  id: string;
  status: string;
  scheduledAt?: string | null;
  providerId?: string;
  customerId?: string;
  conversation?: { id: string } | null;
  review?: { id: string; rating: number } | null;
  payments?: { id: string; status: string }[];
  request?: ServiceRequest;
  offer?: { priceCents: number; message: string };
  customer?: { id: string; profile: { displayName: string } | null };
  provider?: { id: string; profile: { displayName: string } | null };
};

export type NotificationItem = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type Profile = {
  id: string;
  email: string;
  role: UserRole;
  emailVerifiedAt?: string | null;
  online?: boolean;
  profile: { displayName: string; bio: string | null; ratingAverage: string; ratingCount: number } | null;
};

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const CSRF_COOKIE = 'fixly_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined) {
  csrfToken = token ?? null;
}

function readCsrfCookie() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

function csrfHeaders(method: string): Record<string, string> {
  if (SAFE_METHODS.has(method.toUpperCase())) return {};
  const token = readCsrfCookie() ?? csrfToken;
  return token ? { [CSRF_HEADER]: token } : {};
}

/** Re-mints the CSRF token for the current session without rotating it. */
async function renewCsrfToken() {
  const response = await fetch(`${apiUrl}/auth/csrf`, { credentials: 'include' });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null) as { csrfToken?: string } | null;
  setCsrfToken(payload?.csrfToken);
  return Boolean(payload?.csrfToken);
}

/** Mints a fresh session + CSRF pair; used when the access token has expired. */
async function refreshSession() {
  const response = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders('POST'),
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null) as { csrfToken?: string } | null;
  setCsrfToken(payload?.csrfToken);
  return true;
}

/**
 * A 403 usually means a stale CSRF token, a 401 an expired access token. Try
 * the cheaper CSRF renewal first and fall back to rotating the session.
 */
async function recoverSession(status: number) {
  if (status === 403 && (await renewCsrfToken())) return true;
  return refreshSession();
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
  return new Error(message ?? fallback);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, canRetry = true): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders(method), ...options.headers },
  });

  // An expired access token or a stale CSRF token are both fixed by rotating
  // the session once and replaying the request.
  const recoverable = response.status === 401 || response.status === 403;
  if (recoverable && canRetry && !path.startsWith('/auth/')) {
    if (await recoverSession(response.status)) return apiFetch<T>(path, options, false);
  }

  if (!response.ok) {
    throw await readError(response, `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiUpload<T>(path: string, body: FormData, canRetry = true): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    body,
    credentials: 'include',
    headers: csrfHeaders('POST'),
  });

  if ((response.status === 401 || response.status === 403) && canRetry) {
    if (await recoverSession(response.status)) return apiUpload<T>(path, body, false);
  }
  if (!response.ok) {
    throw await readError(response, `Upload failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return 'Flexible budget';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
