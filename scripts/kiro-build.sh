#!/bin/sh
set -eu

for file in .suiperpower/intent.md .suiperpower/build-plan.md .suiperpower/build-context.md; do
  [ -f "$file" ] || { echo "Missing $file" >&2; exit 1; }
done

slice=${1:-"Implement the next approved build-plan slice. Start with safe direct-URL evidence retrieval and extraction; do not add a search provider without an available API key."}

exec kiro-cli chat --agent bukti-builder --no-interactive \
  --trust-tools=fs_read,fs_write,shell \
  "You are working in the Bukti repository. Approved context is in .suiperpower/intent.md, .suiperpower/build-plan.md, and .suiperpower/build-context.md. Codex skill guidance is installed at /Users/haziqrohaizan/.codex/skills/clarify-intent/SKILL.md, /Users/haziqrohaizan/.codex/skills/plan-before-code/SKILL.md, and /Users/haziqrohaizan/.codex/skills/verify-against-intent/SKILL.md. $slice"
