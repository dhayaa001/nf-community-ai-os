import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from './agent.base';

/**
 * Phase 3 agent — stubbed in Phase 1.
 *
 * Future responsibility: validate Builder outputs against acceptance criteria
 * (lint, type-check, runtime smoke tests) and emit pass/fail.
 */
@Injectable()
export class QaAgent implements Agent {
  readonly kind: AgentKind = 'qa';

  async run(_ctx: AgentContext): Promise<AgentResult> {
    return {
      data: { passed: true, failures: [] },
      score: 0.5,
      success: true,
    };
  }
}
