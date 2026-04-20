import type { ValidatedRefinerOutput } from './schema.js';

export function validateSemantic(
  output: ValidatedRefinerOutput,
  existingSlugs: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const outputSlugs = new Set<string>();

  for (const c of output.concepts) {
    if (outputSlugs.has(c.slug)) {
      issues.push(`duplicate slug '${c.slug}' in output`);
    }
    outputSlugs.add(c.slug);
  }

  const knownSlugs = new Set<string>([...existingSlugs, ...outputSlugs]);

  for (const c of output.concepts) {
    for (const dep of c.depends_on) {
      if (!knownSlugs.has(dep)) {
        issues.push(`concept '${c.slug}' depends_on '${dep}' which is neither an existing project concept nor in this response`);
      }
    }
  }

  for (const u of output.unknowns) {
    if (u.slug_ref !== null && !knownSlugs.has(u.slug_ref)) {
      issues.push(`unknown.slug_ref '${u.slug_ref}' does not match any concept in this response or the existing project`);
    }
  }

  return issues;
}
