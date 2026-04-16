import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent } from './agent.base';
import { BugFixAgent } from './bugfix.agent';
import { BuilderAgent } from './builder.agent';
import { CommunityAgent } from './community.agent';
import { GrowthAgent } from './growth.agent';
import { LeadAgent } from './lead.agent';
import { ProjectManagerAgent } from './project-manager.agent';
import { QaAgent } from './qa.agent';
import { SalesAgent } from './sales.agent';

@Injectable()
export class AgentRegistry {
  private readonly agents = new Map<AgentKind, Agent>();

  constructor(
    community: CommunityAgent,
    lead: LeadAgent,
    sales: SalesAgent,
    pm: ProjectManagerAgent,
    builder: BuilderAgent,
    qa: QaAgent,
    bugfix: BugFixAgent,
    growth: GrowthAgent,
  ) {
    for (const a of [community, lead, sales, pm, builder, qa, bugfix, growth]) {
      this.agents.set(a.kind, a);
    }
  }

  get(kind: AgentKind): Agent {
    const a = this.agents.get(kind);
    if (!a) throw new Error(`No agent registered for kind=${kind}`);
    return a;
  }
}
