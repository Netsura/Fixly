import { AppShell } from '../../components/app-shell';
import { AuthForm } from '../../components/auth-form';

export default function RegisterPage() {
  return <AppShell><section className="auth-page"><div className="auth-intro"><div className="eyebrow">A better way to get things done</div><h1>Find your<br /><i>fixers.</i></h1><p>One clear request. Real local professionals. No chasing three different numbers.</p></div><div className="form-card"><h2>Create your account</h2><p>It takes less than a minute to get started.</p><AuthForm mode="register" /></div></section></AppShell>;
}
