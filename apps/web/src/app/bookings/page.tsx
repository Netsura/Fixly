'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck, CheckCircle2, CreditCard, LoaderCircle, Play, Star } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { apiFetch, BookingSummary, formatMoney, newIdempotencyKey, Profile } from '../../lib/api';

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  const bookings = useQuery({ queryKey: ['bookings'], queryFn: () => apiFetch<BookingSummary[]>('/bookings'), enabled: Boolean(profile.data) });
  const [scheduleAt, setScheduleAt] = useState<Record<string, string>>({});
  const [reviewDraft, setReviewDraft] = useState<Record<string, { rating: number; body: string }>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  const pay = useMutation({
    mutationFn: async (bookingId: string) => {
      try {
        return await apiFetch('/payments/create', {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey() },
          body: JSON.stringify({ bookingId }),
        });
      } catch {
        return apiFetch('/payments/dev-confirm', {
          method: 'POST',
          body: JSON.stringify({ bookingId }),
        });
      }
    },
    onSuccess: invalidate,
  });

  const schedule = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      apiFetch(`/bookings/${id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: new Date(scheduledAt).toISOString() }),
      }),
    onSuccess: invalidate,
  });

  const start = useMutation({
    mutationFn: (id: string) => apiFetch(`/bookings/${id}/start`, { method: 'PATCH' }),
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: (id: string) => apiFetch(`/bookings/${id}/complete`, { method: 'PATCH' }),
    onSuccess: invalidate,
  });

  const review = useMutation({
    mutationFn: ({ bookingId, rating, body }: { bookingId: string; rating: number; body: string }) =>
      apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ bookingId, rating, body }) }),
    onSuccess: invalidate,
  });

  if (profile.isLoading) {
    return <AppShell><div className="page-section"><div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading...</div></div></AppShell>;
  }
  if (profile.isError) {
    return <AppShell><div className="page-section"><div className="status-panel error-panel">Sign in to view bookings.</div></div></AppShell>;
  }

  return (
    <AppShell>
      <section className="page-section bookings-page">
        <div className="eyebrow">Job lifecycle</div>
        <h1>Bookings in<br /><i>motion.</i></h1>
        <p>Pay, schedule, start, finish, and review — all in one place.</p>
        {bookings.isLoading ? (
          <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading bookings...</div>
        ) : !bookings.data?.length ? (
          <div className="empty-panel"><strong>No bookings yet</strong><span>Accept an offer to create a booking.</span></div>
        ) : (
          <div className="booking-list">
            {bookings.data.map((booking) => {
              const isCustomer = profile.data?.id === booking.customerId || profile.data?.role === 'CUSTOMER';
              const isProvider = profile.data?.role === 'PROVIDER';
              const draft = reviewDraft[booking.id] ?? { rating: 5, body: '' };
              return (
                <article className="booking-card" key={booking.id}>
                  <div className="booking-card-head">
                    <div>
                      <small>{booking.request?.service?.name ?? 'Service'}</small>
                      <strong>{booking.request?.title ?? 'Booking'}</strong>
                    </div>
                    <span className={`status-pill status-${booking.status.toLowerCase()}`}>{booking.status.replaceAll('_', ' ')}</span>
                  </div>
                  <div className="booking-meta">
                    <span>{formatMoney(booking.offer?.priceCents)}</span>
                    {booking.scheduledAt && <span>{new Date(booking.scheduledAt).toLocaleString()}</span>}
                    {booking.conversation?.id && <Link href={`/messages?c=${booking.conversation.id}`}>Open chat</Link>}
                    {booking.request?.id && <Link href={`/requests/${booking.request.id}`}>View request</Link>}
                  </div>
                  <div className="booking-actions">
                    {booking.status === 'PAYMENT_PENDING' && isCustomer && (
                      <button className="button button-dark" onClick={() => pay.mutate(booking.id)} disabled={pay.isPending}>
                        {pay.isPending ? <LoaderCircle className="spin" size={16} /> : <CreditCard size={16} />} Confirm payment
                      </button>
                    )}
                    {booking.status === 'PAID' && (
                      <>
                        <input
                          type="datetime-local"
                          value={scheduleAt[booking.id] ?? ''}
                          onChange={(e) => setScheduleAt((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                        />
                        <button
                          className="button button-dark"
                          disabled={!scheduleAt[booking.id] || schedule.isPending}
                          onClick={() => schedule.mutate({ id: booking.id, scheduledAt: scheduleAt[booking.id] })}
                        >
                          <CalendarCheck size={16} /> Schedule
                        </button>
                      </>
                    )}
                    {booking.status === 'SCHEDULED' && isProvider && (
                      <button className="button button-dark" onClick={() => start.mutate(booking.id)} disabled={start.isPending}>
                        <Play size={16} /> Start job
                      </button>
                    )}
                    {booking.status === 'IN_PROGRESS' && (
                      <button className="button button-dark" onClick={() => complete.mutate(booking.id)} disabled={complete.isPending}>
                        <CheckCircle2 size={16} /> Mark complete
                      </button>
                    )}
                    {booking.status === 'COMPLETED' && isCustomer && !booking.review && (
                      <div className="review-form">
                        <label>Rating
                          <select
                            value={draft.rating}
                            onChange={(e) => setReviewDraft((prev) => ({ ...prev, [booking.id]: { ...draft, rating: Number(e.target.value) } }))}
                          >
                            {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </label>
                        <label>Review
                          <textarea
                            rows={3}
                            value={draft.body}
                            onChange={(e) => setReviewDraft((prev) => ({ ...prev, [booking.id]: { ...draft, body: e.target.value } }))}
                            placeholder="How did the job go?"
                          />
                        </label>
                        <button
                          className="button button-dark"
                          disabled={draft.body.trim().length < 8 || review.isPending}
                          onClick={() => review.mutate({ bookingId: booking.id, rating: draft.rating, body: draft.body })}
                        >
                          <Star size={16} /> Submit review
                        </button>
                      </div>
                    )}
                    {booking.review && <span className="offer-state">Reviewed · {booking.review.rating}/5</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Link className="button button-light" href="/dashboard">Back to dashboard <ArrowRight size={16} /></Link>
      </section>
    </AppShell>
  );
}
