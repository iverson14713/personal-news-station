# Supabase Daily Radio（共用 PetCare 專案 `tldekbnftaadswxhhznl`）

## 資料表（news_ 前綴）

| 表 | 說明 |
|----|------|
| `news_user_preferences` | 追蹤主題、排程、push_token、push_platform |
| `news_daily_radio_scripts` | 每日早報稿件 |

## 1. 一鍵部署（需先 `supabase login`）

```bash
cd personal-news-station
npm run setup:petcare-supabase
```

會依序：link → `db push` → 設定 secrets → deploy function → 產生 `supabase/cron.generated.sql`。

## 2. Dashboard 手動

- **Authentication → Providers → Anonymous Sign-In**：啟用（目前 PetCare 專案為關閉，App 匿名登入需要）
- **Database → Extensions**：啟用 `pg_cron`、`pg_net`
- **SQL Editor**：執行 `supabase/cron.generated.sql`（含正確 `CRON_SECRET`）

## 3. 分步（可選）

```bash
supabase link --project-ref tldekbnftaadswxhhznl
supabase db push
supabase secrets set OPENAI_API_KEY=sk-... CRON_SECRET=$(openssl rand -hex 24)
supabase functions deploy generate-daily-radio
```

編輯 `supabase/cron.sql` 的 `YOUR_CRON_SECRET` 後，在 SQL Editor 執行。

## 6. 前端

`.env.local`：

```
VITE_SUPABASE_URL=https://tldekbnftaadswxhhznl.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

## 7. 測試

```bash
npm run test:supabase-daily-radio
```

### Edge Function 測試模式

**方式 A — curl（需 CRON_SECRET）**

```bash
curl -X POST "https://tldekbnftaadswxhhznl.supabase.co/functions/v1/generate-daily-radio" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{
    "force": true,
    "target_user_id": "7cac4894-...."
  }'
```

**方式 B — App 內部管理面板**

設定 → 連點版本號開啟「內部管理」→ **立即生成今日 Server 稿 + MP3**

（使用登入 JWT + `force` + `target_user_id`，無需 CRON_SECRET）

**方式 C — 程式碼**

```typescript
import { triggerServerDailyRadioGeneration } from "./dailyRadioApi";
await triggerServerDailyRadioGeneration({ radioSlot: "evening" });
```

| 參數 | 說明 |
|------|------|
| `force` | 跳過 07:00 時間窗；若今日無 server completed 3 分鐘稿則生成 |
| `send_test_push` | 生成完成後發送 `daily_radio_completed` 推播；若已有 server completed 稿則直接發測試推播（不重新生成） |

回傳 status 可能值：
- `completed` — 新生成 server 稿件
- `test_push_sent_existing_script` — 沿用既有 server 稿件並發測試推播（含 `script_id`）
- `no_push_token` — 無 push_token，無法發推播（含 `script_id`）
- `skipped` / `failed` — 其他情況
| `target_user_id` | 可選，只處理指定 user |
