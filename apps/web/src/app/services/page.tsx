'use client';

import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { ServiceGrid } from '../../components/service-grid';
import { apiFetch, Service } from '../../lib/api';

export default function ServicesPage() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const catalog = useQuery({ queryKey: ['service-types'], queryFn: () => apiFetch<{ items: Service[] }>('/services?limit=50') });
  const categories = Array.from(new Map((catalog.data?.items ?? []).map((service) => [service.category.id, service.category])).values());
  return <AppShell><section className="page-section directory-page"><div className="eyebrow">The local services directory</div><div className="page-heading"><div><h1>Good help is closer<br /><i>than you think.</i></h1><p>Search by type: plumbing, electrical, cleaning, gardening, moving, and more.</p></div><label className="directory-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search plumbing, electrical..." aria-label="Search services" /></label></div><div className="search-chips service-type-chips"><button className={!categoryId ? 'is-selected' : ''} onClick={() => setCategoryId('')}>All types</button>{categories.map((category) => <button className={categoryId === category.id ? 'is-selected' : ''} onClick={() => setCategoryId(category.id)} key={category.id}>{category.name}</button>)}</div><ServiceGrid search={search} categoryId={categoryId} /><div className="callout-band"><span>{search || categoryId ? 'Found the right kind of help?' : 'Ready to get something sorted?'}</span><Link className="button button-dark" href="/requests/new">Start a request <ArrowRight size={16} /></Link></div></section></AppShell>;
}
