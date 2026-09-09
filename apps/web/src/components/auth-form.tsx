'use client';

import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiFetch, setCsrfToken } from '../lib/api';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(12, 'Use at least 12 characters'), displayName: z.string().min(2, 'Enter your name').optional(), role: z.enum(['CUSTOMER', 'PROVIDER']).default('CUSTOMER') });
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: { role: 'CUSTOMER' } });
  const submit = async (values: FormOutput) => {
    try {
      const payload = mode === 'login'
        ? { email: values.email, password: values.password }
        : values;
      const session = await apiFetch<{ csrfToken?: string }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      setCsrfToken(session?.csrfToken);
      const next = searchParams.get('next');
      router.push(next?.startsWith('/') ? next : '/dashboard');
      router.refresh();
    } catch (error) {
      setError('root', { message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  };

  return <form className="auth-form" onSubmit={handleSubmit(submit)}>
    {mode === 'register' && <label>Name<input {...register('displayName')} placeholder="Your name" />{errors.displayName && <em>{errors.displayName.message}</em>}</label>}
    <label>Email<input type="email" {...register('email')} placeholder="you@example.com" autoComplete="email" />{errors.email && <em>{errors.email.message}</em>}</label>
    <label>Password<input type="password" {...register('password')} placeholder="At least 12 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />{errors.password && <em>{errors.password.message}</em>}</label>
    {mode === 'register' && <label>What brings you here?<select {...register('role')}><option value="CUSTOMER">I need a service</option><option value="PROVIDER">I provide services</option></select></label>}
    {errors.root && <p className="form-error">{errors.root.message}</p>}
    <button className="button button-dark button-wide" disabled={isSubmitting}>{isSubmitting ? <><LoaderCircle className="spin" size={17} /> Working...</> : <>{mode === 'login' ? 'Log in to Fixly' : 'Create your account'} <ArrowRight size={17} /></>}</button>
    <p className="form-footnote">{mode === 'login' ? <>New to Fixly? <Link href="/register">Create an account</Link> · <Link href="/forgot-password">Forgot password</Link></> : <>Already have an account? <Link href="/login">Log in</Link></>}</p>
  </form>;
}
