'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, use, useMemo } from 'react';
import { AppShell } from '../../components/app-shell';
import { apiFetch } from '../../lib/api';

function verifyEmail(token: string) {
  if (!token) return Promise.resolve('Missing verification token.');
  return apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
    .then(() => 'Email verified. You can continue using Fixly.')
    .catch((error) => (error instanceof Error ? error.message : 'Verification failed'));
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const messagePromise = useMemo(() => verifyEmail(token), [token]);
  const message = use(messagePromise);

  return (
    <section className="page-section auth-page">
      <h1>Email verification</h1>
      <p>{message}</p>
      <Link className="button button-dark" href="/login">Continue</Link>
    </section>
  );
}

export default function VerifyEmailPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="page-section auth-page"><h1>Email verification</h1><p>Verifying...</p></div>}>
        <VerifyEmailInner />
      </Suspense>
    </AppShell>
  );
}
