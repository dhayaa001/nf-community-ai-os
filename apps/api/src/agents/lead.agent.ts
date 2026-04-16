import { Injectable, Logger } from '@nestjs/common';
import { leadExtractionSchema, type AgentKind, type LeadExtraction } from '@nf/shared';
import { LlmService } from '../llm/llm.service';
import type { Agent, AgentContext, AgentResult } from './agent.base';

const SYSTEM_PROMPT = `You are a lead extractor. From the conversation, extract these fields:
  service (what the user wants built), budget (any mention of money or tier),
  deadline (timeline / urgency), contact (email / handle if provided),
  notes (1-2 sentence summary of the ask).
Return strict JSON matching: {"service": string|null, "budget": string|null,
"deadline": string|null, "contact": string|null, "notes": string|null}.
Any field you cannot infer must be null.`;

@Injectable()
export class LeadAgent implements Agent {
  readonly kind: AgentKind = 'lead';
  private readonly logger = new Logger(LeadAgent.name);

  constructor(private readonly llm: LlmService) {}

  async run(ctx: AgentContext): Promise<AgentResult> {
    const transcript = ctx.history
      .slice(-10)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    const raw = await this.llm.complete({
      messages: [
        { role: 'system', content: `lead extractor\n${SYSTEM_PROMPT}` },
        {
          role: 'user',
          content: `Conversation so far:\n${transcript}\nLatest user message:\n${ctx.latestUserMessage}\n\nReturn JSON only.`,
        },
      ],
      temperature: 0,
      maxTokens: 400,
      json: true,
    });

    const parsed = this.safeParse(raw);
    const hasSignal = Boolean(parsed.service || parsed.budget || parsed.deadline || parsed.contact);

    return {
      data: parsed as unknown as Record<string, unknown>,
      score: hasSignal ? 0.85 : 0.3,
      success: hasSignal,
    };
  }

  private safeParse(raw: string): LeadExtraction {
    try {
      const parsed = leadExtractionSchema.parse(JSON.parse(raw));
      return parsed;
    } catch (err) {
      this.logger.warn(`Lead extraction JSON parse failed: ${(err as Error).message}`);
      return { service: null, budget: null, deadline: null, contact: null, notes: null };
    }
  }
}
