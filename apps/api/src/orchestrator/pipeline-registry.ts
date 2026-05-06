import type { AgentKind, Intent } from '@nf/shared';

/**
 * Phase 3: declarative agent pipelines per intent.
 *
 * Each intent maps to an ordered list of agent kinds. The orchestrator runs
 * them in sequence, merging each step's `result.handoff` into the context
 * passed to the next step. A step can request early termination via
 * `result.haltPipeline = true` (e.g. lead extraction with no fields → stop
 * before running sales).
 *
 * Replaces the `routeIntent()` switch + bespoke `lead → sales` chain that
 * lived inline in `OrchestratorService.dispatch()`. Adding a new intent or
 * reordering a chain is now a one-line edit here, not a refactor of the
 * orchestrator.
 *
 * Keep these tables exhaustive — TypeScript enforces it via
 * `Record<Intent, …>`. If a new `Intent` is added in `@nf/shared` and not
 * mapped here, the API will fail to typecheck.
 */
export const INTENT_PIPELINES: Record<Intent, AgentKind[]> = {
  chat: ['community'],
  lead_capture: ['lead', 'sales'],
  sales_proposal: ['sales'],
  project_kickoff: ['project_manager'],
  build_request: ['builder'],
  support: ['bugfix'],
};

/**
 * Optional per-intent fallback agent. Runs only when the pipeline produced
 * zero assistant replies (e.g. `lead_capture` with no extracted fields halts
 * before sales, leaving the user with silence — community fills the gap).
 *
 * Not a `Record<Intent, …>` because most intents don't need a fallback;
 * absence here means "no fallback, the user just gets whatever the pipeline
 * produced (which may be nothing)".
 */
export const INTENT_FALLBACKS: Partial<Record<Intent, AgentKind>> = {
  lead_capture: 'community',
};

/** Convenience: the primary (first) agent for a given intent. */
export function primaryAgentFor(intent: Intent): AgentKind {
  const pipeline = INTENT_PIPELINES[intent];
  if (!pipeline || pipeline.length === 0) {
    throw new Error(`No pipeline configured for intent=${intent}`);
  }
  return pipeline[0];
}
