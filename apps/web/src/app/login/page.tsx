import { Suspense } from 'react';
import { AppShell } from '../../components/app-shell';
import { AuthForm } from '../../components/auth-form';

export default function LoginPage() {
  return <AppShell><section className="auth-page"><div className="auth-intro"><div className="eyebrow">Welcome back</div><h1>Your next fix<br /><i>starts here.</i></h1><p>Pick up where you left off and keep the jobs that matter moving.</p></div><div className="form-card"><h2>Log in</h2><p>Use your Fixly account to see your workspace.</p><Suspense fallback={<div className="status-panel">Loading login...</div>}><AuthForm mode="login" /></Suspense></div></section></AppShell>;
}
