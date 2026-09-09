'use client';

import { LoaderCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ServiceRequest } from '../lib/api';
import { RequestEditForm } from './request-edit-form';

export function RequestEditLoader() {
  const { id } = useParams<{ id: string }>();
  const request = useQuery({ queryKey: ['request', id], queryFn: () => apiFetch<ServiceRequest>(`/requests/${id}`) });
  if (request.isLoading) return <div className="status-panel"><LoaderCircle className="spin" size={18} /> Loading...</div>;
  if (request.isError || !request.data) return <div className="status-panel error-panel">This request cannot be edited.</div>;
  return <RequestEditForm request={request.data} />;
}
