'use client';

import { Bell, LoaderCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { apiFetch, NotificationItem } from '../../lib/api';

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<NotificationItem[]>('/notifications'),
    retry: false,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <AppShell>
      <section className="page-section notifications-page">
        <div className="eyebrow"><Bell size={14} /> Inbox</div>
        <h1>Stay on top<br /><i>of the work.</i></h1>
        <p>Messages, offers, and job updates land here.</p>
        {notifications.isLoading ? (
          <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading notifications...</div>
        ) : notifications.isError ? (
          <div className="status-panel error-panel">Sign in to view notifications.</div>
        ) : !notifications.data?.length ? (
          <div className="empty-panel"><strong>All quiet</strong><span>New activity will show up here.</span></div>
        ) : (
          <div className="notification-list">
            {notifications.data.map((item) => (
              <article className={`notification-row ${item.readAt ? '' : 'is-unread'}`} key={item.id}>
                <div>
                  <strong>{item.type.replaceAll('_', ' ')}</strong>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                  <p>{typeof item.payload?.preview === 'string' ? item.payload.preview : JSON.stringify(item.payload)}</p>
                </div>
                {!item.readAt && (
                  <button className="button button-light" onClick={() => markRead.mutate(item.id)} disabled={markRead.isPending}>
                    Mark read
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
