import type {
  AgentKind,
  AgentRecord,
  Conversation,
  Lead,
  Message,
  Task,
  TaskStatus,
} from '@nf/shared';

/**
 * Repository contract used by the API. Two implementations exist:
 *   - SupabaseRepository: persistent, used when SUPABASE_URL is set
 *   - MemoryRepository: in-process, used as a fallback for dev / CI
 *
 * Keeping this as a single interface makes it easy to add Postgres/Mongo/etc.
 * without touching the orchestrator or agents.
 */
export interface Repository {
  createConversation(userId?: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(limit?: number): Promise<Conversation[]>;

  appendMessage(input: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  listMessages(conversationId: string): Promise<Message[]>;

  createTask(input: Omit<Task, 'id' | 'createdAt' | 'completedAt'>): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(limit?: number): Promise<Task[]>;

  createLead(input: Omit<Lead, 'id' | 'createdAt'>): Promise<Lead>;
  listLeads(limit?: number): Promise<Lead[]>;

  getAgent(kind: AgentKind): Promise<AgentRecord | null>;
  upsertAgent(record: Omit<AgentRecord, 'id' | 'createdAt'>): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
  incrementAgentStats(
    kind: AgentKind,
    patch: { success: boolean; score: number; revenue?: number },
  ): Promise<AgentRecord>;

  /** Marker for logs / diagnostics. */
  readonly kind: 'supabase' | 'memory';
}

export type { TaskStatus };
