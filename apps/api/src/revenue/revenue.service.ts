import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CheckoutSessionInput {
  leadId: string;
  amountUsd: number;
  description: string;
}

export interface CheckoutSessionOutput {
  url: string;
  provider: 'stripe' | 'stub';
}

/**
 * Phase 5 — Stripe integration.
 *
 * For Phase 1 we expose the contract and stub the behavior so the frontend
 * can wire checkout buttons now without a Stripe account. Swap the stub body
 * with the Stripe SDK call in Phase 5.
 */
@Injectable()
export class RevenueService {
  private readonly logger = new Logger(RevenueService.name);
  private readonly stripeSecret?: string;

  constructor(config: ConfigService) {
    this.stripeSecret = config.get<string>('STRIPE_SECRET_KEY') || undefined;
    this.logger.log(`Revenue provider: ${this.stripeSecret ? 'stripe' : 'stub'}`);
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionOutput> {
    if (!this.stripeSecret) {
      // Stub: return a dummy URL so the UI flow is testable end-to-end.
      const url = `https://checkout.example.com/stub/${input.leadId}?amount=${input.amountUsd}`;
      return { url, provider: 'stub' };
    }
    // Phase 5: replace with `new Stripe(this.stripeSecret).checkout.sessions.create(...)`
    throw new Error('Stripe provider not yet implemented — scheduled for Phase 5');
  }
}
