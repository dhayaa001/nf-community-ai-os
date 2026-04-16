import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentKind,
  AgentRecord,
  Conversation,
  Lead,
  Message,
  Task,
} from '@nf/shared';
import type { Repository } from './repository';

/**
 * Supabase-backed repository. Used when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are both set. See `packages/db/migrations/0001_init.sql` for the schema.
 *
 * All methods throw on DB errors — the caller should treat the repository as
 * a trusted store. The orchestrator catches and emits a failure task event.
 */
export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async createConversation(userId?: string): Promise<Conversation> {
    const { data, error } = await this.client
      .from('conversations')
      .insert({ user_id: userId ?? null, title: null })
      .select()
      .single();
    if (error || !data) throw error ?? new Error('createConversation failed');
    return rowToConversation(data);
  }

  async getConversation(id: string) {
    const { data, error } = await this.client
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToConversation(data) : null;
  }

  async listConversations(limit = 50) {
    const { data, error } = await this.client
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToConversation);
  }

  async appendMessage(input: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const { data, error } = await this.client
      .from('messages')
      .insert({
        conversation_id: input.conversationId,
        role: input.role,
        agent_kind: input.agentKind ?? null,
        content: input.content,
      })
      .select()
      .single();
    if (error || !data) throw error ?? new Error('appendMessage failed');

    await this.client
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.conversationId);

    return rowToMessage(data);
  }

  async listMessages(conversationId: string) {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToMessage);
  }

  async createTask(input: Omit<Task, 'id' | 'createdAt' | 'completedAt'>): Promise<Task> {
    const { data, error } = await this.client
      .from('tasks')
      .insert({
        conversation_id: input.conversationId,
        intent: input.intent,
        assigned_agent: input.assignedAgent,
        status: input.status,
        input: input.input,
        output: input.output,
        score: input.score,
      })
      .select()
      .single();
    if (error || !data) throw error ?? new Error('createTask failed');
    return rowToTask(data);
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.output !== undefined) update.output = patch.output;
    if (patch.score !== undefined) update.score = patch.score;
    if (patch.status === 'completed' || patch.status === 'failed') {
      update.completed_at = new Date().toISOString();
    }
    const { data, error } = await this.client
      .from('tasks')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw error ?? new Error('updateTask failed');
    return rowToTask(data);
  }

  async getTask(id: string) {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToTask(data) : null;
  }

  async listTasks(limit = 50) {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToTask);
  }

  async createLead(input: Omit<Lead, 'id' | 'createdAt'>): Promise<Lead> {
    const { data, error } = await this.client
      .from('leads')
      .insert({
        conversation_id: input.conversationId,
        service: input.service,
        budget: input.budget,
        deadline: input.deadline,
        contact: input.contact,
        notes: input.notes,
        status: input.status,
      })
      .select()
      .single();
    if (error || !data) throw error ?? new Error('createLead failed');
    return rowToLead(data);
  }

  async listLeads(limit = 50) {
    const { data, error } = await this.client
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToLead);
  }

  async getAgent(kind: AgentKind) {
    const { data, error } = await this.client
      .from('agents')
      .select('*')
      .eq('kind', kind)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToAgent(data) : null;
  }

  async upsertAgent(record: Omit<AgentRecord, 'id' | 'createdAt'>): Promise<AgentRecord> {
    const { data, error } = await this.client
      .from('agents')
      .upsert(
        {
          kind: record.kind,
          version: record.version,
          status: record.status,
          system_prompt: record.systemPrompt,
          tasks_completed: record.tasksCompleted,
          success_rate: record.successRate,
          avg_score: record.avgScore,
          revenue_generated: record.revenueGenerated,
        },
        { onConflict: 'kind,version' },
      )
      .select()
      .single();
    if (error || !data) throw error ?? new Error('upsertAgent failed');
    return rowToAgent(data);
  }

  async listAgents() {
    const { data, error } = await this.client.from('agents').select('*');
    if (error) throw error;
    return (data ?? []).map(rowToAgent);
  }

  async incrementAgentStats(
    kind: AgentKind,
    patch: { success: boolean; score: number; revenue?: number },
  ) {
    const current = await this.getAgent(kind);
    if (!current) throw new Error(`Agent ${kind} not registered`);
    const nextCompleted = current.tasksCompleted + 1;
    const successRate =
      (current.successRate * current.tasksCompleted + (patch.success ? 1 : 0)) / nextCompleted;
    const avgScore =
      (current.avgScore * current.tasksCompleted + patch.score) / nextCompleted;
    return this.upsertAgent({
      ...current,
      tasksCompleted: nextCompleted,
      successRate: Number(successRate.toFixed(4)),
      avgScore: Number(avgScore.toFixed(4)),
      revenueGenerated: current.revenueGenerated + (patch.revenue ?? 0),
    });
  }
}

// ---- Row mappers -----------------------------------------------------------

type Row = Record<string, unknown>;

function rowToConversation(row: Row): Conversation {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? undefined,
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToMessage(row: Row): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as Message['role'],
    agentKind: (row.agent_kind as AgentKind | null) ?? undefined,
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

function rowToTask(row: Row): Task {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    intent: row.intent as Task['intent'],
    assignedAgent: row.assigned_agent as AgentKind,
    status: row.status as Task['status'],
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown> | null) ?? null,
    score: (row.score as number | null) ?? null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

function rowToLead(row: Row): Lead {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    service: (row.service as string | null) ?? null,
    budget: (row.budget as string | null) ?? null,
    deadline: (row.deadline as string | null) ?? null,
    contact: (row.contact as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: row.status as Lead['status'],
    createdAt: row.created_at as string,
  };
}

function rowToAgent(row: Row): AgentRecord {
  return {
    id: row.id as string,
    kind: row.kind as AgentKind,
    version: row.version as number,
    status: row.status as AgentRecord['status'],
    systemPrompt: row.system_prompt as string,
    tasksCompleted: (row.tasks_completed as number) ?? 0,
    successRate: (row.success_rate as number) ?? 0,
    avgScore: (row.avg_score as number) ?? 0,
    revenueGenerated: (row.revenue_generated as number) ?? 0,
    createdAt: row.created_at as string,
  };
}
