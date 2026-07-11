-- Free 使用者 evening 異常診斷（預期皆為 0）
-- plan 判斷：voice_feature_enabled = true 為 Pro，其餘為 Free

-- 1. Free 且 evening_radio_enabled = true（DB 污染）
select
  p.user_id,
  p.evening_radio_enabled,
  p.voice_feature_enabled,
  p.display_name
from public.news_user_preferences p
where coalesce(p.voice_feature_enabled, false) = false
  and p.evening_radio_enabled = true;

-- 2. Free 且存在 server evening script
select
  s.id,
  s.user_id,
  s.script_date,
  s.radio_slot,
  s.generation_source,
  s.status,
  s.push_sent_at,
  p.voice_feature_enabled
from public.news_daily_radio_scripts s
join public.news_user_preferences p on p.user_id = s.user_id
where coalesce(p.voice_feature_enabled, false) = false
  and s.radio_slot = 'evening'
  and s.generation_source = 'server'
order by s.script_date desc, s.updated_at desc;

-- 3. Free 且存在 pending / processing / retry_wait evening job
select
  j.id,
  j.user_id,
  j.script_date,
  j.radio_slot,
  j.status,
  j.queued_at,
  j.last_error,
  p.voice_feature_enabled
from public.news_daily_radio_job_runs j
join public.news_user_preferences p on p.user_id = j.user_id
where coalesce(p.voice_feature_enabled, false) = false
  and j.radio_slot = 'evening'
  and j.status in ('pending', 'processing', 'retry_wait')
order by j.queued_at desc;

-- 4. Free 且 evening push_sent_at 非 null（server script）
select
  s.id,
  s.user_id,
  s.script_date,
  s.push_sent_at,
  s.generation_source,
  p.voice_feature_enabled
from public.news_daily_radio_scripts s
join public.news_user_preferences p on p.user_id = s.user_id
where coalesce(p.voice_feature_enabled, false) = false
  and s.radio_slot = 'evening'
  and s.generation_source = 'server'
  and s.push_sent_at is not null
order by s.push_sent_at desc;

-- 5. 彙總計數
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
