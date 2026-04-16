import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { chatRequestSchema } from '@nf/shared';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { RepositoryService } from '../repository/repository.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly repo: RepositoryService,
  ) {}

  /**
   * Submit a user message. The request returns as soon as the task is
   * enqueued. Assistant replies arrive via WebSocket (`message:appended`).
   */
  @Post('messages')
  async submit(@Body() body: unknown) {
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { conversation, userMessage, task } = await this.orchestrator.submitUserMessage(
      parsed.data,
    );
    return {
      conversationId: conversation.id,
      userMessage,
      task,
    };
  }

  @Get('conversations')
  async listConversations() {
    return this.repo.db.listConversations();
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id') id: string) {
    return this.repo.db.listMessages(id);
  }
}
