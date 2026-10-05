import { z } from 'zod';

const message = z
  .object({
    role: z.string().min(1),
    content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]).optional(),
  })
  .passthrough();

/**
 * Validates only what the gateway relies on. Other fields pass through to the
 * provider untouched so new OpenAI parameters keep working.
 */
export const chatCompletionRequest = z
  .object({
    model: z.string().min(1),
    messages: z.array(message).min(1),
    stream: z.boolean().optional(),
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequest>;
