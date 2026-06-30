#!/usr/bin/env bash
# Build or refresh the code-only knowledge graph (no LLM API key required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify not found. Run: pnpm graphify:setup" >&2
  exit 1
fi

echo "[graphify] Building code graph from .graphifyignore corpus..."
graphify .
graphify cluster-only .

echo "[graphify] Done. Commit graphify-out/ to share with the team."
