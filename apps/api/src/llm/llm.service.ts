import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import { StubProvider } from './stub.provider';
import type { LlmCompleteOptions, LlmProvider } from './llm.types';

/**
 * Single entry-point for every agent to call an LLM.
 * Selects provider in this order: OpenAI → Anthropic → Stub.
 * Attempts fallback to Anthropic if a real OpenAI call fails at runtime.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly primary: LlmProvider;
  private readonly fallback?: LlmProvider;

  constructor(config: ConfigService) {
    const openaiKey = config.get<string>('OPENAI_API_KEY');
    const anthropicKey = config.get<string>('ANTHROPIC_API_KEY');
    const openaiModel = config.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
    const anthropicModel = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-latest';

    if (openaiKey) {
      this.primary = new OpenAiProvider(openaiKey, openaiModel);
      if (anthropicKey) this.fallback = new AnthropicProvider(anthropicKey, anthropicModel);
    } else if (anthropicKey) {
      this.primary = new AnthropicProvider(anthropicKey, anthropicModel);
    } else {
      this.primary = new StubProvider();
    }

    this.logger.log(
      `LLM provider=${this.primary.name}${this.fallback ? ` fallback=${this.fallback.name}` : ''}`,
    );
  }

  get providerName(): string {
    return this.primary.name;
  }

  async complete(opts: LlmCompleteOptions): Promise<string> {
    try {
      return await this.primary.complete(opts);
    } catch (err) {
      this.logger.warn(`Primary LLM ${this.primary.name} failed: ${(err as Error).message}`);
      if (this.fallback) {
        this.logger.log(`Falling back to ${this.fallback.name}`);
        return this.fallback.complete(opts);
      }
      throw err;
    }
  }
}
