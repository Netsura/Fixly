'use client';

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiFetch, apiUpload, Service, ServiceRequest } from '../lib/api';

const schema = z.object({ serviceId: z.string().uuid('Choose a service'), title: z.string().min(4, 'Add a short title').max(160), description: z.string().min(20, 'Give providers a little more detail').max(5000), locationHash: z.string().min(2, 'Add an area or postcode'), preferredStart: z.string().min(1, 'Choose a start time'), preferredEnd: z.string().min(1, 'Choose an end time'), budgetMinCents: z.coerce.number().int().min(0).optional(), budgetMaxCents: z.coerce.number().int().min(0).optional() });
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function RequestForm() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [files, setFiles] = useState<File[]>([]);
  const services = useQuery({ queryKey: ['services'], queryFn: () => apiFetch<{ items: Service[] }>('/services') });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch('/users/me'), retry: false });
  useEffect(() => {
    if (profile.isError) {
      router.replace(`/login?next=${encodeURIComponent(`${pathname}?${searchParams.toString()}`)}`);
    }
  }, [pathname, profile.isError, router, searchParams]);
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: { serviceId: searchParams.get('service') ?? '' } });
  const submit = async (values: FormOutput) => {
    try {
      const created = await apiFetch<ServiceRequest>('/requests', { method: 'POST', body: JSON.stringify({ ...values, preferredStart: new Date(values.preferredStart).toISOString(), preferredEnd: new Date(values.preferredEnd).toISOString() }) });
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await apiUpload(`/requests/${created.id}/attachments`, formData);
      }
      router.push('/dashboard');
    } catch (error) { setError('root', { message: error instanceof Error ? error.message : 'Could not create request' }); }
  };

  if (profile.isLoading || profile.isError) return <div className="status-panel"><LoaderCircle className="spin" size={20} /> {profile.isError ? 'Taking you to login...' : 'Checking your account...'}</div>;
  return <form className="request-form" onSubmit={handleSubmit(submit)}>
    <label>Request type<select {...register('serviceId')}><option value="">Choose a request type</option>{services.data?.items.map((service) => <option value={service.id} key={service.id}>{service.name} · {service.category.name}</option>)}</select>{errors.serviceId && <em>{errors.serviceId.message}</em>}</label>
    <label>What do you need help with?<input {...register('title')} placeholder="e.g. Kitchen sink is leaking" />{errors.title && <em>{errors.title.message}</em>}</label>
    <label>Describe the job<textarea {...register('description')} placeholder="Tell providers what is happening, what you have tried, and anything useful to know." rows={5} />{errors.description && <em>{errors.description.message}</em>}</label>
    <label>Photos <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))} /><small className="field-help">Up to 3 JPG, PNG, or WebP images, 5MB each.</small></label>
    <label>Area or postcode<input {...register('locationHash')} placeholder="e.g. N1 or North London" />{errors.locationHash && <em>{errors.locationHash.message}</em>}</label>
    <div className="form-grid"><label>Preferred start<input type="datetime-local" {...register('preferredStart')} />{errors.preferredStart && <em>{errors.preferredStart.message}</em>}</label><label>Preferred end<input type="datetime-local" {...register('preferredEnd')} />{errors.preferredEnd && <em>{errors.preferredEnd.message}</em>}</label></div>
    <div className="form-grid"><label>Budget from <span className="input-suffix">$</span><input type="number" {...register('budgetMinCents', { setValueAs: (value) => value ? Number(value) * 100 : undefined })} placeholder="Optional" /></label><label>Budget up to <span className="input-suffix">$</span><input type="number" {...register('budgetMaxCents', { setValueAs: (value) => value ? Number(value) * 100 : undefined })} placeholder="Optional" /></label></div>
    {errors.root && <p className="form-error">{errors.root.message}</p>}
    <button className="button button-dark button-wide" disabled={isSubmitting}>{isSubmitting ? <><LoaderCircle className="spin" size={17} /> Publishing...</> : <>Publish request <ArrowRight size={17} /></>}</button>
  </form>;
}
