import { randomUUID } from 'node:crypto';
import type {
  AgentKind,
  AgentRecord,
  Conversation,
  Lead,
  Message,
  Task,
} from '@nf/shared';
import type { Repository } from './repository';

const now = () => new Date().toISOString();

/**
 * Dev-only in-memory store. Data is lost on process restart.
 * Used automatically when SUPABASE_URL is not set.
 */
export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;

  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>();
  private tasks = new Map<string, Task>();
  private leads = new Map<string, Lead>();
  private agents = new Map<AgentKind, AgentRecord>();

  async createConversation(userId?: string): Promise<Conversation> {
    const conv: Conversation = {
      id: randomUUID(),
      userId,
      title: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.conversations.set(conv.id, conv);
    this.messages.set(conv.id, []);
    return conv;
  }

  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(limit = 50) {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async appendMessage(input: Omit<Message, 'id' | 'createdAt'>) {
    const msg: Message = { ...input, id: randomUUID(), createdAt: now() };
    const list = this.messages.get(input.conversationId) ?? [];
    list.push(msg);
    this.messages.set(input.conversationId, list);
    const conv = this.conversations.get(input.conversationId);
    if (conv) conv.updatedAt = msg.createdAt;
    return msg;
  }

  async listMessages(conversationId: string) {
    return this.messages.get(conversationId) ?? [];
  }

  async createTask(input: Omit<Task, 'id' | 'createdAt' | 'completedAt'>) {
    const task: Task = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
      completedAt: null,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>) {
    const existing = this.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const updated: Task = {
      ...existing,
      ...patch,
      completedAt:
        patch.status === 'completed' || patch.status === 'failed'
          ? now()
          : existing.completedAt,
    };
    this.tasks.set(id, updated);
    return updated;
  }

  async getTask(id: string) {
    return this.tasks.get(id) ?? null;
  }

  async listTasks(limit = 50) {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async createLead(input: Omit<Lead, 'id' | 'createdAt'>) {
    const lead: Lead = { ...input, id: randomUUID(), createdAt: now() };
    this.leads.set(lead.id, lead);
    return lead;
  }

  async listLeads(limit = 50) {
    return Array.from(this.leads.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getAgent(kind: AgentKind) {
    return this.agents.get(kind) ?? null;
  }

  async upsertAgent(record: Omit<AgentRecord, 'id' | 'createdAt'>) {
    const existing = this.agents.get(record.kind);
    const merged: AgentRecord = existing
      ? { ...existing, ...record }
      : { ...record, id: randomUUID(), createdAt: now() };
    this.agents.set(merged.kind, merged);
    return merged;
  }

  async listAgents() {
    return Array.from(this.agents.values());
  }

  async incrementAgentStats(
    kind: AgentKind,
    patch: { success: boolean; score: number; revenue?: number },
  ) {
    const agent = this.agents.get(kind);
    if (!agent) throw new Error(`Agent ${kind} not registered`);
    const nextCompleted = agent.tasksCompleted + 1;
    const nextSuccess =
      (agent.successRate * agent.tasksCompleted + (patch.success ? 1 : 0)) / nextCompleted;
    const nextAvgScore = (agent.avgScore * agent.tasksCompleted + patch.score) / nextCompleted;
    const updated: AgentRecord = {
      ...agent,
      tasksCompleted: nextCompleted,
      successRate: Number(nextSuccess.toFixed(4)),
      avgScore: Number(nextAvgScore.toFixed(4)),
      revenueGenerated: agent.revenueGenerated + (patch.revenue ?? 0),
    };
    this.agents.set(kind, updated);
    return updated;
  }
}
