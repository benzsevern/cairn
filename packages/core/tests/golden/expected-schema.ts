import { z } from 'zod';

export const TAGS = [
  'algorithmic-choice', 'refactor', 'bug-fix', 'multi-turn-pivot',
  'terse-user', 'no-concepts-expected', 'slug-reuse',
  'conflicting-decisions', 'implicit-reasoning', 'abandoned-path',
  'tool-heavy', 'pure-narrative', 'mined', 'synthetic',
  'long-session', 'multiple-concepts', 'debugging', 'empty-transcript',
] as const;

export const ExpectedSchema = z.object({
  required_slugs: z.array(z.string()).default([]),
  slug_aliases: z.record(z.string(), z.array(z.string())).default({}),
  slug_reuse_context: z.array(z.string()).default([]),
  required_reasoning_substrings: z.record(z.string(), z.array(z.string())).default({}),
  forbidden_slugs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  notes: z.string().optional(),
});
export type Expected = z.infer<typeof ExpectedSchema>;
