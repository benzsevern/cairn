import { RefinerOutputSchema, type ValidatedRefinerOutput } from './schema.js';
import { parseRefinerResponse, RefinerParseError } from './parser.js';
import { validateSemantic } from './validator.js';

export type InvokeFn = (args: { systemPrompt: string; userInput: string }) => Promise<string>;

export interface AttemptRecord {
  attempt: number;
  kind: 'parse' | 'schema' | 'semantic' | 'success';
  detail?: string;
}

export class RefinerFailure extends Error {
  constructor(
    public readonly attempts: AttemptRecord[],
    public readonly lastRaw: string,
  ) {
    super(`RefinerFailure: exhausted ${attempts.length} attempts. Last failure: ${attempts[attempts.length - 1]?.detail ?? 'unknown'}`);
    this.name = 'RefinerFailure';
  }
}

export interface RefineWithRetryArgs {
  systemPrompt: string;
  userInput: string;
  existingSlugs: ReadonlySet<string>;
  maxAttempts: number;
  invoke: InvokeFn;
}

function critiqueFor(kind: 'parse' | 'schema' | 'semantic', detail: string): string {
  if (kind === 'parse') {
    return `\n\n---\n\nYour previous response failed to parse as JSON: ${detail}\nRespond with ONLY a valid JSON object matching the schema. No prose, no code fences.`;
  }
  if (kind === 'schema') {
    return `\n\n---\n\nYour previous response did not match the required schema: ${detail}\nRe-read the schema carefully and produce ONLY a JSON object that validates against it.`;
  }
  return `\n\n---\n\nYour previous response had a semantic problem: ${detail}\nFix only the listed issues and respond with ONLY the corrected JSON object.`;
}

export async function refineWithRetry(args: RefineWithRetryArgs): Promise<ValidatedRefinerOutput> {
  const attempts: AttemptRecord[] = [];
  let currentInput = args.userInput;
  let lastRaw = '';

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    const raw = await args.invoke({ systemPrompt: args.systemPrompt, userInput: currentInput });
    lastRaw = raw;

    let parsed: unknown;
    try {
      parsed = parseRefinerResponse(raw);
    } catch (err) {
      const detail = err instanceof RefinerParseError ? err.message : String(err);
      attempts.push({ attempt, kind: 'parse', detail });
      currentInput = args.userInput + critiqueFor('parse', detail);
      continue;
    }

    const schemaCheck = RefinerOutputSchema.safeParse(parsed);
    if (!schemaCheck.success) {
      const detail = schemaCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      attempts.push({ attempt, kind: 'schema', detail });
      currentInput = args.userInput + critiqueFor('schema', detail);
      continue;
    }

    const issues = validateSemantic(schemaCheck.data, args.existingSlugs);
    if (issues.length > 0) {
      const detail = issues.join('; ');
      attempts.push({ attempt, kind: 'semantic', detail });
      currentInput = args.userInput + critiqueFor('semantic', detail);
      continue;
    }

    attempts.push({ attempt, kind: 'success' });
    return schemaCheck.data;
  }

  throw new RefinerFailure(attempts, lastRaw);
}
