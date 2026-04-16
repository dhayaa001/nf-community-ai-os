'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentRecord, Lead, Task } from '@nf/shared';
import { WS_EVENT } from '@nf/shared';
import { api } from '@/lib/api';
import { getSocket, useSocket } from '@/lib/use-socket';

interface Summary {
  counts: {
    conversations: number;
    leads: number;
    tasks: number;
    tasksCompleted: number;
    tasksFailed: number;
  };
  agents: AgentRecord[];
  revenueTotal: number;
}

export function DashboardClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, t, l] = await Promise.all([api.summary(), api.listTasks(), api.listLeads()]);
      setSummary(s);
      setTasks(t);
      setLeads(l);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    getSocket().emit('subscribe:admin');
  }, [refresh]);

  useSocket(
    {
      [WS_EVENT.TASK_CREATED]: () => void refresh(),
      [WS_EVENT.TASK_COMPLETED]: () => void refresh(),
      [WS_EVENT.LEAD_CAPTURED]: () => void refresh(),
      [WS_EVENT.AGENT_STATS_UPDATED]: () => void refresh(),
    },
    [refresh],
  );

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        Cannot reach the API: {error}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-sm text-white/50">Loading…</div>;
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="Conversations" value={summary.counts.conversations} />
        <Stat label="Leads" value={summary.counts.leads} />
        <Stat label="Tasks" value={summary.counts.tasks} />
        <Stat
          label="Success rate"
          value={
            summary.counts.tasks === 0
              ? '—'
              : `${Math.round(
                  (summary.counts.tasksCompleted /
                    Math.max(1, summary.counts.tasks)) *
                    100,
                )}%`
          }
        />
        <Stat label="Revenue" value={`$${summary.revenueTotal.toLocaleString()}`} />
      </div>

      <section className="rounded-2xl border border-white/5 bg-elevated/60 p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-3">Agents</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {summary.agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-white/5 bg-elevated/60 p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-3">Recent Tasks</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin">
            {tasks.length === 0 && (
              <div className="text-xs text-white/40">No tasks yet.</div>
            )}
            {tasks.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-white/5 bg-surface/40 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-white/80">{t.assignedAgent}</span>
                  <StatusPill status={t.status} />
                </div>
                <div className="text-white/50 mt-1">intent: {t.intent}</div>
                {t.score !== null && (
                  <div className="text-white/40 mt-0.5">score: {t.score.toFixed(2)}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/5 bg-elevated/60 p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-3">Recent Leads</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin">
            {leads.length === 0 && (
              <div className="text-xs text-white/40">No leads yet.</div>
            )}
            {leads.map((l) => (
              <div
                key={l.id}
                className="rounded-lg border border-white/5 bg-surface/40 px-3 py-2 text-xs text-white/80"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{l.service ?? 'Unspecified service'}</span>
                  <span className="text-white/40">{l.status}</span>
                </div>
                <div className="text-white/50 mt-1 flex flex-wrap gap-3">
                  {l.budget && <span>💰 {l.budget}</span>}
                  {l.deadline && <span>⏱ {l.deadline}</span>}
                  {l.contact && <span>✉ {l.contact}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-elevated/60 p-4">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  const rate = agent.tasksCompleted ? `${Math.round(agent.successRate * 100)}%` : '—';
  return (
    <div className="rounded-xl border border-white/5 bg-surface/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{agent.kind.replace('_', ' ')}</span>
        <span
          className={
            agent.status === 'active'
              ? 'text-xs text-emerald-400'
              : 'text-xs text-white/40'
          }
        >
          {agent.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-white/60">
        <dt>Tasks</dt>
        <dd className="text-right text-white/80">{agent.tasksCompleted}</dd>
        <dt>Success</dt>
        <dd className="text-right text-white/80">{rate}</dd>
        <dt>Avg score</dt>
        <dd className="text-right text-white/80">{agent.avgScore.toFixed(2)}</dd>
        <dt>Revenue</dt>
        <dd className="text-right text-white/80">${agent.revenueGenerated}</dd>
      </dl>
    </div>
  );
}

function StatusPill({ status }: { status: Task['status'] }) {
  const color =
    status === 'completed'
      ? 'bg-emerald-500/20 text-emerald-300'
      : status === 'failed'
        ? 'bg-red-500/20 text-red-300'
        : status === 'running'
          ? 'bg-amber-500/20 text-amber-300'
          : 'bg-white/10 text-white/70';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${color}`}>
      {status}
    </span>
  );
}
