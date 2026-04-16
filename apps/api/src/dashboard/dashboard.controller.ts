import { Controller, Get } from '@nestjs/common';
import { RepositoryService } from '../repository/repository.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly repo: RepositoryService) {}

  @Get('agents')
  async agents() {
    return this.repo.db.listAgents();
  }

  @Get('tasks')
  async tasks() {
    return this.repo.db.listTasks(50);
  }

  @Get('leads')
  async leads() {
    return this.repo.db.listLeads(50);
  }

  @Get('summary')
  async summary() {
    const [agents, tasks, leads, conversations] = await Promise.all([
      this.repo.db.listAgents(),
      this.repo.db.listTasks(200),
      this.repo.db.listLeads(200),
      this.repo.db.listConversations(200),
    ]);
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const totalRevenue = agents.reduce((acc, a) => acc + a.revenueGenerated, 0);
    return {
      counts: {
        conversations: conversations.length,
        leads: leads.length,
        tasks: tasks.length,
        tasksCompleted: completed,
        tasksFailed: failed,
      },
      agents,
      revenueTotal: totalRevenue,
    };
  }
}
