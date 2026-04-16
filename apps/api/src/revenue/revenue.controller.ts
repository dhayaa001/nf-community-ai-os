import { Body, Controller, Post } from '@nestjs/common';
import { RevenueService } from './revenue.service';

@Controller('revenue')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Post('checkout')
  checkout(@Body() body: { leadId: string; amountUsd: number; description: string }) {
    return this.revenue.createCheckoutSession(body);
  }
}
