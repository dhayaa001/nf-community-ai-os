import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentKind, Intent, Lead, Message, Task } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from '../agents/agent.base';
import { AgentRegistry } from '../agents/agent-registry';
import { EventsGateway } from '../events/events.gateway';
import { QueueService } from '../queue/queue.service';
import { RepositoryService } from '../repository/repository.service';
import { IntentClassifier } from './intent-classifier';
import { OrchestratorService } from './orchestrator.service';
import { INTENT_FALLBACKS, INTENT_PIPELINES, primaryAgentFor } from './pipeline-registry';

/**
 * Phase 3 — orchestrator pipeline tests.
 *
 * Goal: lock in the lead→sales chain + community fallback that PR #1/#2
 * shipped, now that the dispatch logic is driven by INTENT_PIPELINES rather
 * than a hard-coded switch. Also exercises the new haltPipeline / handoff
 * carry-over so future agents can rely on them.
 *
 * These tests stub the registry/repo/events/queue at the smallest interface
 * the orchestrator uses — Nest's TestingModule isn't necessary here and
 * adds startup time we don't need.
 */

interface FakeAgentSpec {
  kind: AgentKind;
  result: AgentResult;
}

function makeAgent({ kind, result }: FakeAgentSpec): Agent {
  return {
    kind,
    run: vi.fn(async (_ctx: AgentContext) => result),
  };
}

function makeRegistry(specs: FakeAgentSpec[]): AgentRegistry {
  const map = new Map<AgentKind, Agent>(specs.map((s) => [s.kind, makeAgent(s)]));
  return {
    get: (kind: AgentKind) => {
      const a = map.get(kind);
      if (!a) throw new Error(`No agent registered for kind=${kind}`);
      return a;
    },
  } as unknown as AgentRegistry;
}

function makeMessage(role: Message['role'], content: string, agentKind?: AgentKind): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: 'conv-1',
    role,
    agentKind,
    content,
    createdAt: new Date().toISOString(),
  };
}

function makeTask(intent: Intent): Task {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    intent,
    assignedAgent: primaryAgentFor(intent),
    status: 'running',
    input: { message: 'hi', reasoning: '' },
    output: null,
    score: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

function makeRepo() {
  const messages: Message[] = [];
  const tasks: Record<string, Task> = {};
  const leads: Lead[] = [];
  const db = {
    appendMessage: vi.fn(async (m: Omit<Message, 'id' | 'createdAt'>) => {
      const full = makeMessage(m.role, m.content, m.agentKind);
      messages.push(full);
      return full;
    }),
    listMessages: vi.fn(async (_id: string) => [...messages]),
    getConversation: vi.fn(async (_id: string) => ({
      id: 'conv-1',
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    createConversation: vi.fn(async () => ({
      id: 'conv-1',
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    createTask: vi.fn(async (t: Omit<Task, 'id' | 'createdAt' | 'completedAt'>) => {
      const full: Task = {
        ...t,
        id: 'task-1',
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      tasks[full.id] = full;
      return full;
    }),
    getTask: vi.fn(async (id: string) => tasks[id] ?? null),
    updateTask: vi.fn(async (id: string, patch: Partial<Task>) => {
      tasks[id] = { ...tasks[id], ...patch } as Task;
      return tasks[id];
    }),
    createLead: vi.fn(async (l: Omit<Lead, 'id' | 'createdAt'>) => {
      const full: Lead = { ...l, id: `lead-${leads.length + 1}`, createdAt: new Date().toISOString() };
      leads.push(full);
      return full;
    }),
    incrementAgentStats: vi.fn(async (kind: AgentKind, _delta: { success: boolean; score: number }) => ({
      kind,
      tasksCompleted: 1,
      successRate: 1,
      avgScore: 1,
    })),
  };
  return { db, messages, tasks, leads } as const;
}

function makeEvents(): EventsGateway {
  return {
    emitMessageAppended: vi.fn(),
    emitTaskCreated: vi.fn(),
    emitTaskUpdated: vi.fn(),
    emitTaskCompleted: vi.fn(),
    emitLeadCaptured: vi.fn(),
    emitAgentStatsUpdated: vi.fn(),
  } as unknown as EventsGateway;
}

function makeQueue(): QueueService {
  return {
    registerHandler: vi.fn(),
    enqueue: vi.fn(async () => undefined),
  } as unknown as QueueService;
}

function makeClassifier(intent: Intent): IntentClassifier {
  return {
    classify: vi.fn(async () => ({ intent, confidence: 0.9, reasoning: '' })),
  } as unknown as IntentClassifier;
}

interface BuildSubject {
  registrySpecs: FakeAgentSpec[];
  intent: Intent;
}

function buildSubject({ registrySpecs, intent }: BuildSubject) {
  const repoMock = makeRepo();
  const repo = { db: repoMock.db } as unknown as RepositoryService;
  const events = makeEvents();
  const queue = makeQueue();
  const classifier = makeClassifier(intent);
  const registry = makeRegistry(registrySpecs);
  const svc = new OrchestratorService(repo, events, queue, classifier, registry);
  return { svc, repo, repoMock, events, queue, classifier, registry };
}

describe('OrchestratorService.dispatch (Phase 3 pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lead_capture: extracted fields → sales chain runs and lead is persisted', async () => {
    const leadResult: AgentResult = {
      data: { service: 'website', budget: '$10,000', deadline: 'in 6 weeks', contact: null, notes: null },
      score: 0.85,
      success: true,
    };
    const salesResult: AgentResult = {
      reply: 'Here is your proposal...',
      data: { proposal: 'draft' },
      score: 0.9,
      success: true,
    };
    const { svc, repoMock, events } = buildSubject({
      registrySpecs: [
        { kind: 'lead', result: leadResult },
        { kind: 'sales', result: salesResult },
        { kind: 'community', result: { score: 0, success: true } },
      ],
      intent: 'lead_capture',
    });

    const task = makeTask('lead_capture');
    const baseCtx: Omit<AgentContext, 'extra'> = {
      conversationId: 'conv-1',
      history: [],
      latestUserMessage: 'I want a website for $10,000 in 6 weeks',
    };

    // dispatch is private; reach in via bracket access for test purposes only.
    // The signature is part of the orchestrator's internal contract and is
    // covered by the orchestrator's own consumers (processJob).
    const out = await (svc as unknown as {
      dispatch(t: Task, c: Omit<AgentContext, 'extra'>): Promise<{
        output: Record<string, unknown>;
        score: number;
        success: boolean;
      }>;
    }).dispatch(task, baseCtx);

    expect(repoMock.db.createLead).toHaveBeenCalledTimes(1);
    expect(repoMock.leads).toHaveLength(1);
    expect(repoMock.leads[0].service).toBe('website');
    expect(events.emitLeadCaptured).toHaveBeenCalledOnce();

    // Sales reply was appended
    const salesAppended = repoMock.db.appendMessage.mock.calls.find(
      (c) => c[0].agentKind === 'sales',
    );
    expect(salesAppended?.[0].content).toBe('Here is your proposal...');

    // Output preserves legacy { primary, sales, lead } shape
    expect(out.output).toMatchObject({
      primary: leadResult.data,
      sales: salesResult.data,
      lead: expect.objectContaining({ service: 'website' }),
    });
    expect(out.success).toBe(true);
  });

  it('lead_capture: empty extraction → halt before sales, community fallback runs', async () => {
    const emptyLead: AgentResult = {
      data: { service: null, budget: null, deadline: null, contact: null, notes: null },
      score: 0.3,
      success: false,
    };
    const salesAgent = makeAgent({ kind: 'sales', result: { score: 0, success: true } });
    const community: AgentResult = {
      reply: 'Could you tell me more about your project?',
      data: { tone: 'curious' },
      score: 0.6,
      success: true,
    };
    const { svc, repoMock, events } = buildSubject({
      registrySpecs: [
        { kind: 'lead', result: emptyLead },
        { kind: 'sales', result: { score: 0, success: true } },
        { kind: 'community', result: community },
      ],
      intent: 'lead_capture',
    });
    // Replace sales agent with the spy so we can assert it never ran
    (svc as unknown as { registry: AgentRegistry }).registry = makeRegistry([
      { kind: 'lead', result: emptyLead },
      { kind: 'community', result: community },
    ]);
    // We could expose the spy directly; simpler check: createLead never called
    // and no message appended with agentKind === 'sales'. Verified below.
    void salesAgent;

    const out = await (svc as unknown as {
      dispatch(t: Task, c: Omit<AgentContext, 'extra'>): Promise<{
        output: Record<string, unknown>;
        score: number;
        success: boolean;
      }>;
    }).dispatch(makeTask('lead_capture'), {
      conversationId: 'conv-1',
      history: [],
      latestUserMessage: 'hello there',
    });

    // No lead persisted, no lead_captured event
    expect(repoMock.db.createLead).not.toHaveBeenCalled();
    expect(events.emitLeadCaptured).not.toHaveBeenCalled();

    // Community fallback reply was appended
    const communityAppended = repoMock.db.appendMessage.mock.calls.find(
      (c) => c[0].agentKind === 'community',
    );
    expect(communityAppended?.[0].content).toBe(community.reply);

    // No sales message ever appended
    const salesAppended = repoMock.db.appendMessage.mock.calls.find(
      (c) => c[0].agentKind === 'sales',
    );
    expect(salesAppended).toBeUndefined();

    expect(out.output).toMatchObject({
      primary: emptyLead.data,
      fallback: community.data,
    });
    expect(out.output).not.toHaveProperty('lead');
    expect(out.output).not.toHaveProperty('sales');
  });

  it('chat: single-step pipeline runs community only, no fallback', async () => {
    const community: AgentResult = {
      reply: 'Hey there!',
      data: {},
      score: 0.7,
      success: true,
    };
    const { svc, repoMock, events } = buildSubject({
      registrySpecs: [{ kind: 'community', result: community }],
      intent: 'chat',
    });

    const out = await (svc as unknown as {
      dispatch(t: Task, c: Omit<AgentContext, 'extra'>): Promise<{
        output: Record<string, unknown>;
        score: number;
        success: boolean;
      }>;
    }).dispatch(makeTask('chat'), {
      conversationId: 'conv-1',
      history: [],
      latestUserMessage: 'hi',
    });

    expect(repoMock.db.appendMessage).toHaveBeenCalledTimes(1);
    expect(events.emitLeadCaptured).not.toHaveBeenCalled();
    expect(out.output).toEqual({ primary: {} });
    expect(out.output).not.toHaveProperty('fallback');
  });

  it('haltPipeline: stops at the requesting step without running downstream', async () => {
    const lead: AgentResult = {
      reply: 'thanks for the info',
      data: { service: 'website', budget: '$5k', deadline: null, contact: null, notes: null },
      score: 0.7,
      success: true,
      haltPipeline: true,
    };
    const { svc, repoMock } = buildSubject({
      registrySpecs: [
        { kind: 'lead', result: lead },
        { kind: 'sales', result: { reply: 'should not run', score: 1, success: true } },
        { kind: 'community', result: { score: 0, success: true } },
      ],
      intent: 'lead_capture',
    });

    await (svc as unknown as {
      dispatch(t: Task, c: Omit<AgentContext, 'extra'>): Promise<{
        output: Record<string, unknown>;
        score: number;
        success: boolean;
      }>;
    }).dispatch(makeTask('lead_capture'), {
      conversationId: 'conv-1',
      history: [],
      latestUserMessage: 'I want a website for $5k',
    });

    const salesAppended = repoMock.db.appendMessage.mock.calls.find(
      (c) => c[0].agentKind === 'sales',
    );
    expect(salesAppended).toBeUndefined();
  });

  it('handoff: subsequent step receives merged extra context', async () => {
    const leadResult: AgentResult = {
      data: { service: 'website', budget: '$10k', deadline: null, contact: null, notes: null },
      score: 0.8,
      success: true,
      handoff: { briefingNote: 'urgent client' },
    };
    const salesAgent = makeAgent({
      kind: 'sales',
      result: { reply: 'sales reply', score: 0.9, success: true },
    });
    const registry = {
      get: (kind: AgentKind) => {
        if (kind === 'lead') return makeAgent({ kind: 'lead', result: leadResult });
        if (kind === 'sales') return salesAgent;
        if (kind === 'community') return makeAgent({ kind: 'community', result: { score: 0, success: true } });
        throw new Error(`unexpected kind=${kind}`);
      },
    } as unknown as AgentRegistry;

    const repoMock = makeRepo();
    const events = makeEvents();
    const svc = new OrchestratorService(
      { db: repoMock.db } as unknown as RepositoryService,
      events,
      makeQueue(),
      makeClassifier('lead_capture'),
      registry,
    );

    await (svc as unknown as {
      dispatch(t: Task, c: Omit<AgentContext, 'extra'>): Promise<{
        output: Record<string, unknown>;
        score: number;
        success: boolean;
      }>;
    }).dispatch(makeTask('lead_capture'), {
      conversationId: 'conv-1',
      history: [],
      latestUserMessage: 'I want a website for $10k',
    });

    const salesCallCtx = (salesAgent.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(salesCallCtx?.extra).toMatchObject({
      lead: expect.objectContaining({ service: 'website' }),
      briefingNote: 'urgent client',
    });
  });
});

describe('pipeline-registry', () => {
  it('INTENT_PIPELINES covers every Intent with at least one agent', () => {
    const intents: Intent[] = [
      'chat',
      'lead_capture',
      'sales_proposal',
      'project_kickoff',
      'build_request',
      'support',
    ];
    for (const intent of intents) {
      const pipeline = INTENT_PIPELINES[intent];
      expect(pipeline, `intent=${intent}`).toBeDefined();
      expect(pipeline.length, `intent=${intent}`).toBeGreaterThan(0);
    }
  });

  it('lead_capture has community as its fallback', () => {
    expect(INTENT_FALLBACKS.lead_capture).toBe('community');
  });

  it('primaryAgentFor returns the first agent in the pipeline', () => {
    expect(primaryAgentFor('chat')).toBe('community');
    expect(primaryAgentFor('lead_capture')).toBe('lead');
    expect(primaryAgentFor('support')).toBe('bugfix');
  });
});
