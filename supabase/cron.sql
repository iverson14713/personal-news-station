# Supabase Cron — Daily Radio Queue Architecture
#
# 前置：
# 1. supabase db push（含 pgmq + news_daily_radio_job_runs）
# 2. supabase functions deploy generate-daily-radio process-daily-radio-jobs --no-verify-jwt
# 3. supabase secrets set DAILY_RADIO_QUEUE_ENABLED=true ...
# 4. 將 YOUR_CRON_SECRET 換成 Vault / secrets 中的 CRON_SECRET
#
# Dispatcher：每 15 分鐘建立缺少的 queue job（不執行 AI/TTS）
# Worker：每 2 分鐘處理 batch（預設 3 筆）

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job record;
begin
  for job in select jobid from cron.job
    where jobname in (
      'news-generate-daily-radio-15m',
      'generate-daily-radio',
      'process-daily-radio-jobs'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

-- Dispatcher（generate-daily-radio）
select cron.schedule(
  'generate-daily-radio',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tldekbnftaadswxhhznl.supabase.co/functions/v1/generate-daily-radio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object(
      'triggered_at', now(),
      'triggerSource', 'cron',
      'app', 'ai-news-station'
    )
  ) as request_id;
  $$
);

-- Worker（process-daily-radio-jobs）
select cron.schedule(
  'process-daily-radio-jobs',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://tldekbnftaadswxhhznl.supabase.co/functions/v1/process-daily-radio-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object(
      'triggered_at', now(),
      'triggerSource', 'cron_worker'
    )
  ) as request_id;
  $$
);

-- 驗證：
-- select jobid, jobname, schedule, active from cron.job where jobname like '%daily-radio%';
