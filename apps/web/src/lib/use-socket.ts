'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_URL } from './config';

/**
 * Shared singleton Socket.io client. Avoids re-connecting on every render.
 */
let singleton: Socket | null = null;

export function getSocket(): Socket {
  if (!singleton) {
    singleton = io(WS_URL, { transports: ['websocket', 'polling'], autoConnect: true });
  }
  return singleton;
}

export type SocketHandler = (payload: unknown) => void;
export type SocketHandlerMap = Record<string, SocketHandler>;

export function useSocket(handlers: SocketHandlerMap, deps: unknown[] = []) {
  const handlersRef = useRef<SocketHandlerMap>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = getSocket();
    const registered: Array<[string, SocketHandler]> = [];
    for (const [event, fn] of Object.entries(handlersRef.current)) {
      const wrapped: SocketHandler = (payload) => fn(payload);
      socket.on(event, wrapped);
      registered.push([event, wrapped]);
    }
    return () => {
      for (const [event, fn] of registered) socket.off(event, fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
