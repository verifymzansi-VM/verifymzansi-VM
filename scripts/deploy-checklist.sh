#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# VerifyMzansi — Deployment Checklist Script
# Walks through every pre-deploy and deploy step with clear pass/fail output.
# Usage:  bash scripts/deploy-checklist.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

pass()  { echo -e "  ${GREEN}✔ PASS${NC}  $1"; }
fail()  { echo -e "  ${RED}✘ FAIL${NC}  $1"; FAILURES=$((FAILURES + 1)); }
warn()  { echo -e "  ${YELLOW}⚠ WARN${NC}  $1"; WARNINGS=$((WARNINGS + 1)); }
info()  { echo -e "  ${CYAN}ℹ${NC}  $1"; }
header(){ echo -e "\n${BOLD}━━━ $1 ━━━${NC}"; }

FAILURES=0
WARNINGS=0

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         VerifyMzansi — Deployment Checklist              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Prerequisites ────────────────────────────────────────────────────────
header "1/8  Prerequisites"

if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  pass "Node.js installed ($NODE_VER)"
else
  fail "Node.js not found — install Node 20+"
fi

if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm -v)
  pass "pnpm installed ($PNPM_VER)"
else
  fail "pnpm not found — install with: npm i -g pnpm"
fi

if pnpm exec wrangler --version &>/dev/null 2>&1; then
  WRANGLER_VER=$(pnpm exec wrangler --version 2>/dev/null | head -1)
  pass "Wrangler available ($WRANGLER_VER)"
else
  fail "Wrangler not available — install with: pnpm add -D wrangler"
fi

# ── 2. Code Quality ─────────────────────────────────────────────────────────
header "2/8  Code Quality"

info "Running preflight checks..."
if pnpm run preflight 2>/dev/null; then
  pass "Preflight checks passed"
else
  fail "Preflight checks failed — run: pnpm run preflight"
fi

info "Running TypeScript type-check..."
if pnpm run typecheck 2>/dev/null; then
  pass "TypeScript — zero errors"
else
  fail "TypeScript errors found — run: pnpm run typecheck"
fi

info "Running ESLint..."
if pnpm run lint 2>/dev/null; then
  pass "ESLint — clean"
else
  fail "ESLint errors — run: pnpm run lint"
fi

# ── 3. Tests ─────────────────────────────────────────────────────────────────
header "3/8  Tests"

info "Running unit tests..."
if pnpm run test 2>/dev/null; then
  pass "Unit tests passed"
else
  fail "Unit tests failed — run: pnpm run test"
fi

info "Running contract tests..."
if pnpm run test:contract 2>/dev/null; then
  pass "Contract tests passed"
else
  fail "Contract tests failed — run: pnpm run test:contract"
fi

# ── 4. Environment Variables ─────────────────────────────────────────────────
header "4/8  Environment Variables (Production)"

echo ""
info "Checking that required env vars are documented..."
info "You must set these in Cloudflare Pages dashboard before deploying."
echo ""

REQUIRED_VARS=(
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "R2_ACCOUNT_ID"
  "R2_ACCESS_KEY_ID"
  "R2_SECRET_ACCESS_KEY"
  "R2_PUBLIC_BUCKET"
  "R2_PRIVATE_BUCKET"
  "R2_PUBLIC_URL"
  "KYC_ENCRYPTION_KEY"
  "ID_ENCRYPTION_KEY"
  "HMAC_SECRET"
  "AFRICASTALKING_API_KEY"
  "AFRICASTALKING_USERNAME"
  "AFRICASTALKING_SENDER_ID"
  "PAYFAST_MERCHANT_ID"
  "PAYFAST_MERCHANT_KEY"
  "PAYFAST_PASSPHRASE"
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
  "TURNSTILE_SECRET_KEY"
  "RESEND_API_KEY"
  "NEXT_PUBLIC_APP_URL"
)

PROD_CHECKS=(
  "PAYFAST_SANDBOX|must be 'false' in production"
  "NODE_ENV|must be 'production'"
)

DEV_ONLY_VARS=(
  "ENABLE_DEV_PAYMENT_BYPASS"
  "ENABLE_MOCK_PAYFAST"
  "DEV_EXPOSE_OTP"
)

for var in "${REQUIRED_VARS[@]}"; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    pass "$var is set"
  else
    warn "$var — not set locally (ensure it's in Cloudflare Pages dashboard)"
  fi
done

echo ""
info "Production-critical checks:"

PAYFAST_SANDBOX="${PAYFAST_SANDBOX:-}"
if [ "$PAYFAST_SANDBOX" = "false" ]; then
  pass "PAYFAST_SANDBOX=false (production mode)"
elif [ -n "$PAYFAST_SANDBOX" ]; then
  warn "PAYFAST_SANDBOX=$PAYFAST_SANDBOX — must be 'false' in production"
else
  warn "PAYFAST_SANDBOX not set locally — ensure it's 'false' in Cloudflare"
fi

NODE_ENV="${NODE_ENV:-}"
if [ "$NODE_ENV" = "production" ]; then
  pass "NODE_ENV=production"
else
  info "NODE_ENV=$NODE_ENV locally (Cloudflare deploy sets this to production)"
fi

echo ""
info "Dev-only bypass checks (must NOT be set in production):"

for var in "${DEV_ONLY_VARS[@]}"; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    fail "$var is set — REMOVE before deploying to production"
  else
    pass "$var is not set"
  fi
done

# ── 5. Cloudflare R2 Buckets ────────────────────────────────────────────────
header "5/8  Cloudflare R2 Buckets"

if grep -q '^# \[\[r2_buckets\]\]' wrangler.toml 2>/dev/null; then
  warn "R2 bucket bindings are still commented out in wrangler.toml"
  info "Steps to fix:"
  info "  1. Create buckets in Cloudflare dashboard: verifymzansi-public, verifymzansi-private"
  info "  2. Uncomment lines 26-32 in wrangler.toml"
else
  pass "R2 bucket bindings are active in wrangler.toml"
fi

# ── 5b. Wrangler Secrets ─────────────────────────────────────────────────────
header "5b/8  Wrangler Encrypted Secrets"

info "Checking wrangler secret list for the main worker..."
info "(These must be set via 'pnpm wrangler secret put <NAME>', NOT as [vars])"
echo ""

REQUIRED_SECRETS=(
  "SUPABASE_SERVICE_ROLE_KEY"
  "RESEND_API_KEY"
  "AFRICASTALKING_API_KEY"
  "AFRICASTALKING_USERNAME"
  "PAYFAST_MERCHANT_ID"
  "PAYFAST_MERCHANT_KEY"
  "PAYFAST_PASSPHRASE"
  "TURNSTILE_SECRET_KEY"
  "KYC_ENCRYPTION_KEY"
  "ID_ENCRYPTION_KEY"
  "HMAC_SECRET"
  "R2_ACCOUNT_ID"
  "R2_ACCESS_KEY_ID"
  "R2_SECRET_ACCESS_KEY"
)

SECRET_LIST=$(pnpm wrangler secret list 2>/dev/null || echo "")

if [ -n "$SECRET_LIST" ]; then
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if echo "$SECRET_LIST" | grep -q "$secret"; then
      pass "$secret — bound as encrypted secret"
    else
      fail "$secret — NOT found in wrangler secrets. Run: pnpm wrangler secret put $secret"
    fi
  done
else
  warn "Could not retrieve wrangler secret list (not logged in, or no secrets set)"
  info "After deploying, run: pnpm wrangler secret list"
  info "Required secrets:"
  for secret in "${REQUIRED_SECRETS[@]}"; do
    info "  pnpm wrangler secret put $secret"
  done
fi

# ── 6. Build ─────────────────────────────────────────────────────────────────
header "6/8  Build"

info "Building for Cloudflare..."
info "Note: The Cloudflare Pages build command should be 'pnpm run build:cloudflare'"
info "       (NOT 'pnpm run build && npx opennextjs-cloudflare build' which double-builds)"
if pnpm run build:cloudflare; then
  pass "Cloudflare build succeeded"
else
  fail "Build failed — check output above"
fi

# ── 7. Deploy ────────────────────────────────────────────────────────────────
header "7/8  Deploy"

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo -e "  ${RED}Skipping deployment — $FAILURES failure(s) found above.${NC}"
  echo "  Fix the issues and re-run this script."
  echo ""
else
  echo ""
  read -rp "  All checks passed. Deploy to Cloudflare now? (y/N) " DEPLOY
  echo ""

  if [[ "$DEPLOY" =~ ^[Yy]$ ]]; then
    info "Deploying main app..."
    if pnpm exec opennextjs-cloudflare deploy; then
      pass "Main app deployed"
    else
      fail "Main app deployment failed"
    fi

    info "Deploying Rate Limiter worker..."
    if pnpm exec wrangler deploy --config wrangler.rate-limiter.toml; then
      pass "Rate Limiter worker deployed"
    else
      fail "Rate Limiter worker deployment failed"
    fi

    info "Deploying KYC Encryptor worker..."
    if pnpm exec wrangler deploy --config wrangler.kyc-encryptor.toml; then
      pass "KYC Encryptor worker deployed"
    else
      warn "KYC Encryptor worker failed (non-critical)"
    fi

    info "Deploying Retention Cleanup worker..."
    if pnpm exec wrangler deploy --config wrangler.retention-cleanup.toml; then
      pass "Retention Cleanup worker deployed"
    else
      warn "Retention Cleanup worker failed (non-critical)"
    fi
  else
    info "Deployment skipped."
  fi
fi

# ── 8. Post-Deploy Health Check ─────────────────────────────────────────────
header "8/8  Post-Deploy Health Check"

APP_URL="${NEXT_PUBLIC_APP_URL:-}"

if [ -z "$APP_URL" ] || [ "$APP_URL" = "http://localhost:3000" ]; then
  warn "NEXT_PUBLIC_APP_URL is not set to a production URL — skipping health check"
  info "After deploying, verify manually:"
  info "  curl -s https://your-domain.co.za/api/health | jq ."
else
  info "Waiting 15s for deployment to propagate..."
  sleep 15

  info "Hitting $APP_URL/api/health ..."
  HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$APP_URL/api/health" 2>/dev/null || echo "000")

  if [ "$HTTP_STATUS" = "200" ]; then
    pass "Health check returned 200 OK"
  else
    fail "Health check returned HTTP $HTTP_STATUS"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ Summary ━━━${NC}"
echo ""

if [ "$FAILURES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed. You're live! 🚀${NC}"
elif [ "$FAILURES" -eq 0 ]; then
  echo -e "  ${YELLOW}$WARNINGS warning(s) — review above. No blockers.${NC}"
else
  echo -e "  ${RED}$FAILURES failure(s), $WARNINGS warning(s) — fix before deploying.${NC}"
fi

echo ""
echo "  Post-deploy manual verification:"
echo "    1. Open homepage in browser — loads without errors"
echo "    2. Register a new account — email confirmation sent"
echo "    3. Log in → redirected to dashboard"
echo "    4. Start KYC verification → OTP SMS arrives"
echo "    5. Upload a listing photo → appears correctly"
echo "    6. Test PayFast checkout → redirects to PayFast"
echo "    7. Check admin panel with admin account"
echo ""

exit "$FAILURES"
