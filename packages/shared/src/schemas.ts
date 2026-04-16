import { z } from 'zod';

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export const intentClassificationSchema = z.object({
  intent: z.enum(['chat', 'lead_capture', 'sales_proposal', 'project_kickoff', 'build_request', 'support']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export type IntentClassification = z.infer<typeof intentClassificationSchema>;

export const leadExtractionSchema = z.object({
  service: z.string().nullable(),
  budget: z.string().nullable(),
  deadline: z.string().nullable(),
  contact: z.string().nullable(),
  notes: z.string().nullable(),
});

export type LeadExtraction = z.infer<typeof leadExtractionSchema>;
