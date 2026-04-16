import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { LlmModule } from '../llm/llm.module';
import { IntentClassifier } from './intent-classifier';
import { OrchestratorService } from './orchestrator.service';

@Module({
  imports: [LlmModule, AgentsModule],
  providers: [IntentClassifier, OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
