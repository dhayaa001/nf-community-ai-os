import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import type { Agent, AgentContext, AgentResult } from './agent.base';

/**
 * Phase 3 agent — stubbed in Phase 1.
 *
 * Future responsibility: break a signed project into subtasks (title, owner,
 * acceptance criteria) and hand them off to the Builder agent via the queue.
 */
@Injectable()
export class ProjectManagerAgent implements Agent {
  readonly kind: AgentKind = 'project_manager';

  async run(_ctx: AgentContext): Promise<AgentResult> {
    return {
      reply:
        'Project Manager agent is not yet activated (Phase 3). Your project will be queued and handled once the build pipeline is live.',
      data: { subtasks: [] },
      score: 0.5,
      success: false,
    };
  }
}
