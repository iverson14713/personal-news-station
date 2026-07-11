-- 今日早報資格診斷（台北日期 = current_date at Asia/Taipei）
with taipei_today as (
  select (now() at time zone 'Asia/Taipei')::date as script_date
),
users_base as (
  select
    u.id as user_id,
    u.email,
    coalesce(p.voice_feature_enabled, false) as is_pro,
    case when coalesce(p.voice_feature_enabled, false) then 'pro' else 'free' end as plan,
    p.daily_radio_enabled,
    p.morning_radio_enabled,
    p.evening_radio_enabled,
    p.morning_duration_minutes,
    p.evening_duration_minutes,
    p.updated_at as pref_updated_at,
    p.user_id is not null as has_preferences_row,
    coalesce(cardinality(p.topics), 0) + coalesce(cardinality(p.custom_keywords), 0) as topic_count,
    case when nullif(trim(p.push_token), '') is not null then 1 else 0 end as push_token_count
  from auth.users u
  left join public.news_user_preferences p on p.user_id = u.id
  cross join taipei_today t
),
today_morning as (
  select
    s.user_id,
    s.status,
    s.audio_generated_at,
    s.push_sent_at,
    s.updated_at as script_updated_at
  from public.news_daily_radio_scripts s
  cross join taipei_today t
  where s.script_date = t.script_date
    and s.radio_slot = 'morning'
    and s.generation_source = 'server'
    and s.duration_minutes = 3
),
diagnosed as (
  select
    b.*,
    m.status as morning_status,
    m.audio_generated_at,
    m.push_sent_at,
    m.script_updated_at,
    m.status = 'completed' as has_today_morning_script,
    case
      when not b.has_preferences_row then 'missing_preferences_row'
      when coalesce(b.daily_radio_enabled, false) = false then 'daily_radio_disabled'
      when coalesce(b.morning_radio_enabled, true) = false then 'morning_disabled'
      when coalesce(b.morning_duration_minutes, 3) not in (3, 5, 10) then 'invalid_duration'
      when b.topic_count = 0 then 'no_topics'
      when m.status = 'completed' then 'already_generated'
      when m.status = 'generating' then 'generation_in_progress'
      when coalesce(b.daily_radio_enabled, false) = true
        and coalesce(b.morning_radio_enabled, true) = true
        and b.topic_count > 0 then 'eligible'
      else 'unknown'
    end as exclusion_reason,
    case
      when not b.has_preferences_row then 'query_join_excluded'
      when coalesce(b.daily_radio_enabled, false) = false then 'query_join_excluded'
      when coalesce(b.morning_radio_enabled, true) = false then 'outside_time_window'
      when b.topic_count = 0 then 'no_topics'
      when m.status = 'completed' then 'already_generated'
      when m.status = 'generating' then 'generation_in_progress'
      when coalesce(b.daily_radio_enabled, false) = true then 'eligible'
      else 'unknown'
    end as eligibility_status
  from users_base b
  left join today_morning m on m.user_id = b.user_id
)
select *
from diagnosed
where plan = 'free'
order by exclusion_reason, pref_updated_at desc nulls last;

-- 彙總
-- select plan, exclusion_reason, count(*) from diagnosed group by 1,2 order by 1,2;
-- Cron 名單大小
-- select count(*) from news_user_preferences where daily_radio_enabled = true;
