import type { AgentRecord, Lead, Message, Task } from '@nf/shared';
import { API_URL } from './config';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  sendChat: (body: { conversationId?: string; message: string }) =>
    request<{ conversationId: string; userMessage: Message; task: Task }>(
      '/chat/messages',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listMessages: (conversationId: string) =>
    request<Message[]>(`/chat/conversations/${conversationId}/messages`),
  listAgents: () => request<AgentRecord[]>('/dashboard/agents'),
  listTasks: () => request<Task[]>('/dashboard/tasks'),
  listLeads: () => request<Lead[]>('/dashboard/leads'),
  summary: () =>
    request<{
      counts: {
        conversations: number;
        leads: number;
        tasks: number;
        tasksCompleted: number;
        tasksFailed: number;
      };
      agents: AgentRecord[];
      revenueTotal: number;
    }>('/dashboard/summary'),
  health: () =>
    request<{ status: string; repository: string; llm: string; uptimeSeconds: number }>(
      '/health',
    ),
};
