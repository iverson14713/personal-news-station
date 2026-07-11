-- Free 帳號 production 分布與 7 天 push 歷史

with free_users as (
  select
    u.id as user_id,
    u.email,
    p.user_id is not null as has_preferences_row,
    p.daily_radio_enabled,
    p.morning_radio_enabled,
    p.evening_radio_enabled,
    p.morning_duration_minutes,
    p.evening_duration_minutes,
    p.updated_at as pref_updated_at,
    nullif(trim(p.push_token), '') is not null as has_push_token,
    p.push_token is not null as push_token_nonnull,
    coalesce(cardinality(p.topics), 0) + coalesce(cardinality(p.custom_keywords), 0) as topic_count
  from auth.users u
  left join public.news_user_preferences p on p.user_id = u.id
  where coalesce(p.voice_feature_enabled, false) = false
),
push_history as (
  select
    s.user_id,
    count(*) filter (where s.push_sent_at is not null) as total_push_sent_scripts,
    max(s.push_sent_at) as last_push_sent_at,
    count(*) filter (
      where s.push_sent_at >= (now() at time zone 'Asia/Taipei')::date - interval '7 days'
    ) as push_sent_last_7d,
    count(*) filter (
      where s.script_date >= (now() at time zone 'Asia/Taipei')::date - interval '7 days'
        and s.radio_slot = 'morning'
        and s.generation_source = 'server'
        and s.status = 'completed'
    ) as morning_completed_last_7d,
    count(*) filter (
      where s.script_date = (now() at time zone 'Asia/Taipei')::date
        and s.radio_slot = 'morning'
        and s.generation_source = 'server'
        and s.status = 'completed'
    ) as today_morning_completed
  from public.news_daily_radio_scripts s
  group by s.user_id
)
select
  f.*,
  coalesce(h.total_push_sent_scripts, 0) as total_push_sent_scripts,
  h.last_push_sent_at,
  coalesce(h.push_sent_last_7d, 0) as push_sent_last_7d,
  coalesce(h.morning_completed_last_7d, 0) as morning_completed_last_7d,
  coalesce(h.today_morning_completed, 0) as today_morning_completed,
  case
    when h.last_push_sent_at is not null
      and h.last_push_sent_at < (now() at time zone 'Asia/Taipei')::date - interval '2 days'
      and f.has_preferences_row
      and coalesce(f.daily_radio_enabled, false) = true
      and coalesce(f.morning_radio_enabled, true) = true
      and f.topic_count > 0
    then 'push_interrupted'
    when not f.has_preferences_row then 'missing_preferences_row'
    when coalesce(f.daily_radio_enabled, false) = false then 'daily_radio_disabled'
    when coalesce(f.morning_radio_enabled, true) = false then 'morning_disabled'
    when f.topic_count = 0 then 'no_topics'
    when h.today_morning_completed > 0 then 'today_ok'
    else 'eligible_no_today'
  end as regression_flag
from free_users f
left join push_history h on h.user_id = f.user_id
order by h.last_push_sent_at desc nulls last, f.pref_updated_at desc nulls last;

-- 彙總
-- select
--   count(*) as free_total,
--   count(*) filter (where has_preferences_row) as has_prefs,
--   count(*) filter (where daily_radio_enabled = true) as daily_on,
--   count(*) filter (where daily_radio_enabled = false) as daily_off,
--   count(*) filter (where daily_radio_enabled is null) as daily_null,
--   count(*) filter (where morning_radio_enabled = true) as morning_on,
--   count(*) filter (where morning_radio_enabled = false) as morning_off,
--   count(*) filter (where morning_duration_minutes = 3) as dur_3,
--   count(*) filter (where has_push_token) as has_token,
--   count(*) filter (where regression_flag = 'push_interrupted') as push_interrupted
-- from (...);
