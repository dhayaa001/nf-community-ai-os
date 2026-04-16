/**
 * Domain types shared between API and Web.
 * Keep these free of runtime imports so they can be used from any environment.
 */

export type AgentKind =
  | 'community'
  | 'lead'
  | 'sales'
  | 'project_manager'
  | 'builder'
  | 'qa'
  | 'bugfix'
  | 'growth';

export type AgentStatus = 'active' | 'inactive' | 'deprecated';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export type Intent =
  | 'chat'
  | 'lead_capture'
  | 'sales_proposal'
  | 'project_kickoff'
  | 'build_request'
  | 'support';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  agentKind?: AgentKind;
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId?: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  conversationId: string;
  service: string | null;
  budget: string | null;
  deadline: string | null;
  contact: string | null;
  notes: string | null;
  status: 'new' | 'qualified' | 'proposal_sent' | 'won' | 'lost';
  createdAt: string;
}

export interface Task {
  id: string;
  conversationId: string;
  intent: Intent;
  assignedAgent: AgentKind;
  status: TaskStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  score: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentRecord {
  id: string;
  kind: AgentKind;
  version: number;
  status: AgentStatus;
  systemPrompt: string;
  tasksCompleted: number;
  successRate: number;
  avgScore: number;
  revenueGenerated: number;
  createdAt: string;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
}

export interface ChatResponse {
  conversationId: string;
  message: Message;
  task: Task;
  lead?: Lead;
}
