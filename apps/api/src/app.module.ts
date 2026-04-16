import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentsModule } from './agents/agents.module';
import { ChatModule } from './chat/chat.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { LlmModule } from './llm/llm.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { QueueModule } from './queue/queue.module';
import { RepositoryModule } from './repository/repository.module';
import { RevenueModule } from './revenue/revenue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RepositoryModule,
    LlmModule,
    EventsModule,
    QueueModule,
    AgentsModule,
    OrchestratorModule,
    ChatModule,
    DashboardModule,
    RevenueModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
