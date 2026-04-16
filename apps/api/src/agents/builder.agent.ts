import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from './agent.base';

/**
 * Phase 3 agent — stubbed in Phase 1.
 *
 * Future responsibility: generate a runnable file map (frontend + backend)
 * for an assigned subtask, using the code-generation prompt and an artifact
 * store. Outputs go to QaAgent next.
 */
@Injectable()
export class BuilderAgent implements Agent {
  readonly kind: AgentKind = 'builder';

  async run(_ctx: AgentContext): Promise<AgentResult> {
    return {
      reply:
        'Builder agent is not yet activated (Phase 3). Code generation will run here once we wire the builder pipeline.',
      data: { files: [] },
      score: 0.5,
      success: false,
    };
  }
}
