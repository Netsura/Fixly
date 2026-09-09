'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { apiFetch } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setDone(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  return (
    <AppShell>
      <section className="page-section auth-page">
        <h1>Reset password</h1>
        <p>We’ll email a single-use reset link if the account exists.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          {done && <p>If that email exists, a reset link was sent.</p>}
          <button className="button button-dark button-wide" type="submit">Send reset link</button>
        </form>
        <Link href="/login">Back to login</Link>
      </section>
    </AppShell>
  );
}
