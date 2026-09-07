'use client';

import { ArrowLeft, Check, LoaderCircle, MapPin, MessageSquare, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../../components/app-shell';
import { apiFetch, formatMoney, Offer, ServiceRequest } from '../../../lib/api';

type RequestDetail = ServiceRequest & {
  customer?: { id: string; profile: { displayName: string } | null };
  booking?: { id: string; conversation?: { id: string } | null } | null;
};

type AcceptResult = { id: string; conversation?: { id: string } | null };

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const request = useQuery({ queryKey: ['request', params.id], queryFn: () => apiFetch<RequestDetail>(`/requests/${params.id}`) });
  const offers = useQuery({ queryKey: ['offers', params.id], queryFn: () => apiFetch<Offer[]>(`/requests/${params.id}/offers`), enabled: Boolean(request.data) });
  const accept = useMutation({
    mutationFn: (offerId: string) => apiFetch<AcceptResult>(`/offers/${offerId}/accept`, { method: 'PATCH' }),
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['request', params.id] });
      queryClient.invalidateQueries({ queryKey: ['offers', params.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (booking.conversation?.id) {
        router.push(`/messages?c=${booking.conversation.id}`);
      }
    },
  });

  if (request.isLoading) {
    return <AppShell><div className="page-section"><div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading request...</div></div></AppShell>;
  }
  if (request.isError || !request.data) {
    return <AppShell><div className="page-section"><div className="status-panel error-panel">This request could not be loaded.</div></div></AppShell>;
  }

  const item = request.data;

  return (
    <AppShell>
      <section className="page-section detail-page">
        <button className="back-link" onClick={() => router.back()}><ArrowLeft size={16} /> Back</button>
        <div className="detail-heading">
          <div>
            <div className="eyebrow">
              <Link href={`/services/${item.service.id}`}>{item.service.name}</Link> request
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
        {item.booking?.conversation?.id && (
          <div className="detail-actions">
            <Link className="button button-dark" href={`/messages?c=${item.booking.conversation.id}`}>
              <MessageSquare size={16} /> Open chat
            </Link>
          </div>
        )}
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
                {offer.status === 'PENDING' && item.status === 'OFFER_RECEIVED' && (
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
