-- Daily radio queue 監控查詢

-- 1. pending job 數量 + 最老等待時間
select
  status,
  count(*) as cnt,
  min(queued_at) as oldest_queued_at,
  extract(epoch from (now() - min(queued_at)))::int as oldest_age_seconds
from public.news_daily_radio_job_runs
where script_date = (now() at time zone 'Asia/Taipei')::date
group by status
order by status;

-- 2. 今日 morning 應生成 / completed / missing（有主題 Free+Pro）
with eligible as (
  select p.user_id,
    coalesce(p.voice_feature_enabled, false) as is_pro
  from public.news_user_preferences p
  where p.daily_radio_enabled = true
    and coalesce(p.morning_radio_enabled, true) = true
    and coalesce(cardinality(p.topics), 0) + coalesce(cardinality(p.custom_keywords), 0) > 0
),
completed as (
  select distinct s.user_id
  from public.news_daily_radio_scripts s
  where s.script_date = (now() at time zone 'Asia/Taipei')::date
    and s.radio_slot = 'morning'
    and s.generation_source = 'server'
    and s.status = 'completed'
)
select
  (select count(*) from eligible) as should_generate_morning,
  (select count(*) from completed) as morning_completed,
  (select count(*) from eligible e left join completed c on c.user_id = e.user_id where c.user_id is null) as morning_missing,
  (select count(*) from public.news_daily_radio_job_runs
   where script_date = (now() at time zone 'Asia/Taipei')::date
     and radio_slot = 'morning'
     and status in ('pending', 'processing', 'retry_wait')) as queue_active;

-- 3. Free vs Pro job 統計
select
  case when coalesce(p.voice_feature_enabled, false) then 'pro' else 'free' end as plan,
  j.status,
  count(*) as cnt,
  avg(extract(epoch from (coalesce(j.completed_at, now()) - j.started_at)))::int as avg_duration_sec
from public.news_daily_radio_job_runs j
join public.news_user_preferences p on p.user_id = j.user_id
where j.script_date = (now() at time zone 'Asia/Taipei')::date
group by 1, 2
order by 1, 2;

-- 4. pgmq wrapper metrics
select public.daily_radio_queue_metrics();

-- 5. failed / retry_wait 明細
select id, user_id, radio_slot, status, attempt_count, last_error, error_stage, next_retry_at, queued_at
from public.news_daily_radio_job_runs
where script_date = (now() at time zone 'Asia/Taipei')::date
  and status in ('failed', 'retry_wait')
order by queued_at desc;

-- 6. Free evening 異常診斷（詳見 scripts/daily-radio-free-evening-diagnostics.sql）
select
  (select count(*) from public.news_user_preferences p
   where coalesce(p.voice_feature_enabled, false) = false and p.evening_radio_enabled = true) as free_evening_enabled,
  (select count(*) from public.news_daily_radio_scripts s
   join public.news_user_preferences p on p.user_id = s.user_id
   where coalesce(p.voice_feature_enabled, false) = false
     and s.radio_slot = 'evening' and s.generation_source = 'server') as free_server_evening_scripts,
  (select count(*) from public.news_daily_radio_job_runs j
   join public.news_user_preferences p on p.user_id = j.user_id
   where coalesce(p.voice_feature_enabled, false) = false
     and j.radio_slot = 'evening'
     and j.status in ('pending', 'processing', 'retry_wait')) as free_active_evening_jobs,
  (select count(*) from public.news_daily_radio_scripts s
   join public.news_user_preferences p on p.user_id = s.user_id
   where coalesce(p.voice_feature_enabled, false) = false
     and s.radio_slot = 'evening' and s.generation_source = 'server'
     and s.push_sent_at is not null) as free_evening_push_sent;
