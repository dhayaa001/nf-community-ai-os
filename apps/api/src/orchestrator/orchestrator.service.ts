import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AgentKind, Intent, Lead, Task } from '@nf/shared';
import { AgentRegistry } from '../agents/agent-registry';
import type { AgentContext } from '../agents/agent.base';
import { EventsGateway } from '../events/events.gateway';
import { QueueService } from '../queue/queue.service';
import { RepositoryService } from '../repository/repository.service';
import { IntentClassifier } from './intent-classifier';

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
    const assignedAgent = this.routeIntent(intent);
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

  // ---- Routing ------------------------------------------------------------

  private routeIntent(intent: Intent): AgentKind {
    switch (intent) {
      case 'lead_capture':
        return 'lead';
      case 'sales_proposal':
        return 'sales';
      case 'project_kickoff':
        return 'project_manager';
      case 'build_request':
        return 'builder';
      case 'support':
        return 'bugfix';
      case 'chat':
      default:
        return 'community';
    }
  }

  /**
   * Run the assigned agent, append the assistant reply, and for lead_capture
   * also run the SalesAgent to produce a proposal as a follow-up turn.
   */
  private async dispatch(
    task: Task,
    baseCtx: Omit<AgentContext, 'extra'>,
  ): Promise<{ output: Record<string, unknown>; score: number; success: boolean }> {
    const agent = this.registry.get(task.assignedAgent);
    const primary = await agent.run(baseCtx);

    if (primary.reply) {
      const assistantMsg = await this.repo.db.appendMessage({
        conversationId: baseCtx.conversationId,
        role: 'assistant',
        agentKind: agent.kind,
        content: primary.reply,
      });
      this.events.emitMessageAppended(baseCtx.conversationId, { message: assistantMsg });
    }

    // lead_capture → persist structured lead + chain into sales draft
    if (task.intent === 'lead_capture' && primary.data) {
      const lead = await this.persistLead(baseCtx.conversationId, primary.data);
      if (lead) {
        this.events.emitLeadCaptured(baseCtx.conversationId, { lead });
        const sales = this.registry.get('sales');
        const salesResult = await sales.run({ ...baseCtx, extra: { lead } });
        if (salesResult.reply) {
          const salesMsg = await this.repo.db.appendMessage({
            conversationId: baseCtx.conversationId,
            role: 'assistant',
            agentKind: 'sales',
            content: salesResult.reply,
          });
          this.events.emitMessageAppended(baseCtx.conversationId, { message: salesMsg });
        }
        await this.updateAgentStats('sales', salesResult.score, salesResult.success);
        return {
          output: { primary: primary.data, lead, sales: salesResult.data ?? {} },
          score: (primary.score + salesResult.score) / 2,
          success: primary.success && salesResult.success,
        };
      }
    }

    return { output: { primary: primary.data ?? {} }, score: primary.score, success: primary.success };
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
