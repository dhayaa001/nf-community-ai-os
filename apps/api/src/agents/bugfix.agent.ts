import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from './agent.base';

/**
 * Phase 3 agent — stubbed in Phase 1.
 *
 * Future responsibility: given a QA failure report, generate a minimal
 * patch and re-submit to QA.
 */
@Injectable()
export class BugFixAgent implements Agent {
  readonly kind: AgentKind = 'bugfix';

  async run(_ctx: AgentContext): Promise<AgentResult> {
    return {
      data: { patches: [] },
      score: 0.5,
      success: true,
    };
  }
}
