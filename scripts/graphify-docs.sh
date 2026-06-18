#!/usr/bin/env bash
# Rebuild the graph including docs/ and OpenAPI (requires an LLM API key).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify not found. Run: pnpm graphify:setup" >&2
  exit 1
fi

if [ -z "${GEMINI_API_KEY:-}${GOOGLE_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  echo "No LLM API key found. Set one of: GEMINI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY" >&2
  echo "See docs/development/graphify.md" >&2
  exit 1
fi

WITH_DOCS_IGNORE="${ROOT}/.graphifyignore.with-docs"
if [ ! -f "$WITH_DOCS_IGNORE" ]; then
  echo "Missing ${WITH_DOCS_IGNORE}" >&2
  exit 1
fi

restore_ignore() {
  if [ -f "${ROOT}/.graphifyignore.bak" ]; then
    mv "${ROOT}/.graphifyignore.bak" "${ROOT}/.graphifyignore"
  fi
}
trap restore_ignore EXIT

cp "${ROOT}/.graphifyignore" "${ROOT}/.graphifyignore.bak"
cp "$WITH_DOCS_IGNORE" "${ROOT}/.graphifyignore"

BACKEND="${GRAPHIFY_BACKEND:-}"
BACKEND_ARGS=()
if [ -n "$BACKEND" ]; then
  BACKEND_ARGS=(--backend "$BACKEND")
fi

echo "[graphify] Building code + docs graph (LLM extraction)..."
if [ ${#BACKEND_ARGS[@]} -gt 0 ]; then
  graphify extract . "${BACKEND_ARGS[@]}"
  graphify cluster-only . "${BACKEND_ARGS[@]}"
else
  graphify .
  graphify cluster-only .
fi

echo "[graphify] Done. Review graphify-out/ and commit to share with the team."
