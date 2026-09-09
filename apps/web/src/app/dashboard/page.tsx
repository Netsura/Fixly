'use client';

import Link from 'next/link';
import { ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { ProductGuide } from '../../components/product-guide';
import { RequestList } from '../../components/request-list';
import { apiFetch, Profile } from '../../lib/api';

export default function DashboardPage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  return (
    <AppShell>
      <section className="page-section dashboard-page">
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">Your workspace</div>
            <h1>Keep the home fires<br /><i>under control.</i></h1>
            <p>Track requests, compare offers, and keep every job moving.</p>
          </div>
          <Link className="button button-dark" href="/requests/new"><Plus size={17} /> New request</Link>
        </div>
        <ProductGuide role={profile.data?.role} />
        <div className="stats-strip">
          <div><small>Open requests</small><strong>Live from your account</strong></div>
          <div><small>Offers received</small><strong>Check each request</strong></div>
          <div><small>Next step</small><strong>Tell us what needs doing</strong></div>
        </div>
        <div className="section-label"><span>Recent requests</span><Link href="/requests/new">Create another <ArrowUpRight size={15} /></Link></div>
        <RequestList />
        <div className="tip-band"><Sparkles size={20} /><span><strong>A sharper brief gets better offers.</strong> Add a photo and a clear description when you create your next request.</span></div>
      </section>
    </AppShell>
  );
}
