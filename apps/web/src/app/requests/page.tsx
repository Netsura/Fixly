import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { AppShell } from '../../components/app-shell';
import { RequestList } from '../../components/request-list';

export default function RequestsPage() {
  return <AppShell><section className="page-section requests-page"><div className="eyebrow"><ClipboardList size={14} /> Request history</div><div className="page-heading"><div><h1>Every job,<br /><i>in one place.</i></h1><p>Follow the request from the first detail to the final handoff.</p></div><Link className="button button-dark" href="/requests/new">Create request <ArrowRight size={16} /></Link></div><RequestList /></section></AppShell>;
}
