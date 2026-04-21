#!/usr/bin/env bash
set -e

# Pre-commit: warn if tests/golden/corpus/ contains common sensitive patterns.
# Run manually before committing corpus changes (or wire into husky later).

STAGED=$(git diff --cached --name-only | grep -E 'packages/core/tests/golden/corpus/.*\.(jsonl|json)' || true)
if [ -z "$STAGED" ]; then exit 0; fi

PATTERNS=(
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '\bsk-[A-Za-z0-9_-]{20,}\b'
  '\bghp_[A-Za-z0-9]{20,}\b'
  '\bAKIA[0-9A-Z]{16}\b'
  '/Users/[A-Za-z0-9._-]+'
  '[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+'
)

FLAGGED=0
for FILE in $STAGED; do
  for P in "${PATTERNS[@]}"; do
    if git show :"$FILE" | grep -E "$P" >/dev/null 2>&1; then
      echo "⚠ $FILE matches sensitive pattern: $P"
      FLAGGED=1
    fi
  done
done

if [ "$FLAGGED" = "1" ]; then
  echo ""
  echo "Refusing to commit. Re-run tools/scrub-transcript.mjs and review manually."
  echo "If false positive, use: git commit --no-verify"
  exit 1
fi
