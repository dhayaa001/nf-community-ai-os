import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { ChatController } from './chat.controller';

@Module({
  imports: [OrchestratorModule],
  controllers: [ChatController],
})
export class ChatModule {}
