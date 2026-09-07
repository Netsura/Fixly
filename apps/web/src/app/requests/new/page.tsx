import { Suspense } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '../../../components/app-shell';
import { RequestForm } from '../../../components/request-form';

export default function NewRequestPage() {
  return <AppShell><section className="page-section form-page"><Link href="/services" className="back-link"><ArrowLeft size={16} /> Back to services</Link><div className="form-page-grid"><div><div className="eyebrow">Start with the job</div><h1>Tell us what<br /><i>needs fixing.</i></h1><p className="form-lede">Your request goes to relevant local providers. You stay in control of who you choose and what you pay.</p><div className="trust-line"><ShieldCheck size={19} /><span><strong>Your details stay private.</strong><br />Only matched providers see the job details.</span></div></div><div className="form-card request-card"><h2>New service request</h2><p>Give providers enough detail to make a useful offer.</p><Suspense fallback={<div className="status-panel">Loading form...</div>}><RequestForm /></Suspense></div></div></section></AppShell>;
}
