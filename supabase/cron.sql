# Supabase Cron — PetCare 共用專案（AI 個人新聞台）
#
# 前置：
# 1. Dashboard → Database → Extensions：啟用 pg_cron、pg_net
# 2. supabase functions deploy generate-daily-radio
# 3. supabase secrets set OPENAI_API_KEY=... CRON_SECRET=...
# 4. 將下方 YOUR_CRON_SECRET 換成與 CRON_SECRET secret 相同值
# 5. 在 SQL Editor 執行本檔

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 取消舊排程（若存在）
do $$
declare
  job record;
begin
  for job in select jobid from cron.job where jobname = 'news-generate-daily-radio-15m'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

-- 每 15 分鐘呼叫 generate-daily-radio（PetCare 專案）
-- 注意：請將 YOUR_CRON_SECRET 替換為 Supabase secrets 中的 CRON_SECRET
select cron.schedule(
  'news-generate-daily-radio-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tldekbnftaadswxhhznl.supabase.co/functions/v1/generate-daily-radio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('triggered_at', now(), 'app', 'ai-news-station')
  ) as request_id;
  $$
);

-- 若 current_setting('app.settings.service_role_key') 不可用，
-- 請改在 Dashboard → Integrations → Cron 建立 HTTP POST，
-- URL 與 Authorization Bearer（service_role）手動填入。
