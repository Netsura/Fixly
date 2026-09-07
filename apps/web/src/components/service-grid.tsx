'use client';

import Link from 'next/link';
import { ArrowUpRight, LoaderCircle, Wrench } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, Service } from '../lib/api';

export function ServiceGrid({ limit, search = '' }: { limit?: number; search?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['services', limit],
    queryFn: () => apiFetch<{ items: Service[]; total: number }>(`/services?limit=${limit ?? 20}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });

  if (isLoading) return <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading local services...</div>;
  if (isError) return <div className="status-panel error-panel">Services are unavailable right now. Check that the API is running.</div>;

  return (
    <div className="service-grid">
      {data?.items.slice(0, limit).map((service) => (
        <Link href={`/services/${service.id}`} className="service-card" key={service.id}>
          <span className="service-icon"><Wrench size={19} /></span>
          <span><small>{service.category.name}</small><strong>{service.name}</strong></span>
          <ArrowUpRight className="card-arrow" size={18} />
        </Link>
      ))}
    </div>
  );
}
