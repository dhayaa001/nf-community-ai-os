import type { LlmCompleteOptions, LlmProvider } from './llm.types';

/**
 * Deterministic fallback "LLM" so the app boots and the full chat pipeline
 * works without any API keys. Responses are obviously scripted — this is for
 * development, CI, and demos, not production. Real agents only kick in when
 * OPENAI_API_KEY or ANTHROPIC_API_KEY is set.
 */
export class StubProvider implements LlmProvider {
  readonly name = 'stub' as const;

  async complete(opts: LlmCompleteOptions): Promise<string> {
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const system = opts.messages.find((m) => m.role === 'system')?.content ?? '';

    if (opts.json) {
      // Shape-aware stubbing for structured calls.
      if (system.includes('intent classifier')) {
        return JSON.stringify({
          intent: this.guessIntent(lastUser),
          confidence: 0.55,
          reasoning: 'stub provider heuristic',
        });
      }
      if (system.includes('lead extractor')) {
        return JSON.stringify({
          service: extractKeyword(lastUser, ['website', 'app', 'mobile', 'crm', 'ai']) ?? null,
          budget: extractMoney(lastUser),
          deadline: extractDeadline(lastUser),
          contact: extractEmail(lastUser),
          notes: lastUser.slice(0, 200),
        });
      }
      return '{}';
    }

    if (system.includes('community manager')) {
      return `Hi — thanks for reaching out! I'm the NF Community AI. Tell me what you're trying to build and roughly your budget & timeline, and I'll route you to the right part of the team. (stub-mode: set OPENAI_API_KEY for real replies.)`;
    }
    if (system.includes('sales')) {
      return `Here's a draft proposal based on what you've shared. Scope, milestones and pricing will be confirmed in a follow-up. (stub-mode)`;
    }

    return `[stub LLM] echoing: ${lastUser.slice(0, 200)}`;
  }

  private guessIntent(text: string): string {
    const lower = text.toLowerCase();
    if (/(build|create|need a|website|app|crm|ai)/.test(lower)) return 'lead_capture';
    if (/(price|quote|proposal|cost)/.test(lower)) return 'sales_proposal';
    if (/(bug|broken|issue|error)/.test(lower)) return 'support';
    return 'chat';
  }
}

function extractMoney(s: string): string | null {
  const m = s.match(/\$[\d,]+(?:\.\d+)?|\b\d+k\b/i);
  return m ? m[0] : null;
}

function extractEmail(s: string): string | null {
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

function extractDeadline(s: string): string | null {
  const m = s.match(/\b(?:in\s+)?(\d+\s*(?:day|week|month)s?|(?:q[1-4]|next\s+quarter|asap))\b/i);
  return m ? m[0] : null;
}

function extractKeyword(s: string, words: string[]): string | null {
  const lower = s.toLowerCase();
  return words.find((w) => lower.includes(w)) ?? null;
}
