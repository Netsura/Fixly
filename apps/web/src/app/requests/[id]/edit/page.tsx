import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '../../../../components/app-shell';
import { RequestEditLoader } from '../../../../components/request-edit-loader';

export default function EditRequestPage() {
  return <AppShell><section className="page-section form-page"><Link href="/requests" className="back-link"><ArrowLeft size={16} /> Back to requests</Link><div className="form-page-grid"><div><div className="eyebrow">Update your request</div><h1>Keep the brief<br /><i>up to date.</i></h1><p className="form-lede">You can change a request while it is still open for provider offers.</p></div><div className="form-card request-card"><h2>Edit request</h2><Suspense fallback={<div className="status-panel">Loading request...</div>}><RequestEditLoader /></Suspense></div></div></section></AppShell>;
}
