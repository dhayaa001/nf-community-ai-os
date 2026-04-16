/**
 * Canonical WebSocket event names. Both API (emitter) and Web (listener)
 * must import from here so the wire protocol stays in sync.
 */

import type { AgentKind, Lead, Message, Task, TaskStatus } from './types';

export const WS_EVENT = {
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_COMPLETED: 'task:completed',
  MESSAGE_APPENDED: 'message:appended',
  LEAD_CAPTURED: 'lead:captured',
  AGENT_STATS_UPDATED: 'agent:stats_updated',
} as const;

export type WsEventName = (typeof WS_EVENT)[keyof typeof WS_EVENT];

export interface TaskCreatedEvent {
  task: Task;
}

export interface TaskUpdatedEvent {
  taskId: string;
  status: TaskStatus;
  agentKind: AgentKind;
}

export interface TaskCompletedEvent {
  task: Task;
}

export interface MessageAppendedEvent {
  message: Message;
}

export interface LeadCapturedEvent {
  lead: Lead;
}

export interface AgentStatsUpdatedEvent {
  agentKind: AgentKind;
  tasksCompleted: number;
  successRate: number;
  avgScore: number;
}
