'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardList, MessageSquare, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { ProfileForm } from '../../components/profile-form';
import { apiFetch, Profile } from '../../lib/api';

export default function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });

  return (
    <AppShell>
      <section className="page-section profile-page">
        <div className="eyebrow">Account details</div>
        <div className="profile-heading">
          <div>
            <h1>Make it<br /><i>personal.</i></h1>
            <p>Keep your Fixly profile current so every interaction starts with the right context.</p>
          </div>
        </div>
        <div className="profile-routes">
          <Link href="/messages"><MessageSquare size={16} /> Messages <ArrowRight size={15} /></Link>
          <Link href="/requests"><ClipboardList size={16} /> Your requests <ArrowRight size={15} /></Link>
          {profile.data?.role === 'PROVIDER' && (
            <Link href={`/profiles/${profile.data.id}`}><UserRound size={16} /> Public profile <ArrowRight size={15} /></Link>
          )}
        </div>
        <div className="profile-grid">
          <div className="profile-card"><ProfileForm /></div>
          <aside className="profile-side">
            <span className="avatar avatar-large">{profile.data?.profile?.displayName?.slice(0, 1) ?? 'F'}</span>
            <strong>Your Fixly profile</strong>
            <p>Your details are shared only when they help a customer or provider make a better decision.</p>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
