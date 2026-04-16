import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from './agent.base';

/**
 * Phase 3+ agent — stubbed in Phase 1.
 *
 * Future responsibility: suggest upsells, referral prompts and retention
 * tactics based on customer history.
 */
@Injectable()
export class GrowthAgent implements Agent {
  readonly kind: AgentKind = 'growth';

  async run(_ctx: AgentContext): Promise<AgentResult> {
    return {
      data: { suggestions: [] },
      score: 0.5,
      success: true,
    };
  }
}
