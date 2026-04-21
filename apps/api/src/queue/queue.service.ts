import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Processor } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

/**
 * Queue abstraction used by the orchestrator.
 *
 * - When REDIS_URL is set: BullMQ-backed durable queue (Phase 2 target)
 * - Otherwise: in-process setImmediate executor so the MVP works out of the box
 *
 * The interface is intentionally minimal. Swap the internal engine without
 * touching callers.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queueName = 'nf-orchestrator';
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  private inMemoryHandler?: Processor;

  constructor(private readonly config: ConfigService) {}

  get mode(): 'redis' | 'memory' {
    return this.queue ? 'redis' : 'memory';
  }

  /**
   * Register the single handler that processes orchestrator jobs. Called once
   * from the OrchestratorService at bootstrap so we keep the wiring explicit.
   */
  registerHandler(handler: Processor) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (!redisUrl) {
      // Refuse to boot in production without a real queue. The in-memory
      // setImmediate dispatcher has no persistence, no retries, and loses
      // in-flight work on SIGTERM — fine for dev, silently data-losing in
      // prod. Tech-debt A4.
      if (nodeEnv === 'production') {
        throw new Error(
          'REDIS_URL is required when NODE_ENV=production. ' +
            'The in-memory queue has no durability and will lose in-flight tasks on restart. ' +
            'Set REDIS_URL to a real Redis instance (Upstash, ElastiCache, Railway Redis, etc.) ' +
            'or unset NODE_ENV to use the dev-only in-memory dispatcher.',
        );
      }
      this.inMemoryHandler = handler;
      this.logger.log('Queue mode=memory (REDIS_URL unset)');
      return;
    }

    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(this.queueName, { connection: this.connection });
    this.worker = new Worker(this.queueName, handler, { connection: this.connection });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.id} failed: ${err.message}`),
    );
    this.logger.log('Queue mode=redis');
  }

  async enqueue<T>(name: string, data: T): Promise<void> {
    if (this.queue) {
      await this.queue.add(name, data, { removeOnComplete: 1000, removeOnFail: 1000 });
      return;
    }
    if (!this.inMemoryHandler) {
      throw new Error('QueueService.registerHandler must be called before enqueue');
    }
    // Fire-and-forget in the next tick so the HTTP response returns immediately.
    const handler = this.inMemoryHandler;
    setImmediate(() => {
      const job = { id: `local-${Date.now()}`, name, data } as Parameters<Processor>[0];
      Promise.resolve(handler(job)).catch((err) =>
        this.logger.error(`Local job failed: ${(err as Error).message}`),
      );
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
