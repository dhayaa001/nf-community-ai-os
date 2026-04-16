import { Controller, Get } from '@nestjs/common';
import { RepositoryService } from '../repository/repository.service';
import { LlmService } from '../llm/llm.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly repo: RepositoryService,
    private readonly llm: LlmService,
  ) {}

  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      repository: this.repo.kind,
      llm: this.llm.providerName,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
