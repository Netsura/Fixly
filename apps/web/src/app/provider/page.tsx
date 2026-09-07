import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, UserRound } from 'lucide-react';
import { AppShell } from '../../components/app-shell';

export default function ProviderPage() {
  return <AppShell><section className="page-section provider-page"><div className="eyebrow">Provider workspace</div><h1>Make your<br /><i>work count.</i></h1><p>See relevant local jobs, respond with a clear offer, and keep the work you accept organised.</p><div className="provider-actions"><Link className="button button-dark" href="/provider/requests"><BriefcaseBusiness size={17} /> Find requests <ArrowRight size={16} /></Link><Link className="button button-light" href="/profile"><UserRound size={17} /> Edit profile</Link></div></section></AppShell>;
}
