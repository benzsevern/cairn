import { z } from 'zod';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ConceptNodeSchema = z.object({
  slug: z.string().min(1).regex(SLUG_PATTERN, 'slug must be kebab-case lowercase'),
  name: z.string().min(1),
  kind: z.enum(['introduced', 'refined', 'referenced']),
  summary: z.string().min(1).max(400),
  reasoning: z.array(z.string().min(1)).max(20),
  depends_on: z.array(z.string().regex(SLUG_PATTERN)).max(20),
  files: z.array(z.string()).max(50),
  transcript_refs: z.array(z.number().int().nonnegative()).max(100),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
});

export const UnknownSchema = z.object({
  slug_ref: z.string().regex(SLUG_PATTERN).nullable(),
  question: z.string().min(1),
  recovery_prompt: z.string().min(1),
});

export const RefinerOutputSchema = z.object({
  concepts: z.array(ConceptNodeSchema),
  unknowns: z.array(UnknownSchema),
});

export type ValidatedRefinerOutput = z.infer<typeof RefinerOutputSchema>;
