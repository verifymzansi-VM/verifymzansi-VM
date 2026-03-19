#!/usr/bin/env bash
# scripts/deploy.sh — Deploy VerifyMzansi to Cloudflare (Linux / WSL / macOS)
# Usage:  bash scripts/deploy.sh [staging|production]
#
# Prerequisites:
#   - Node.js 22 LTS installed
#   - pnpm installed (corepack enable)
#   - wrangler authenticated (npx wrangler login)
#   - .env.local populated with all required env vars

set -euo pipefail

ENVIRONMENT="${1:-production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "============================================"
echo " VerifyMzansi Deploy — $ENVIRONMENT"
echo "============================================"
echo ""

# ── Step 1: Validate Node version ───────────────────────────
REQUIRED_NODE_MAJOR=22
CURRENT_NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [[ "$CURRENT_NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  echo "❌ Node.js $REQUIRED_NODE_MAJOR+ required (found $CURRENT_NODE_MAJOR)"
  echo "   Install with: nvm install 22 && nvm use 22"
  exit 1
fi
echo "✅ Node.js v$(node -v | tr -d 'v')"

# ── Step 2: Install dependencies ────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile
echo "✅ Dependencies installed"

# ── Step 3: Run preflight checks ────────────────────────────
echo ""
echo "🔍 Running preflight checks..."
pnpm preflight || {
  echo "❌ Preflight checks failed. Fix issues before deploying."
  exit 1
}
echo "✅ Preflight passed"

# ── Step 4: Lint ─────────────────────────────────────────────
echo ""
echo "🧹 Linting..."
pnpm lint || {
  echo "⚠️  Lint warnings found (non-blocking)"
}

# ── Step 5: Type check ──────────────────────────────────────
echo ""
echo "📐 Type checking..."
pnpm typecheck || {
  echo "❌ Type errors found. Fix before deploying."
  exit 1
}
echo "✅ Types OK"

# ── Step 6: Run tests ───────────────────────────────────────
echo ""
echo "🧪 Running tests..."
pnpm test || {
  echo "❌ Tests failed. Fix before deploying."
  exit 1
}
echo "✅ Tests passed"

# ── Step 7: Build ────────────────────────────────────────────
echo ""
echo "🏗️  Building for Cloudflare Pages..."
pnpm build:cloudflare || {
  echo "❌ Build failed."
  exit 1
}
echo "✅ Build succeeded"

# ── Step 8: Deploy ───────────────────────────────────────────
echo ""
echo "🚀 Deploying to Cloudflare Pages ($ENVIRONMENT)..."
pnpm deploy || {
  echo "❌ Deploy failed."
  exit 1
}
echo "✅ Pages deployed"

# ── Step 9: Deploy Workers ───────────────────────────────────
echo ""
echo "⚙️  Deploying Cloudflare Workers..."

for config in wrangler.kyc-encryptor.toml wrangler.rate-limiter.toml wrangler.retention-cleanup.toml; do
  if [[ -f "$config" ]]; then
    if [[ "$config" == "wrangler.kyc-encryptor.toml" ]]; then
      # NOTE: kyc-encryptor deployment is for legacy compatibility only.
      # The canonical encryption path is now inline in the upload route.
      # This worker can be removed once all v1/worker-encrypted files have
      # been decrypted or purged by the retention-cleanup cron.
      echo "  ⚠️  kyc-encryptor is deprecated — deploying for legacy compatibility"
    fi
    echo "  → Deploying $(basename "$config" .toml)..."
    pnpm exec wrangler deploy --config "$config" || {
      echo "  ⚠️  Worker deploy failed for $config (non-blocking)"
    }
  fi
done
echo "✅ Workers deployed"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo "============================================"
echo " ✅ Deploy complete!"
echo ""
echo " Environment: $ENVIRONMENT"
echo " Domain:      https://verifymzansi.com"
echo "============================================"
