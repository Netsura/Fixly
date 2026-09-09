'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, LoaderCircle, MapPin, MessageSquare, Star, Wrench } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AppShell } from '../../../components/app-shell';
import { apiFetch, Profile } from '../../../lib/api';

type PublicProfile = Pick<Profile, 'id' | 'role'> & {
  profile: { displayName: string; bio: string | null; ratingAverage: string; ratingCount: number; serviceArea: unknown } | null;
  services: { id: string; name: string; slug: string }[];
  requests: { id: string; title: string; status: string; service: { id: string; name: string; slug: string } }[];
};

type Conversation = { id: string };

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  const profile = useQuery({ queryKey: ['public-profile', id], queryFn: () => apiFetch<PublicProfile>(`/users/${id}`) });
  const startChat = useMutation({
    mutationFn: () => apiFetch<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ participantUserId: id }) }),
    onSuccess: (conversation) => router.push(`/messages?c=${conversation.id}`),
  });

  if (profile.isLoading) {
    return (
      <AppShell>
        <section className="page-section">
          <div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading provider...</div>
        </section>
      </AppShell>
    );
  }

  if (profile.isError || !profile.data?.profile) {
    return (
      <AppShell>
        <section className="page-section">
          <div className="status-panel error-panel">This provider profile is not available.</div>
        </section>
      </AppShell>
    );
  }

  const person = profile.data.profile;
  const isOwnProfile = me.data?.id === profile.data.id;
  const canMessage = Boolean(me.data) && !isOwnProfile;

  return (
    <AppShell>
      <section className="page-section public-profile-page">
        <Link href="/services" className="back-link"><ArrowLeft size={16} /> Back to services</Link>
        <div className="public-profile-hero">
          <div className="public-avatar">{person.displayName.slice(0, 1)}</div>
          <div className="eyebrow">Verified Fixly provider</div>
          <h1>{person.displayName}<br /><i>does good work.</i></h1>
          <div className="public-profile-rating">
            <Star size={16} fill="currentColor" />
            {person.ratingCount ? `${person.ratingAverage} from ${person.ratingCount} reviews` : 'New provider'}
          </div>
          <p>{person.bio ?? 'This provider has not added a bio yet.'}</p>
          {person.serviceArea !== null && person.serviceArea !== undefined && (
            <span className="public-location"><MapPin size={15} /> Local service area</span>
          )}
          <div className="public-profile-actions">
            {canMessage && (
              <button className="button button-dark" onClick={() => startChat.mutate()} disabled={startChat.isPending}>
                {startChat.isPending ? <LoaderCircle className="spin" size={16} /> : <MessageSquare size={16} />}
                Start chat
              </button>
            )}
            {!me.data && (
              <Link className="button button-dark" href="/login">Log in to message</Link>
            )}
            {isOwnProfile && (
              <Link className="button button-light" href="/profile">Edit your profile</Link>
            )}
            <Link className="button button-light" href="/messages">
              Messages <ArrowRight size={16} />
            </Link>
          </div>
          {startChat.isError && <div className="status-panel error-panel">{(startChat.error as Error).message}</div>}
        </div>

        {profile.data.services.length > 0 && (
          <div className="public-profile-section">
            <div className="section-label"><span>Services</span><span>{profile.data.services.length}</span></div>
            <div className="public-service-list">
              {profile.data.services.map((service) => (
                <Link className="public-service-row" href={`/services/${service.slug}`} key={service.id}>
                  <span className="avatar"><Wrench size={15} /></span>
                  <span>
                    <strong>{service.name}</strong>
                    <small>View this service</small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {profile.data.requests.length > 0 && (
          <div className="public-profile-section">
            <div className="section-label"><span>Recent requests</span><span>{profile.data.requests.length}</span></div>
            <div className="public-request-list">
              {profile.data.requests.map((request) => (
                <Link className="public-request-row" href={`/services/${request.service.slug}`} key={request.id}>
                  <span>
                    <strong>{request.title}</strong>
                    <small>{request.service.name} · {request.status.replaceAll('_', ' ').toLowerCase()}</small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
