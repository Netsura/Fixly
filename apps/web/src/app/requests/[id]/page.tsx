'use client';

import { ArrowLeft, Check, Edit3, LoaderCircle, MapPin, MessageSquare, ShieldCheck, Trash2, UserRound, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../../components/app-shell';
import { OfferForm } from '../../../components/offer-form';
import { apiFetch, formatMoney, Offer, Profile, ServiceRequest } from '../../../lib/api';

type RequestDetail = ServiceRequest;

type AcceptResult = { id: string; conversation?: { id: string } | null };

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  const request = useQuery({ queryKey: ['request', params.id], queryFn: () => apiFetch<RequestDetail>(`/requests/${params.id}`) });
  const offers = useQuery({ queryKey: ['offers', params.id], queryFn: () => apiFetch<Offer[]>(`/requests/${params.id}/offers`), enabled: Boolean(request.data) });
  const accept = useMutation({
    mutationFn: (offerId: string) => apiFetch<AcceptResult>(`/offers/${offerId}/accept`, { method: 'PATCH' }),
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['request', params.id] });
      queryClient.invalidateQueries({ queryKey: ['offers', params.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (booking.conversation?.id) {
        router.push(`/messages?c=${booking.conversation.id}`);
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/requests/${params.id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/requests'),
  });
  const publish = useMutation({
    mutationFn: () => apiFetch(`/requests/${params.id}/publish`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['request', params.id] }),
  });

  if (request.isLoading) {
    return <AppShell><div className="page-section"><div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading request...</div></div></AppShell>;
  }
  if (request.isError || !request.data) {
    return <AppShell><div className="page-section"><div className="status-panel error-panel">This request could not be loaded.</div></div></AppShell>;
  }

  const item = request.data;
  const isProvider = profile.data?.role === 'PROVIDER';
  const isCustomer = profile.data?.role === 'CUSTOMER';
  const alreadyOffered = Boolean(offers.data?.some((offer) => offer.provider.id === profile.data?.id));
  const canOffer = isProvider && ['PUBLISHED', 'OFFER_RECEIVED'].includes(item.status) && !alreadyOffered;

  return (
    <AppShell>
      <section className="page-section detail-page">
        <button className="back-link" onClick={() => router.back()}><ArrowLeft size={16} /> Back</button>
        <div className="detail-heading">
          <div>
            <div className="eyebrow">
              <Link href={`/services/${item.service.slug}`}>{item.service.name}</Link> request
            </div>
            <h1>{item.title}</h1>
            <p>{item.description}</p>
          </div>
          <span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>
        </div>
        <div className="detail-meta">
          <span><MapPin size={16} /> Location shared with matched providers</span>
          <span>{formatMoney(item.budgetMinCents)} – {formatMoney(item.budgetMaxCents)}</span>
          <span><ShieldCheck size={16} /> Private request</span>
        </div>
        <div className="request-people">
          {item.customer?.profile && <Link href={`/profiles/${item.customer.id}`} className="request-person"><UserRound size={16} /><span><small>Requested by</small><strong>{item.customer.profile.displayName}</strong></span></Link>}
          {isCustomer && (['DRAFT', 'PUBLISHED'] as string[]).includes(item.status) && (
            <div className="request-management">
              {item.status === 'DRAFT' && (
                <button className="button button-dark" onClick={() => publish.mutate()} disabled={publish.isPending}>
                  Publish request
                </button>
              )}
              <Link className="button button-light" href={`/requests/${item.id}/edit`}><Edit3 size={15} /> Edit</Link>
              <button className="button button-danger" onClick={() => { if (window.confirm('Cancel this request?')) remove.mutate(); }} disabled={remove.isPending}><Trash2 size={15} /> Cancel</button>
            </div>
          )}
        </div>
        <div className="request-timeline">
          <span className="timeline-done">Request created</span>
          <span className={item.status !== 'PUBLISHED' && item.status !== 'DRAFT' ? 'timeline-done' : ''}>Offers collected</span>
          <span className={['PROVIDER_SELECTED', 'PAYMENT_PENDING', 'PAID', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED'].includes(item.status) ? 'timeline-done' : ''}>Provider selected</span>
          <span className={['PAID', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED'].includes(item.status) ? 'timeline-done' : ''}>Payment and job</span>
        </div>
        <div className="detail-actions">
          {item.booking?.conversation?.id && (
            <Link className="button button-dark" href={`/messages?c=${item.booking.conversation.id}`}>
              <MessageSquare size={16} /> Open chat
            </Link>
          )}
          {item.booking?.id && (
            <Link className="button button-light" href="/bookings">
              <CalendarRange size={16} /> Manage booking
            </Link>
          )}
        </div>
        {canOffer && <OfferForm requestId={item.id} />}
        <div className="section-label"><span>Provider offers</span><span>{offers.data?.length ?? 0} received</span></div>
        {offers.isLoading ? (
          <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading offers...</div>
        ) : !offers.data?.length ? (
          <div className="empty-panel"><strong>Waiting for local providers</strong><span>We will show offers here as they arrive.</span></div>
        ) : (
          <div className="offer-list">
            {offers.data.map((offer) => (
              <article className="offer-card" key={offer.id}>
                <div className="offer-person">
                  <div className="avatar">{offer.provider.profile?.displayName.slice(0, 1) ?? 'P'}</div>
                  <div>
                    <Link href={`/profiles/${offer.provider.id}`}>
                      <strong>{offer.provider.profile?.displayName ?? 'Local provider'}</strong>
                    </Link>
                    <small>
                      {offer.provider.profile?.ratingCount
                        ? `${offer.provider.profile.ratingAverage} rating from ${offer.provider.profile.ratingCount} jobs`
                        : 'New to Fixly'}
                    </small>
                  </div>
                </div>
                <div className="offer-price">{formatMoney(offer.priceCents)}<small>fixed offer</small></div>
                <p>{offer.message}</p>
                {isCustomer && offer.status === 'PENDING' && item.status === 'OFFER_RECEIVED' && (
                  <button className="button button-dark" onClick={() => accept.mutate(offer.id)} disabled={accept.isPending}>
                    {accept.isPending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Accept offer
                  </button>
                )}
                {offer.status === 'ACCEPTED' && item.booking?.conversation?.id && (
                  <Link className="button button-light" href={`/messages?c=${item.booking.conversation.id}`}>
                    <MessageSquare size={16} /> Message provider
                  </Link>
                )}
                {offer.status !== 'PENDING' && offer.status !== 'ACCEPTED' && <span className="offer-state">{offer.status}</span>}
                {offer.status === 'ACCEPTED' && !item.booking?.conversation?.id && <span className="offer-state">{offer.status}</span>}
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
