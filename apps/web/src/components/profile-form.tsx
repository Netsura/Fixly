'use client';

import { LoaderCircle, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiFetch, Profile } from '../lib/api';

type ProfileValues = { displayName: string; phone: string; bio: string; serviceArea: string };

export function ProfileForm() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me') });
  const form = useForm<ProfileValues>({ values: profile.data ? { displayName: profile.data.profile?.displayName ?? '', phone: '', bio: profile.data.profile?.bio ?? '', serviceArea: '' } : undefined });
  const update = useMutation({ mutationFn: (values: ProfileValues) => apiFetch<Profile>('/users/me', { method: 'PATCH', body: JSON.stringify({ ...values, serviceArea: values.serviceArea ? { label: values.serviceArea } : undefined }) }), onSuccess: (data) => queryClient.setQueryData(['profile'], data) });

  if (profile.isLoading) return <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading profile...</div>;
  if (profile.isError || !profile.data) return <div className="status-panel error-panel">Log in to manage your profile.</div>;
  return <form className="profile-form" onSubmit={form.handleSubmit((values) => update.mutate(values))}><label>Display name<input {...form.register('displayName', { required: 'Enter a display name' })} />{form.formState.errors.displayName && <em>{form.formState.errors.displayName.message}</em>}</label><label>Phone number<input {...form.register('phone')} placeholder="Optional" /></label><label>About you<textarea {...form.register('bio')} rows={5} placeholder="A little about you, your experience, or the kind of help you need." /></label><label>Service area<input {...form.register('serviceArea')} placeholder="Town, neighbourhood, or postcode" /></label>{update.isError && <p className="form-error">{update.error.message}</p>}{update.isSuccess && <p className="form-success">Profile saved.</p>}<button className="button button-dark" disabled={update.isPending}>{update.isPending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save profile</button></form>;
}
