'use client';

import Link from 'next/link';
import { ArrowUpRight, ClipboardList, LoaderCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, formatMoney, ServiceRequest } from '../lib/api';

const statusLabels: Record<string, string> = {
  PUBLISHED: 'Open for offers',
  OFFER_RECEIVED: 'Offers received',
  PROVIDER_SELECTED: 'Provider selected',
  PAYMENT_PENDING: 'Payment pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function RequestList({ search = '' }: { search?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['requests', search],
    queryFn: () => apiFetch<{ items: ServiceRequest[]; total: number }>(`/requests${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  if (isLoading) return <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading your requests...</div>;
  if (isError) return <div className="status-panel error-panel">Sign in to see your workspace, or check that the API is running.</div>;
  if (!data?.items.length) return <div className="empty-panel"><ClipboardList size={24} /><strong>No requests yet</strong><span>Tell us what needs doing and local pros will come to you.</span><Link className="button button-dark" href="/requests/new">Create a request <ArrowUpRight size={16} /></Link></div>;

  return <div className="request-list">{data.items.map((request) => <Link className="request-row" href={`/requests/${request.id}`} key={request.id}><span className="request-row-main"><small>{request.service.name}</small><strong>{request.title}</strong></span><span className="request-row-meta"><span className={`status-pill status-${request.status.toLowerCase()}`}>{statusLabels[request.status] ?? request.status}</span><span>{formatMoney(request.budgetMaxCents)}</span><ArrowUpRight size={17} /></span></Link>)}</div>;
}
