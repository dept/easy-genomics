#!/usr/bin/env bash
# Install Graphify CLI, Cursor rules, git hooks, and merge driver for this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
}

ensure_graphify() {
  export PATH="${HOME}/.local/bin:${PATH}"
  if command -v graphify >/dev/null 2>&1; then
    return
  fi
  ensure_uv
  uv tool install graphifyy
}

ensure_graphify

echo "Installing project-scoped Cursor rules..."
graphify install --project --platform cursor

echo "Installing post-commit / post-checkout hooks (via Husky)..."
graphify hook install

echo "Configuring git merge driver for graphify-out/graph.json..."
git config merge.graphify.name "Graphify graph.json union merge"
git config merge.graphify.driver "graphify merge-driver %O %A %B"

echo ""
echo "Graphify setup complete."
echo "  - Build / refresh code graph:  pnpm graphify:build"
echo "  - Include docs (needs API key): pnpm graphify:docs"
echo "  - Query: graphify query \"<question>\""
echo "  - Cursor: restart IDE to load .cursor/mcp.json (graphify MCP server)"
echo "  - Context: read CLAUDE.md and .cursor/rules/ for domain conventions"
