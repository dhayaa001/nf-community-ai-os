'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lead, Message, Task } from '@nf/shared';
import { WS_EVENT } from '@nf/shared';
import { api } from '@/lib/api';
import { getSocket, useSocket, type SocketHandlerMap } from '@/lib/use-socket';

type Status = 'idle' | 'sending' | 'waiting';

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [latestLead, setLatestLead] = useState<Lead | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to socket events
  const handlers: SocketHandlerMap = {
    [WS_EVENT.MESSAGE_APPENDED]: (payload) => {
      const msg = (payload as { message: Message }).message;
      if (msg.conversationId !== conversationId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.role === 'assistant') setStatus('idle');
    },
    [WS_EVENT.TASK_UPDATED]: (payload) => {
      const t = payload as { taskId: string; status: Task['status'] };
      setCurrentTask((prev) =>
        prev && prev.id === t.taskId ? { ...prev, status: t.status } : prev,
      );
    },
    [WS_EVENT.TASK_COMPLETED]: (payload) => {
      const { task } = payload as { task: Task };
      if (task.conversationId !== conversationId) return;
      setCurrentTask(task);
      setStatus('idle');
    },
    [WS_EVENT.LEAD_CAPTURED]: (payload) => {
      const { lead } = payload as { lead: Lead };
      if (lead.conversationId !== conversationId) return;
      setLatestLead(lead);
    },
  };
  useSocket(handlers, [conversationId]);

  // Re-join room when conversation id changes AND back-fill via REST.
  //
  // The server dispatches the task on `setImmediate` right after enqueue, which
  // often fires before the browser receives the POST response, sets
  // `conversationId`, and has a chance to `emit('subscribe:conversation', …)`.
  // Any WS events emitted during that window are dropped. Back-filling with a
  // plain REST fetch — and retrying a few times to cover the stub pipeline's
  // ~tens-of-ms work — guarantees the user still sees the assistant reply and
  // lead pill even if the socket missed its cue. It also makes the component
  // resilient to refresh / reconnect scenarios for free.
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    socket.emit('subscribe:conversation', conversationId);

    let cancelled = false;
    const backfill = async () => {
      try {
        const [msgs, leads] = await Promise.all([
          api.listMessages(conversationId),
          api.listLeads(),
        ]);
        if (cancelled) return;
        setMessages((prev) => {
          const map = new Map(prev.map((m) => [m.id, m] as const));
          for (const m of msgs) map.set(m.id, m);
          return Array.from(map.values()).sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
        });
        const mineLatest = [...leads]
          .filter((l) => l.conversationId === conversationId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (mineLatest) setLatestLead((prev) => prev ?? mineLatest);
        if (msgs.some((m) => m.role === 'assistant')) {
          setStatus((s) => (s === 'waiting' ? 'idle' : s));
        }
      } catch {
        /* swallow — WS is the primary channel, this is just a safety net */
      }
    };
    void backfill();
    const timers = [400, 1200, 2500, 5000].map((ms) => setTimeout(backfill, ms));
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [conversationId]);

  // Auto-scroll on new message
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || status !== 'idle') return;
    setInput('');
    setStatus('sending');
    try {
      const res = await api.sendChat({
        conversationId: conversationId ?? undefined,
        message: text,
      });
      setConversationId(res.conversationId);
      setCurrentTask(res.task);
      // Optimistically push the user message — WS may also echo it.
      setMessages((prev) =>
        prev.some((m) => m.id === res.userMessage.id) ? prev : [...prev, res.userMessage],
      );
      setStatus('waiting');
    } catch (err) {
      setStatus('idle');
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversationId: conversationId ?? 'local',
          role: 'system',
          content: `Error: ${(err as Error).message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }, [conversationId, input, status]);

  const statusLabel = useMemo(() => {
    if (status === 'sending') return 'Submitting…';
    if (status === 'waiting')
      return `Agent working${currentTask ? ` (${currentTask.assignedAgent})` : ''}…`;
    return null;
  }, [status, currentTask]);

  return (
    <div className="flex flex-col h-[560px]">
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pr-2"
      >
        {messages.length === 0 && (
          <div className="text-sm text-white/40 italic">
            No messages yet. Say hi — e.g. &ldquo;I need a landing page for a new SaaS, budget $3k, due in 2 weeks&rdquo;.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {statusLabel && (
          <div className="text-xs text-white/50 italic pl-2 animate-pulse">{statusLabel}</div>
        )}
        {latestLead && (
          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200/90">
            <div className="font-semibold">Lead captured</div>
            <ul className="mt-1 space-y-0.5">
              {latestLead.service && <li>Service: {latestLead.service}</li>}
              {latestLead.budget && <li>Budget: {latestLead.budget}</li>}
              {latestLead.deadline && <li>Deadline: {latestLead.deadline}</li>}
              {latestLead.contact && <li>Contact: {latestLead.contact}</li>}
            </ul>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage();
        }}
        className="mt-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you want to build…"
          className="flex-1 rounded-lg border border-white/10 bg-surface/60 px-4 py-2.5 text-sm outline-none focus:border-accent/60"
          disabled={status !== 'idle'}
        />
        <button
          type="submit"
          disabled={!input.trim() || status !== 'idle'}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-accent/90 text-white'
            : isSystem
              ? 'bg-amber-500/10 border border-amber-400/30 text-amber-200'
              : 'bg-white/5 border border-white/10 text-white/90',
        )}
      >
        {message.agentKind && !isUser && !isSystem && (
          <div className="text-xs uppercase tracking-wide text-white/50 mb-1">
            {message.agentKind.replace('_', ' ')} AI
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
