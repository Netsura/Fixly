'use client';

import { LoaderCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, Offer } from '../lib/api';

export function OfferForm({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [availableAt, setAvailableAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<Offer>(`/requests/${requestId}/offers`, {
        method: 'POST',
        body: JSON.stringify({
          priceCents: Math.round(Number(price) * 100),
          message,
          availableAt: new Date(availableAt).toISOString(),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['offers', requestId] });
      queryClient.invalidateQueries({ queryKey: ['provider-requests'] });
      setPrice('');
      setMessage('');
      setAvailableAt('');
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not submit offer'),
  });

  return (
    <form
      className="offer-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!price || !message || !availableAt) {
          setError('Fill in price, message, and availability');
          return;
        }
        submit.mutate();
      }}
    >
      <div className="section-label"><span>Submit your offer</span></div>
      <div className="form-grid">
        <label>Price ($)
          <input type="number" min="1" step="1" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="120" />
        </label>
        <label>Available at
          <input type="datetime-local" value={availableAt} onChange={(e) => setAvailableAt(e.target.value)} />
        </label>
      </div>
      <label>Message
        <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explain your approach, timing, and what’s included." />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="button button-dark" disabled={submit.isPending}>
        {submit.isPending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
        Send offer
      </button>
    </form>
  );
}
