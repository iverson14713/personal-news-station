#!/usr/bin/env bash
# 將 AI 新聞台後端部署到 PetCare 共用 Supabase（tldekbnftaadswxhhznl）
# 前置：supabase login
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_REF="tldekbnftaadswxhhznl"
SUPABASE_CMD="${SUPABASE_CMD:-npx supabase}"

if ! $SUPABASE_CMD projects list >/dev/null 2>&1; then
  echo "請先執行：supabase login"
  echo "或設定環境變數 SUPABASE_ACCESS_TOKEN"
  exit 1
fi

echo "==> Link $PROJECT_REF"
$SUPABASE_CMD link --project-ref "$PROJECT_REF"

echo "==> Push migrations"
$SUPABASE_CMD db push

OPENAI_KEY=""
if [[ -f .env ]]; then
  OPENAI_KEY="$(grep -E '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [[ -z "$OPENAI_KEY" ]]; then
  echo "請在 .env 設定 OPENAI_API_KEY，或手動："
  echo "  supabase secrets set OPENAI_API_KEY=sk-..."
  exit 1
fi

if [[ -f .env.local ]] && grep -q '^CRON_SECRET=' .env.local 2>/dev/null; then
  CRON_SECRET="$(grep '^CRON_SECRET=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  echo "==> 沿用 .env.local 的 CRON_SECRET"
else
  CRON_SECRET="$(openssl rand -hex 24)"
  echo "CRON_SECRET=$CRON_SECRET" >> .env.local
  echo "==> 已寫入 CRON_SECRET 至 .env.local"
fi

echo "==> Set Edge Function secrets"
$SUPABASE_CMD secrets set \
  OPENAI_API_KEY="$OPENAI_KEY" \
  CRON_SECRET="$CRON_SECRET"

echo "==> Deploy generate-daily-radio"
$SUPABASE_CMD functions deploy generate-daily-radio --no-verify-jwt

CRON_OUT="$ROOT/supabase/cron.generated.sql"
sed "s/YOUR_CRON_SECRET/$CRON_SECRET/g" "$ROOT/supabase/cron.sql" > "$CRON_OUT"
echo "==> 已產生 $CRON_OUT"
echo "    請在 PetCare Supabase SQL Editor 執行此檔"

echo ""
echo "==> 手動步驟（Dashboard）"
echo "  1. Authentication → Providers → Anonymous Sign-In：啟用"
echo "  2. Database → Extensions：確認 pg_cron、pg_net 已啟用"
echo "  3. 執行 supabase/cron.generated.sql"
echo ""
echo "==> 驗證"
echo "  npm run test:supabase-daily-radio"
