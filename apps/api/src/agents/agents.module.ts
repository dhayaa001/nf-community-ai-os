import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AgentRegistry } from './agent-registry';
import { CommunityAgent } from './community.agent';
import { LeadAgent } from './lead.agent';
import { SalesAgent } from './sales.agent';
import { ProjectManagerAgent } from './project-manager.agent';
import { BuilderAgent } from './builder.agent';
import { QaAgent } from './qa.agent';
import { BugFixAgent } from './bugfix.agent';
import { GrowthAgent } from './growth.agent';

/**
 * Every agent is a self-contained class implementing a single `run` method.
 * The registry gives the orchestrator a uniform dispatch interface, so adding
 * agents in later phases is a one-liner.
 */
@Module({
  imports: [LlmModule],
  providers: [
    CommunityAgent,
    LeadAgent,
    SalesAgent,
    ProjectManagerAgent,
    BuilderAgent,
    QaAgent,
    BugFixAgent,
    GrowthAgent,
    AgentRegistry,
  ],
  exports: [AgentRegistry],
})
export class AgentsModule {}
