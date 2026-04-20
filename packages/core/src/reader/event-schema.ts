import { z } from 'zod';

/**
 * Content blocks inside a message are typed by a string `type` discriminator.
 * Real Claude Code transcripts carry many kinds: text, tool_use, tool_result,
 * thinking, redacted_thinking, image, etc. We only extract useful info from
 * text / tool_use / tool_result; everything else is tolerated and skipped by
 * the reader's expand functions. So the schema accepts any object with a
 * string `type` field — the reader narrows to the kinds it handles.
 */
const ContentBlock = z.object({ type: z.string() }).passthrough();

const UserMessage = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(ContentBlock)]),
});

const AssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.union([z.string(), z.array(ContentBlock)]),
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
