'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Ban, BarChart3, LoaderCircle, Users } from 'lucide-react';
import { AppShell } from '../../components/app-shell';
import { apiFetch, formatMoney, Profile } from '../../lib/api';

type Stats = { users: number; customers: number; providers: number; requests: number; completedJobs: number; revenueCents: number; activeJobs: number; averageRating: number };
type AdminUser = { id: string; email: string; role: string; suspendedAt: string | null; profile: Profile['profile'] };

export default function AdminPage() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => apiFetch<Stats>('/admin/statistics') });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => apiFetch<{ items: AdminUser[]; total: number }>('/admin/users') });
  return <AppShell><section className="page-section admin-page"><div className="eyebrow"><Activity size={14} /> Operations overview</div><div className="admin-heading"><div><h1>Keep Fixly<br /><i>healthy.</i></h1><p>Platform health, users, and marketplace activity in one quiet place.</p></div><span className="admin-badge">Admin only</span></div>{stats.isLoading ? <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading statistics...</div> : stats.isError ? <div className="status-panel error-panel">Admin access is required.</div> : <div className="admin-stats"><div><Users size={18} /><small>Total users</small><strong>{stats.data?.users}</strong></div><div><BarChart3 size={18} /><small>Requests</small><strong>{stats.data?.requests}</strong></div><div><Activity size={18} /><small>Active jobs</small><strong>{stats.data?.activeJobs}</strong></div><div><span className="stat-symbol">$</span><small>Revenue</small><strong>{formatMoney(stats.data?.revenueCents)}</strong></div></div>}<div className="section-label"><span>User moderation</span><span>{users.data?.total ?? 0} accounts</span></div>{users.isLoading ? <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading users...</div> : <div className="admin-user-list">{users.data?.items.map((user) => <div className="admin-user-row" key={user.id}><span><strong>{user.profile?.displayName ?? user.email}</strong><small>{user.email} · {user.role}</small></span>{user.suspendedAt ? <span className="status-pill status-cancelled"><Ban size={12} /> Suspended</span> : <span className="status-pill status-published">Active</span>}</div>)}</div>}</section></AppShell>;
}
