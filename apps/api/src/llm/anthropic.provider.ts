import type { LlmCompleteOptions, LlmProvider } from './llm.types';

/**
 * Anthropic fallback provider. Uses the REST API directly so we avoid another
 * heavyweight SDK until we need richer features.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-3-5-sonnet-latest',
  ) {}

  async complete(opts: LlmCompleteOptions): Promise<string> {
    const system = opts.messages.find((m) => m.role === 'system')?.content;
    const messages = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        system,
        messages,
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.3,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
  }
}
