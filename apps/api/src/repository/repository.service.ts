import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRepository, type Repository } from '@nf/db';
import type { AgentKind, AgentRecord } from '@nf/shared';

const DEFAULT_AGENTS: Array<Omit<AgentRecord, 'id' | 'createdAt'>> = [
  {
    kind: 'community',
    version: 1,
    status: 'active',
    systemPrompt: defaultPrompt('community'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'lead',
    version: 1,
    status: 'active',
    systemPrompt: defaultPrompt('lead'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'sales',
    version: 1,
    status: 'active',
    systemPrompt: defaultPrompt('sales'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'project_manager',
    version: 1,
    status: 'inactive',
    systemPrompt: defaultPrompt('project_manager'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'builder',
    version: 1,
    status: 'inactive',
    systemPrompt: defaultPrompt('builder'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'qa',
    version: 1,
    status: 'inactive',
    systemPrompt: defaultPrompt('qa'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'bugfix',
    version: 1,
    status: 'inactive',
    systemPrompt: defaultPrompt('bugfix'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
  {
    kind: 'growth',
    version: 1,
    status: 'inactive',
    systemPrompt: defaultPrompt('growth'),
    tasksCompleted: 0,
    successRate: 0,
    avgScore: 0,
    revenueGenerated: 0,
  },
];

function defaultPrompt(kind: AgentKind): string {
  switch (kind) {
    case 'community':
      return 'You are the NF Community AI — a warm, helpful community manager. Greet users, ask what they want to build, and gather context. Keep replies under 4 sentences.';
    case 'lead':
      return 'You are a lead extractor. Given a user message, extract service, budget, deadline, contact, notes. Output strict JSON only.';
    case 'sales':
      return 'You are a sales AI. Given a lead, draft a short proposal: scope, 3-5 milestones, price range, next step. Be concise and professional.';
    case 'project_manager':
      return 'You are a project manager AI. Break a signed project into subtasks with owners and acceptance criteria.';
    case 'builder':
      return 'You are a builder AI. Generate clean, runnable code for the assigned subtask. Output a file map.';
    case 'qa':
      return 'You are a QA AI. Validate outputs against acceptance criteria. Return pass/fail and explanations.';
    case 'bugfix':
      return 'You are a bug fix AI. Given a failing QA report, patch the code and explain the fix.';
    case 'growth':
      return 'You are a growth AI. Suggest upsells, referrals and retention tactics based on customer history.';
  }
}

@Injectable()
export class RepositoryService implements OnModuleInit {
  private readonly logger = new Logger(RepositoryService.name);
  private readonly repo: Repository;

  constructor(config: ConfigService) {
    this.repo = createRepository({
      SUPABASE_URL: config.get<string>('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: config.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
    });
    this.logger.log(`Repository backend: ${this.repo.kind}`);
  }

  get kind() {
    return this.repo.kind;
  }

  get db(): Repository {
    return this.repo;
  }

  async onModuleInit() {
    // Seed default agent registry so the dashboard has something to render.
    try {
      for (const agent of DEFAULT_AGENTS) {
        const existing = await this.repo.getAgent(agent.kind);
        if (!existing) await this.repo.upsertAgent(agent);
      }
    } catch (err) {
      this.logger.warn(`Agent seeding skipped: ${(err as Error).message}`);
    }
  }
}
