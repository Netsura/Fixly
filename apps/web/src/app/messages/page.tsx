'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { CheckCheck, LoaderCircle, MessageSquare, Send, Wifi, WifiOff } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { apiFetch, apiUrl, Profile } from '../../lib/api';

type Conversation = {
  id: string;
  bookingId: string | null;
  messages: Message[];
  participants: Participant[];
  booking: { request: { title: string; service: { name: string } } } | null;
};
type Participant = { userId: string; user: { id: string; email: string; profile: { displayName: string } | null } };
type Message = { id: string; conversationId: string; body: string; senderId: string; createdAt: string; sender: { id: string; profile: { displayName: string } | null } };

function MessagesContent() {
  const searchParams = useSearchParams();
  const conversationParam = searchParams.get('c') ?? undefined;
  const [activeId, setActiveId] = useState<string | undefined>(conversationParam);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [connected, setConnected] = useState(false);
  const me = useQuery({ queryKey: ['profile'], queryFn: () => apiFetch<Profile>('/users/me'), retry: false });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => apiFetch<Conversation[]>('/conversations') });
  const active = useMemo(
    () => conversations.data?.find((conversation) => conversation.id === activeId) ?? conversations.data?.find((conversation) => conversation.id === conversationParam) ?? conversations.data?.[0],
    [activeId, conversationParam, conversations.data],
  );
  const messages = useQuery({
    queryKey: ['messages', active?.id],
    queryFn: () => apiFetch<Message[]>(`/conversations/${active?.id}/messages`),
    enabled: Boolean(active?.id),
  });

  useEffect(() => {
    if (conversationParam) setActiveId(conversationParam);
  }, [conversationParam]);

  useEffect(() => {
    if (!active?.id) return;
    const socket: Socket = io(`${apiUrl.replace(/\/api$/, '')}/realtime`, { withCredentials: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('conversation:join', { conversationId: active.id });
      socket.emit('message:read', { conversationId: active.id });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('message:new', (message: Message) => {
      if (message.conversationId === active.id) setLiveMessages((current) => [...current, message]);
    });
    socket.on('message:typing', (event: { userId: string; isTyping: boolean }) => setTyping(event.isTyping));
    return () => {
      socket.disconnect();
      setConnected(false);
      setLiveMessages([]);
      setTyping(false);
    };
  }, [active?.id]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !active?.id) return;
    const socket = io(`${apiUrl.replace(/\/api$/, '')}/realtime`, { withCredentials: true });
    socket.emit('conversation:join', { conversationId: active.id }, () => {
      socket.emit('message:send', { conversationId: active.id, body: draft });
      setDraft('');
      setTimeout(() => socket.disconnect(), 500);
    });
  };

  const otherParticipant = active?.participants.find((participant) => participant.userId !== me.data?.id);
  const conversationTitle = active?.booking?.request.title
    ?? otherParticipant?.user.profile?.displayName
    ?? 'Fixly chat';
  const conversationService = active?.booking?.request.service.name
    ?? otherParticipant?.user.profile?.displayName
    ?? 'Direct message';

  return (
    <section className="page-section messages-page">
      <div className="eyebrow"><MessageSquare size={14} /> Private conversations</div>
      <h1>Talk it <i>through.</i></h1>
      <div className="messages-layout">
        <aside className="conversation-list">
          <div className="conversation-list-heading">
            <strong>Conversations</strong>
            <span>{conversations.data?.length ?? 0}</span>
          </div>
          {conversations.isLoading ? (
            <div className="conversation-empty"><LoaderCircle className="spin" size={18} /></div>
          ) : !conversations.data?.length ? (
            <div className="conversation-empty">
              <MessageSquare size={22} />
              <span>Start a chat from a provider profile or accepted booking.</span>
            </div>
          ) : (
            conversations.data.map((conversation) => {
              const peer = conversation.participants.find((participant) => participant.userId !== me.data?.id);
              const title = conversation.booking?.request.title ?? peer?.user.profile?.displayName ?? 'Fixly chat';
              const initial = conversation.booking?.request.service.name.slice(0, 1)
                ?? peer?.user.profile?.displayName.slice(0, 1)
                ?? 'F';
              return (
                <button
                  className={`conversation-row ${conversation.id === active?.id ? 'is-active' : ''}`}
                  onClick={() => setActiveId(conversation.id)}
                  key={conversation.id}
                >
                  <span className="avatar">{initial}</span>
                  <span>
                    <strong>{title}</strong>
                    <small>{conversation.messages[0]?.body ?? 'Start the conversation'}</small>
                  </span>
                </button>
              );
            })
          )}
        </aside>
        <section className="chat-panel">
          {active ? (
            <>
              <div className="chat-header">
                <div>
                  <strong>{conversationTitle}</strong>
                  <small>
                    {connected ? <><Wifi size={13} /> Live now</> : <><WifiOff size={13} /> Connecting...</>}
                  </small>
                </div>
                <span className="chat-service">{conversationService}</span>
              </div>
              <div className="chat-messages">
                {messages.isLoading ? (
                  <LoaderCircle className="spin" size={19} />
                ) : (
                  [...(messages.data ?? []).reverse(), ...liveMessages].map((message) => (
                    <div
                      className={`message-bubble ${message.senderId === me.data?.id ? 'message-mine' : ''}`}
                      key={message.id}
                    >
                      <span>{message.body}</span>
                      <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                  ))
                )}
                {typing && <div className="typing-indicator">Someone is typing...</div>}
              </div>
              <form className="chat-compose" onSubmit={sendMessage}>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a message..."
                />
                <button className="button button-dark" aria-label="Send message"><Send size={16} /></button>
                <span className="read-mark"><CheckCheck size={15} /></span>
              </form>
            </>
          ) : (
            <div className="chat-empty">
              <MessageSquare size={28} />
              <strong>Choose a conversation</strong>
              <span>Your Fixly messages will live here.</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default function MessagesPage() {
  return (
    <AppShell>
      <Suspense fallback={<section className="page-section"><div className="status-panel"><LoaderCircle className="spin" size={20} /> Loading messages...</div></section>}>
        <MessagesContent />
      </Suspense>
    </AppShell>
  );
}
