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
  /**
   * Phase 3 — optional carry-over for the next pipeline step. Merged into
   * the next agent's `ctx.extra`. Well-known keys today: `lead`. Typed
   * union deferred to tech-debt B23.
   */
  handoff?: Record<string, unknown>;
  /**
   * Phase 3 — when true, the orchestrator stops the pipeline immediately
   * after this step (without marking the task failed). Use when the agent
   * decides downstream work is moot — e.g. lead extraction with no fields
   * means running sales is pointless.
   */
  haltPipeline?: boolean;
}

export interface Agent {
  readonly kind: AgentKind;
  run(ctx: AgentContext): Promise<AgentResult>;
}
