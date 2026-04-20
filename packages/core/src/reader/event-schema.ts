import { z } from 'zod';

/** A text content block in an assistant message. */
const TextBlock = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/** A tool_use content block in an assistant message. */
const ToolUseBlock = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

/** A tool_result content block (appears inside a "user" message in the transcript). */
const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]),
  is_error: z.boolean().optional(),
});

const UserMessage = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(ToolResultBlock)]),
});

const AssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.array(z.union([TextBlock, ToolUseBlock])),
});

export const UserEventSchema = z.object({
  type: z.literal('user'),
  timestamp: z.string().optional(),
  message: UserMessage,
});

export const AssistantEventSchema = z.object({
  type: z.literal('assistant'),
  timestamp: z.string().optional(),
  message: AssistantMessage,
});

export const SystemEventSchema = z.object({
  type: z.literal('system'),
  timestamp: z.string().optional(),
  subtype: z.string().optional(),
  content: z.string().optional(),
});

export const TranscriptLineSchema = z.union([UserEventSchema, AssistantEventSchema, SystemEventSchema]);
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;
