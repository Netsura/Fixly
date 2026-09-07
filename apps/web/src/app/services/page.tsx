'use client';

import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { ServiceGrid } from '../../components/service-grid';

export default function ServicesPage() {
  const [search, setSearch] = useState('');
  return <AppShell><section className="page-section directory-page"><div className="eyebrow">The local services directory</div><div className="page-heading"><div><h1>Good help is closer<br /><i>than you think.</i></h1><p>Search the work you need, then turn it into one clear request.</p></div><label className="directory-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search plumbing, cleaning..." aria-label="Search services" /></label></div><ServiceGrid search={search} /><div className="callout-band"><span>{search ? 'Found the right kind of help?' : 'Ready to get something sorted?'}</span><Link className="button button-dark" href="/requests/new">Start a request <ArrowRight size={16} /></Link></div></section></AppShell>;
}
