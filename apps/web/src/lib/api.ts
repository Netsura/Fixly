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

export async function apiFetch<T>(path: string, options: RequestInit = {}, canRefresh = true): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...options.headers },
  });

  if (response.status === 401 && canRefresh && !path.startsWith('/auth/')) {
    const refresh = await fetch(`${apiUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) return apiFetch<T>(path, options, false);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new Error(message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method: 'POST', body, credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new Error(message ?? `Upload failed with status ${response.status}`);
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
