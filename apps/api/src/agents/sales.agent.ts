import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import { LlmService } from '../llm/llm.service';
import type { Agent, AgentContext, AgentResult } from './agent.base';

const SYSTEM_PROMPT = `You are a sales AI for an AI-run IT company. Given a captured lead
(service, budget, deadline, contact), draft a short professional proposal reply:
  - One-line positioning / understanding
  - 3-5 milestone bullets
  - Indicative pricing tier (use the lead's budget as anchor; if missing, give a range)
  - Clear next step (e.g. "confirm to proceed; we'll send Stripe checkout")
Keep total under 160 words. Do NOT promise delivery times you can't keep.`;

@Injectable()
export class SalesAgent implements Agent {
  readonly kind: AgentKind = 'sales';

  constructor(private readonly llm: LlmService) {}

  async run(ctx: AgentContext): Promise<AgentResult> {
    const lead = ctx.extra?.lead ?? {};
    const reply = await this.llm.complete({
      messages: [
        { role: 'system', content: `sales\n${SYSTEM_PROMPT}` },
        {
          role: 'user',
          content: `Lead: ${JSON.stringify(lead)}\nUser's latest message: ${ctx.latestUserMessage}\nWrite the proposal now.`,
        },
      ],
      temperature: 0.4,
      maxTokens: 500,
    });

    return { reply, score: 0.8, success: Boolean(reply) };
  }
}
