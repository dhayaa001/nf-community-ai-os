import OpenAI from 'openai';
import type { LlmCompleteOptions, LlmProvider } from './llm.types';

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async complete(opts: LlmCompleteOptions): Promise<string> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 800,
      response_format: opts.json ? { type: 'json_object' } : undefined,
    });
    return resp.choices[0]?.message?.content?.trim() ?? '';
  }
}
