import { Injectable, Logger } from '@nestjs/common';
import { intentClassificationSchema, type Intent, type IntentClassification } from '@nf/shared';
import { LlmService } from '../llm/llm.service';

const SYSTEM_PROMPT = `You are an intent classifier for an AI-run IT company's chat.
Classify the latest user message into ONE of:
  - "chat"             (small talk / generic questions)
  - "lead_capture"     (user wants a project built / is shopping)
  - "sales_proposal"   (user wants price / proposal / commitment)
  - "project_kickoff"  (user has agreed, wants to start)
  - "build_request"    (user explicitly asks to build/generate code)
  - "support"          (user reports an issue / bug)
Return strict JSON: {"intent": string, "confidence": number, "reasoning": string}.`;

@Injectable()
export class IntentClassifier {
  private readonly logger = new Logger(IntentClassifier.name);

  constructor(private readonly llm: LlmService) {}

  async classify(latestUserMessage: string, history: string[]): Promise<IntentClassification> {
    const raw = await this.llm.complete({
      messages: [
        { role: 'system', content: `intent classifier\n${SYSTEM_PROMPT}` },
        {
          role: 'user',
          content: `Recent turns:\n${history.slice(-6).join('\n')}\n\nLatest user message:\n${latestUserMessage}`,
        },
      ],
      temperature: 0,
      maxTokens: 200,
      json: true,
    });
    try {
      return intentClassificationSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.logger.warn(`Intent classification parse failed: ${(err as Error).message}`);
      return this.heuristic(latestUserMessage);
    }
  }

  private heuristic(msg: string): IntentClassification {
    const lower = msg.toLowerCase();
    let intent: Intent = 'chat';
    if (/(bug|issue|broken|error|not working)/.test(lower)) intent = 'support';
    else if (/(proposal|quote|price|cost|how much)/.test(lower)) intent = 'sales_proposal';
    else if (/(build|create|develop|need (a|an) )/.test(lower)) intent = 'lead_capture';
    else if (/(let's start|go ahead|proceed|kick off)/.test(lower)) intent = 'project_kickoff';
    return { intent, confidence: 0.4, reasoning: 'heuristic fallback' };
  }
}
