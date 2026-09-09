'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from '../lib/api';

type PresenceMap = Record<string, boolean>;

type PresenceContextValue = {
  online: PresenceMap;
  isOnline: (userId?: string | null) => boolean;
};

const PresenceContext = createContext<PresenceContextValue>({
  online: {},
  isOnline: () => false,
});

function realtimeBaseUrl() {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'http://localhost:4000';
  }
}

export function PresenceProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState<PresenceMap>({});

  useEffect(() => {
    if (!enabled) return;
    let socket: Socket | null = io(`${realtimeBaseUrl()}/realtime`, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    const onPresence = (payload: { userId?: string; online?: boolean }) => {
      if (!payload?.userId) return;
      setOnline((prev) => ({ ...prev, [payload.userId!]: Boolean(payload.online) }));
    };

    socket.on('presence:update', onPresence);
    return () => {
      socket?.off('presence:update', onPresence);
      socket?.disconnect();
      socket = null;
    };
  }, [enabled]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      online,
      isOnline: (userId) => Boolean(userId && online[userId]),
    }),
    [online],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}

export function OnlineMark({
  userId,
  online: onlineProp,
  label = true,
}: {
  userId?: string | null;
  online?: boolean;
  label?: boolean;
}) {
  const presence = usePresence();
  const isOnline = onlineProp ?? presence.isOnline(userId);
  return (
    <span className={`online-mark ${isOnline ? 'is-online' : 'is-offline'}`} title={isOnline ? 'Online' : 'Offline'}>
      <span className="online-dot" />
      {label ? <span>{isOnline ? 'Online' : 'Offline'}</span> : null}
    </span>
  );
}
