'use client';

import Link from 'next/link';
import { CheckCircle2, ClipboardList, MessageSquare, Sparkles, WalletCards } from 'lucide-react';

const steps = [
  {
    icon: ClipboardList,
    title: 'Create a request',
    text: 'Describe the job, add a photo, and publish it to nearby providers.',
    href: '/requests/new',
  },
  {
    icon: WalletCards,
    title: 'Compare offers',
    text: 'Providers reply with a price and timing. Accept the one that fits.',
    href: '/requests',
  },
  {
    icon: MessageSquare,
    title: 'Pay and chat',
    text: 'Confirm payment, schedule the job, and keep everything in one thread.',
    href: '/bookings',
  },
  {
    icon: CheckCircle2,
    title: 'Finish and review',
    text: 'Mark the job complete, then leave a short review for the next person.',
    href: '/bookings',
  },
];

export function ProductGuide({ role }: { role?: string }) {
  const provider = role === 'PROVIDER';
  return (
    <section className="product-guide reveal">
      <div className="product-guide-copy">
        <div className="eyebrow"><Sparkles size={14} /> How Fixly works</div>
        <h2>{provider ? 'Win good local work.' : 'Get help in four clear steps.'}</h2>
        <p>
          {provider
            ? 'Browse open jobs, send a clear offer, then run the booking through to completion.'
            : 'You stay in control of the request, the offer you accept, and when the job is done.'}
        </p>
      </div>
      <div className="guide-steps">
        {(provider
          ? [
              { icon: ClipboardList, title: 'Find open jobs', text: 'Search requests by service or area and open the ones that fit.', href: '/provider/requests' },
              { icon: WalletCards, title: 'Send an offer', text: 'Share your price, availability, and what’s included.', href: '/provider/requests' },
              { icon: MessageSquare, title: 'Run the booking', text: 'Once accepted, schedule, start, and complete the job.', href: '/bookings' },
              { icon: CheckCircle2, title: 'Build your rating', text: 'Completed work turns into reviews on your profile.', href: '/profile' },
            ]
          : steps
        ).map(({ icon: Icon, title, text, href }) => (
          <Link className="guide-step" href={href} key={title}>
            <span className="guide-step-icon"><Icon size={18} /></span>
            <strong>{title}</strong>
            <span>{text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
