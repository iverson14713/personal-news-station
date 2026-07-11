-- 推播 claim 與成功分離：push_sent_at 僅代表 APNs 明確成功

alter table public.news_daily_radio_scripts
  add column if not exists push_claimed_at timestamptz,
  add column if not exists push_last_error text,
  add column if not exists push_last_attempt_at timestamptz;

comment on column public.news_daily_radio_scripts.push_claimed_at is
  '推播處理權 claim 時間；非推播成功。crash 後靠 TTL 過期可重新 claim。';
comment on column public.news_daily_radio_scripts.push_last_error is
  '最近一次 APNs 推播失敗摘要（不含 secret/token）';
comment on column public.news_daily_radio_scripts.push_last_attempt_at is
  '最近一次嘗試推播（claim 或 APNs 呼叫）時間';
