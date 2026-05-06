import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AgentKind, Intent, Lead, Task } from '@nf/shared';
import { AgentRegistry } from '../agents/agent-registry';
import type { AgentContext, AgentResult } from '../agents/agent.base';
import { EventsGateway } from '../events/events.gateway';
import { QueueService } from '../queue/queue.service';
import { RepositoryService } from '../repository/repository.service';
import { IntentClassifier } from './intent-classifier';
import { INTENT_FALLBACKS, INTENT_PIPELINES, primaryAgentFor } from './pipeline-registry';

/**
 * Core "brain" of the system.
 *
 * Pipeline for each user message:
 *   1. Persist user message
 *   2. Classify intent
 *   3. Create Task (pending)
 *   4. Enqueue job → queue handler runs the routing below
 *   5. Queue handler dispatches to one or more agents and persists output
 *   6. Emit realtime events for the chat UI + admin dashboard
 *
 * Everything is queue-driven — no agent is invoked directly from HTTP.
 * In dev (no Redis) the queue is an in-process setImmediate executor.
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly repo: RepositoryService,
    private readonly events: EventsGateway,
    private readonly queue: QueueService,
    private readonly classifier: IntentClassifier,
    private readonly registry: AgentRegistry,
  ) {}

  onModuleInit() {
    this.queue.registerHandler(async (job) => this.processJob(job.data as OrchestratorJob));
  }

  /**
   * Entry point from the chat controller. Persists user message, classifies
   * intent, creates a Task row and enqueues the processing job. Returns
   * immediately so the HTTP call is fast; agent output is delivered via WS.
   */
  async submitUserMessage(args: { conversationId?: string; message: string }) {
    const conversation =
      (args.conversationId ? await this.repo.db.getConversation(args.conversationId) : null) ??
      (await this.repo.db.createConversation());

    const userMessage = await this.repo.db.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: args.message,
    });
    this.events.emitMessageAppended(conversation.id, { message: userMessage });

    const history = await this.repo.db.listMessages(conversation.id);
    const classification = await this.classifier.classify(
      args.message,
      history.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    );
    const intent: Intent = classification.intent;
    const assignedAgent = primaryAgentFor(intent);
    this.logger.debug(`intent=${intent} confidence=${classification.confidence} → ${assignedAgent}`);

    const task = await this.repo.db.createTask({
      conversationId: conversation.id,
      intent,
      assignedAgent,
      status: 'pending',
      input: { message: args.message, reasoning: classification.reasoning ?? '' },
      output: null,
      score: null,
    });
    this.events.emitTaskCreated(conversation.id, { task });

    await this.queue.enqueue('orchestrator-run', {
      taskId: task.id,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
    } satisfies OrchestratorJob);

    return { conversation, userMessage, task };
  }

  // ---- Queue handler ------------------------------------------------------

  private async processJob(job: OrchestratorJob) {
    const task = await this.repo.db.getTask(job.taskId);
    if (!task) {
      this.logger.warn(`Task ${job.taskId} disappeared before processing`);
      return;
    }

    const running = await this.repo.db.updateTask(task.id, { status: 'running' });
    this.events.emitTaskUpdated(job.conversationId, {
      taskId: running.id,
      status: 'running',
      agentKind: running.assignedAgent,
    });

    try {
      const history = await this.repo.db.listMessages(job.conversationId);
      const latestUserMessage =
        [...history].reverse().find((m) => m.role === 'user')?.content ??
        (task.input as { message?: string }).message ?? '';

      const result = await this.dispatch(task, {
        conversationId: job.conversationId,
        history,
        latestUserMessage,
      });

      const completed = await this.repo.db.updateTask(task.id, {
        status: 'completed',
        output: result.output,
        score: result.score,
      });

      await this.updateAgentStats(task.assignedAgent, result.score, result.success);

      this.events.emitTaskCompleted(job.conversationId, { task: completed });
    } catch (err) {
      this.logger.error(`Task ${task.id} failed: ${(err as Error).message}`);
      const failed = await this.repo.db.updateTask(task.id, {
        status: 'failed',
        output: { error: (err as Error).message },
        score: 0,
      });
      this.events.emitTaskCompleted(job.conversationId, { task: failed });
    }
  }

  // ---- Pipeline dispatch --------------------------------------------------

  /**
   * Phase 3 — run the agent pipeline configured for the task's intent.
   *
   * Pipeline source of truth lives in `pipeline-registry.ts`:
   *   - `INTENT_PIPELINES[intent]` — ordered list of agents to invoke.
   *   - `INTENT_FALLBACKS[intent]` — optional agent to run after the
   *     pipeline if no assistant replies were produced.
   *
   * For each step we:
   *   1. Run the agent with the current `extra` context (handoff payloads
   *      from earlier steps).
   *   2. Append the agent's `reply` (if any) as an assistant message and
   *      emit `message_appended`.
   *   3. Update the per-agent stats counter and emit `agent_stats_updated`.
   *   4. If the step is `'lead'` and produced field data, persist the Lead
   *      row and emit `lead_captured`. If extraction was empty, halt the
   *      pipeline (running sales on no data is moot) — the post-pipeline
   *      fallback then provides a conversational follow-up.
   *   5. Merge `result.handoff` into `extra` for the next step.
   *   6. Honour `result.haltPipeline` for early termination.
   *
   * Output shape is preserved from PR #1/#2 for backwards compatibility:
   *   - `primary` always present (data of the first step).
   *   - `<secondaryKind>` present when a 2nd step ran (e.g. `sales`).
   *   - `lead` present when a Lead row was persisted.
   *   - `fallback` present when the post-pipeline fallback ran.
   */
  private async dispatch(
    task: Task,
    baseCtx: Omit<AgentContext, 'extra'>,
  ): Promise<{ output: Record<string, unknown>; score: number; success: boolean }> {
    const pipeline = INTENT_PIPELINES[task.intent];
    const fallbackKind = INTENT_FALLBACKS[task.intent];

    let primaryResult: AgentResult | null = null;
    let secondaryResult: AgentResult | null = null;
    let secondaryKind: AgentKind | null = null;
    let fallbackResult: AgentResult | null = null;
    let lead: Lead | null = null;
    let extra: Record<string, unknown> = {};
    let repliesAppended = 0;

    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i];
      const agent = this.registry.get(step);
      const result = await agent.run({ ...baseCtx, extra });

      if (i === 0) {
        primaryResult = result;
      } else if (i === 1) {
        secondaryResult = result;
        secondaryKind = step;
      }

      if (result.reply) {
        const assistantMsg = await this.repo.db.appendMessage({
          conversationId: baseCtx.conversationId,
          role: 'assistant',
          agentKind: agent.kind,
          content: result.reply,
        });
        this.events.emitMessageAppended(baseCtx.conversationId, { message: assistantMsg });
        repliesAppended++;
      }

      // Lead-step special-case: persist lead and decide whether to halt.
      // Stays in orchestrator (rather than LeadAgent) until typed handoff
      // lands — tech-debt B23.
      if (step === 'lead' && result.data) {
        lead = await this.persistLead(baseCtx.conversationId, result.data);
        if (lead) {
          this.events.emitLeadCaptured(baseCtx.conversationId, { lead });
          extra = { ...extra, lead };
        } else {
          // No fields extracted — running sales is pointless. Halt; fallback
          // (configured via INTENT_FALLBACKS) will provide the user reply.
          await this.updateAgentStats(step, result.score, result.success);
          break;
        }
      }

      if (result.handoff) extra = { ...extra, ...result.handoff };

      await this.updateAgentStats(step, result.score, result.success);

      if (result.haltPipeline) break;
    }

    // Fallback when the pipeline produced no replies — e.g. lead_capture
    // halted at the empty-extraction lead step. Without this the user sees
    // silence after their first message.
    if (repliesAppended === 0 && fallbackKind) {
      const agent = this.registry.get(fallbackKind);
      const result = await agent.run(baseCtx);
      fallbackResult = result;
      if (result.reply) {
        const fallbackMsg = await this.repo.db.appendMessage({
          conversationId: baseCtx.conversationId,
          role: 'assistant',
          agentKind: agent.kind,
          content: result.reply,
        });
        this.events.emitMessageAppended(baseCtx.conversationId, { message: fallbackMsg });
      }
      await this.updateAgentStats(fallbackKind, result.score, result.success);
    }

    // Aggregate output preserving the legacy shape from PR #1/#2.
    const primary = primaryResult ?? { data: {}, score: 0, success: true };
    const output: Record<string, unknown> = { primary: primary.data ?? {} };
    if (secondaryResult && secondaryKind) {
      output[secondaryKind] = secondaryResult.data ?? {};
    }
    if (lead) output.lead = lead;
    if (fallbackResult) output.fallback = fallbackResult.data ?? {};

    const ran: AgentResult[] = [
      ...(primaryResult ? [primaryResult] : []),
      ...(secondaryResult ? [secondaryResult] : []),
      ...(fallbackResult ? [fallbackResult] : []),
    ];
    const score = ran.length === 0 ? 0 : ran.reduce((s, r) => s + r.score, 0) / ran.length;
    const success = ran.length === 0 ? true : ran.every((r) => r.success);

    return { output, score, success };
  }

  private async persistLead(
    conversationId: string,
    data: Record<string, unknown>,
  ): Promise<Lead | null> {
    const service = (data.service as string | null) ?? null;
    const budget = (data.budget as string | null) ?? null;
    const deadline = (data.deadline as string | null) ?? null;
    const contact = (data.contact as string | null) ?? null;
    const notes = (data.notes as string | null) ?? null;
    if (!service && !budget && !deadline && !contact) return null;

    return this.repo.db.createLead({
      conversationId,
      service,
      budget,
      deadline,
      contact,
      notes,
      status: 'new',
    });
  }

  private async updateAgentStats(kind: AgentKind, score: number, success: boolean) {
    try {
      const updated = await this.repo.db.incrementAgentStats(kind, { success, score });
      this.events.emitAgentStatsUpdated({
        agentKind: updated.kind,
        tasksCompleted: updated.tasksCompleted,
        successRate: updated.successRate,
        avgScore: updated.avgScore,
      });
    } catch (err) {
      this.logger.warn(`incrementAgentStats(${kind}) skipped: ${(err as Error).message}`);
    }
  }
}

interface OrchestratorJob {
  taskId: string;
  conversationId: string;
  userMessageId: string;
}
