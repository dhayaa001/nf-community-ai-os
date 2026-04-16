import type { AgentKind, Message } from '@nf/shared';

export interface AgentContext {
  conversationId: string;
  history: Message[];
  latestUserMessage: string;
  /** Arbitrary extra context from upstream agents (e.g. extracted lead). */
  extra?: Record<string, unknown>;
}

export interface AgentResult {
  /** Free-form assistant reply. Orchestrator appends it as a message. */
  reply?: string;
  /** Structured output (e.g. extracted lead fields, proposal JSON). */
  data?: Record<string, unknown>;
  /** Self-reported confidence/score in 0..1. Used by the eval loop. */
  score: number;
  /** Agent believes it successfully handled the task. */
  success: boolean;
}

export interface Agent {
  readonly kind: AgentKind;
  run(ctx: AgentContext): Promise<AgentResult>;
}
