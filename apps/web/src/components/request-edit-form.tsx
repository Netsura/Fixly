'use client';

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiFetch, Service, ServiceRequest } from '../lib/api';

type EditValues = { serviceId: string; title: string; description: string; locationHash: string; preferredStart: string; preferredEnd: string; budgetMin: number | undefined; budgetMax: number | undefined };

function localDate(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function RequestEditForm({ request }: { request: ServiceRequest }) {
  const router = useRouter();
  const services = useQuery({ queryKey: ['services'], queryFn: () => apiFetch<{ items: Service[] }>('/services') });
  const form = useForm<EditValues>({ defaultValues: { serviceId: request.service.id, title: request.title, description: request.description, locationHash: request.locationHash ?? '', preferredStart: localDate(request.preferredStart), preferredEnd: localDate(request.preferredEnd), budgetMin: request.budgetMinCents ? request.budgetMinCents / 100 : undefined, budgetMax: request.budgetMaxCents ? request.budgetMaxCents / 100 : undefined } });
  const submit = async (values: EditValues) => {
    await apiFetch(`/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ serviceId: values.serviceId, title: values.title, description: values.description, locationHash: values.locationHash, preferredStart: new Date(values.preferredStart).toISOString(), preferredEnd: new Date(values.preferredEnd).toISOString(), budgetMinCents: values.budgetMin ? values.budgetMin * 100 : undefined, budgetMaxCents: values.budgetMax ? values.budgetMax * 100 : undefined }) });
    router.push(`/requests/${request.id}`);
    router.refresh();
  };
  return <form className="request-form" onSubmit={form.handleSubmit(submit)}><label>Service<select {...form.register('serviceId')}>{services.data?.items.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label><label>Request title<input {...form.register('title', { required: true })} /></label><label>Describe the job<textarea rows={5} {...form.register('description', { required: true })} /></label><label>Area or postcode<input {...form.register('locationHash', { required: true })} placeholder="Area or postcode" /></label><div className="form-grid"><label>Preferred start<input type="datetime-local" {...form.register('preferredStart', { required: true })} /></label><label>Preferred end<input type="datetime-local" {...form.register('preferredEnd', { required: true })} /></label></div><div className="form-grid"><label>Budget from<input type="number" {...form.register('budgetMin', { valueAsNumber: true })} /></label><label>Budget up to<input type="number" {...form.register('budgetMax', { valueAsNumber: true })} /></label></div><button className="button button-dark" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />} Save changes</button></form>;
}
