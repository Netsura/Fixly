'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bell, BriefcaseBusiness, ClipboardList, Compass, Hammer, LogOut, Menu, MessageSquare, UserRound, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, Profile } from '../lib/api';
import { useState } from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  const links = [
    { href: '/services', label: 'Find a service', icon: Compass },
    { href: '/requests', label: 'Requests', icon: ClipboardList },
    { href: '/bookings', label: 'Bookings', icon: BriefcaseBusiness },
    { href: '/messages', label: 'Messages', icon: MessageSquare },
    { href: '/notifications', label: 'Alerts', icon: Bell },
  ];

  return (
    <div className="site-frame">
      <header className="topbar">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark"><Hammer size={18} strokeWidth={2.5} /></span>
          <span>fixly<span className="brand-dot">.</span></span>
        </Link>
        <button className="icon-button mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`main-nav ${open ? 'is-open' : ''}`}>
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}><Icon size={16} />{label}</Link>
          ))}
          {profile.data?.role === 'PROVIDER' && (
            <Link href="/provider/requests" onClick={() => setOpen(false)}><BriefcaseBusiness size={16} />Open jobs</Link>
          )}
          {profile.data?.role === 'ADMIN' && (
            <Link href="/admin" onClick={() => setOpen(false)}>Admin</Link>
          )}
          <span className="nav-divider" />
          {profile.data ? (
            <>
              <Link href="/profile" className="nav-login" onClick={() => setOpen(false)}><UserRound size={16} /> Profile</Link>
              <button
                className="nav-logout"
                onClick={async () => {
                  await apiFetch('/auth/logout', { method: 'POST' });
                  queryClient.removeQueries({ queryKey: ['profile'] });
                  router.push('/');
                  router.refresh();
                }}
              >
                <LogOut size={15} /> Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="nav-login" onClick={() => setOpen(false)}>Log in</Link>
              <Link href="/register" className="button button-small" onClick={() => setOpen(false)}>Join Fixly <ArrowUpRight size={15} /></Link>
            </>
          )}
        </nav>
      </header>
      <main>{children}</main>
      <footer className="footer"><span>fixly. Local help, made simple.</span><span>Built for the work that keeps life moving.</span></footer>
    </div>
  );
}
