import { Injectable } from '@nestjs/common';
import type { AgentKind } from '@nf/shared';
import { LlmService } from '../llm/llm.service';
import type { LlmMessage } from '../llm/llm.types';
import type { Agent, AgentContext, AgentResult } from './agent.base';

const SYSTEM_PROMPT = `You are the NF Community AI — the community manager for an AI-run IT company.
Your job: greet visitors warmly, engage them about what they want to build, and uncover intent
(service type, budget, timeline). Keep replies concise, friendly, and under 4 short sentences.
If the user expresses a concrete build/hire/buy request, nudge them to share service, budget and deadline.`;

@Injectable()
export class CommunityAgent implements Agent {
  readonly kind: AgentKind = 'community';

  constructor(private readonly llm: LlmService) {}

  async run(ctx: AgentContext): Promise<AgentResult> {
    // ctx.history already contains the latest user message (the orchestrator
    // persists it before dispatching). Don't append ctx.latestUserMessage
    // again or the LLM sees the turn twice.
    const historyMessages: LlmMessage[] = ctx.history.slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const reply = await this.llm.complete({
      messages: [
        { role: 'system', content: `community manager\n${SYSTEM_PROMPT}` },
        ...historyMessages,
      ],
      temperature: 0.6,
      maxTokens: 300,
    });

    return { reply: reply || 'Tell me a bit more about what you have in mind.', score: 0.8, success: true };
  }
}
