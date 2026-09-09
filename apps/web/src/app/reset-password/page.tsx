'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { apiFetch } from '../../lib/api';

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  return (
    <section className="page-section auth-page">
      <h1>Choose a new password</h1>
      <form className="auth-form" onSubmit={onSubmit}>
        <label>New password<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-dark button-wide" type="submit" disabled={!token}>Update password</button>
      </form>
      <Link href="/login">Back to login</Link>
    </section>
  );
}

export default function ResetPasswordPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="page-section">Loading...</div>}>
        <ResetPasswordInner />
      </Suspense>
    </AppShell>
  );
}
