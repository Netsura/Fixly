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
  preferredStart: string;
  preferredEnd: string;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  service: Service;
  offers?: Offer[];
};

export type Offer = {
  id: string;
  priceCents: number;
  message: string;
  availableAt: string;
  status: string;
  provider: {
    id: string;
    email: string;
    role: UserRole;
    profile: { displayName: string; ratingAverage: string; ratingCount: number } | null;
  };
};

export type Profile = {
  id: string;
  email: string;
  role: UserRole;
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

  return response.json() as Promise<T>;
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
