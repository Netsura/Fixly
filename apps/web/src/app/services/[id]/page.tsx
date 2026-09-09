'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, LoaderCircle, Wrench } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../../components/app-shell';
import { apiFetch, Service } from '../../../lib/api';

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const service = useQuery({ queryKey: ['service', id], queryFn: () => apiFetch<Service>(`/services/slug/${id}`) });
  if (service.isLoading) return <AppShell><section className="page-section"><div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading service...</div></section></AppShell>;
  if (service.isError || !service.data) return <AppShell><section className="page-section"><div className="status-panel error-panel">This service is not available.</div></section></AppShell>;
  return <AppShell><section className="page-section service-detail-page"><Link className="back-link" href="/services"><ArrowLeft size={16} /> All services</Link><div className="service-detail-hero"><div className="service-detail-icon"><Wrench size={30} /></div><div className="eyebrow">{service.data.category.name}</div><h1>{service.data.name}<br /><i>made simple.</i></h1><p>Tell us what needs doing and relevant local professionals can respond with clear offers.</p><Link className="button button-dark" href={`/requests/new?service=${service.data.id}`}>Start a request <ArrowRight size={17} /></Link></div><div className="service-steps"><div><strong>01</strong><span>Describe the job</span></div><div><strong>02</strong><span>Compare useful offers</span></div><div><strong>03</strong><span>Choose with confidence</span></div></div></section></AppShell>;
}
