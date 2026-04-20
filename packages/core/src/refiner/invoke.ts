import { execa, type Options as ExecaOptions } from 'execa';

export class ClaudeInvokeError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
    public readonly timedOut: boolean,
  ) {
    super(message);
    this.name = 'ClaudeInvokeError';
  }
}

export interface InvokeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Runner = (bin: string, args: string[], opts: ExecaOptions) => Promise<InvokeResult>;

const defaultRunner: Runner = async (bin, args, opts) => {
  const res = await execa(bin, args, opts);
  return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode ?? 0 };
};

export interface InvokeClaudeArgs {
  systemPrompt: string;
  userInput: string;
  claudeBin: string;
  timeoutMs: number;
  runner?: Runner;
}

export async function invokeClaude(args: InvokeClaudeArgs): Promise<string> {
  const run = args.runner ?? defaultRunner;
  const combined = `${args.systemPrompt}\n\n---\n\n${args.userInput}`;

  try {
    const res = await run(args.claudeBin, ['-p', '--output-format', 'text'], {
      input: combined,
      timeout: args.timeoutMs,
    });
    if (res.exitCode !== 0) {
      throw new ClaudeInvokeError(
        `ClaudeInvokeError: claude exited with ${res.exitCode}`,
        res.stderr,
        res.exitCode,
        false,
      );
    }
    return res.stdout;
  } catch (err) {
    if (err instanceof ClaudeInvokeError) throw err;
    const anyErr = err as { timedOut?: boolean; message?: string; stderr?: string; exitCode?: number };
    throw new ClaudeInvokeError(
      `ClaudeInvokeError: ${anyErr.message ?? 'unknown'}`,
      anyErr.stderr ?? '',
      anyErr.exitCode ?? null,
      Boolean(anyErr.timedOut),
    );
  }
}
