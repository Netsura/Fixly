'use client';

import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, LoaderCircle, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import { apiFetch, Service, ServiceRequest } from '../../../lib/api';

export default function ProviderRequestsPage() {
  const [search, setSearch] = useState('');
  const services = useQuery({ queryKey: ['services', 'request-filters'], queryFn: () => apiFetch<{ items: Service[] }>('/services?limit=8') });
  const requests = useQuery({ queryKey: ['provider-requests', search], queryFn: () => apiFetch<{ items: ServiceRequest[]; total: number }>(`/requests${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  return <AppShell><section className="page-section provider-list-page"><div className="eyebrow">Open local work</div><h1>Jobs worth<br /><i>showing up for.</i></h1><p>Search by service type, job title, area, or description.</p><label className="directory-search request-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try plumbing, electrical, cleaning..." aria-label="Search requests" /></label><div className="search-chips">{services.data?.items.map((service) => <button className={search === service.name ? 'is-selected' : ''} onClick={() => setSearch(search === service.name ? '' : service.name)} key={service.id}>{service.name}</button>)}</div>{requests.isLoading ? <div className="status-panel"><LoaderCircle className="spin" size={20} /> Finding requests...</div> : requests.isError ? <div className="status-panel error-panel">Provider access is required to view open requests.</div> : !requests.data?.items.length ? <div className="empty-panel"><BriefcaseBusiness size={24} /><strong>No matching requests yet</strong><span>Keep your profile current and check back soon.</span></div> : <div className="provider-request-list">{requests.data.items.map((request) => <Link className="request-row" href={`/requests/${request.id}`} key={request.id}><span className="request-row-main"><small>{request.service.name}</small><strong>{request.title}</strong></span><span className="request-row-meta"><span>{request.status.replaceAll('_', ' ')}</span><ArrowUpRight size={17} /></span></Link>)}</div>}</section></AppShell>;
}
