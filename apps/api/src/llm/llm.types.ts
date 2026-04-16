export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompleteOptions {
  messages: LlmMessage[];
  /** JSON schema hint injected into the system prompt to coax structured output. */
  jsonSchemaHint?: string;
  /** Temperature (0..2). */
  temperature?: number;
  /** Max tokens for completion. */
  maxTokens?: number;
  /** If true, ask the provider for a JSON object response. */
  json?: boolean;
}

export interface LlmProvider {
  readonly name: 'openai' | 'anthropic' | 'stub';
  complete(options: LlmCompleteOptions): Promise<string>;
}
