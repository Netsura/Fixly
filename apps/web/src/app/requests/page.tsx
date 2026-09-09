'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardList, Search } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { RequestList } from '../../components/request-list';

export default function RequestsPage() {
  const [search, setSearch] = useState('');
  return <AppShell><section className="page-section requests-page"><div className="eyebrow"><ClipboardList size={14} /> Request history</div><div className="page-heading"><div><h1>Every job,<br /><i>in one place.</i></h1><p>Search by service type, job title, area, or description.</p></div><Link className="button button-dark" href="/requests/new">Create request <ArrowRight size={16} /></Link></div><label className="directory-search request-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try plumbing, electrical, cleaning..." aria-label="Search your requests" /></label><RequestList search={search} /></section></AppShell>;
}
