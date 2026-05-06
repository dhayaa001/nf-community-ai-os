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

/**
 * Return the *last* match of `re` in `s`, or null. Use for fields where the
 * user's most recent value should win (budget, deadline) — earlier turns
 * often contain a rough number the user then revises. Plain `.match()`
 * always picks the first hit, which regresses on the 2nd turn.
 * Tech-debt A1.
 */
function lastMatch(s: string, re: RegExp): string | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = global.exec(s)) !== null) {
    last = m;
    // Guard against zero-width matches causing an infinite loop.
    if (m.index === global.lastIndex) global.lastIndex += 1;
  }
  return last ? last[0] : null;
}

export function extractMoney(s: string): string | null {
  // Three alternatives tried in order:
  //   1. Comma-formatted ($10,000) — requires AT LEAST one `,\d{3}` group
  //      (the `+` quantifier). If we used `*` here, `$1000` would match as
  //      `$100` because `\d{1,3}` is greedy-maximal-of-3 and zero comma
  //      groups would satisfy the rest — then the regex engine would stop
  //      without ever trying alternative 2.
  //   2. Plain digits ($1000, $5, $99.99).
  //   3. Shorthand "Nk" (12k).
  // The first alternative is anchored on digit triples so we don't swallow
  // a trailing list comma (`"$10,000, deadline..."` → `$10,000`, not `$10,000,`).
  return lastMatch(s, /\$\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$\d+(?:\.\d+)?|\b\d+k\b/i);
}

export function extractEmail(s: string): string | null {
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

export function extractDeadline(s: string): string | null {
  return lastMatch(
    s,
    /\b(?:in\s+)?(?:\d+\s*(?:day|week|month)s?|q[1-4]|next\s+quarter|asap)\b/i,
  );
}

export function extractKeyword(s: string, words: string[]): string | null {
  const lower = s.toLowerCase();
  // Scan words in order, but within the text prefer the *last* occurrence
  // so a later turn can change the service (e.g. "website" → "mobile app").
  let bestWord: string | null = null;
  let bestIdx = -1;
  for (const w of words) {
    const idx = lower.lastIndexOf(w);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestWord = w;
    }
  }
  return bestWord;
}
