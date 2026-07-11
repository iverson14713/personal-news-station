-- 為已登入但缺少 news_user_preferences 的 auth.users 建立預設列（Cron 生成名單必要條件）

insert into public.news_user_preferences (
  user_id,
  topics,
  custom_keywords,
  daily_radio_enabled,
  daily_radio_time,
  morning_radio_enabled,
  evening_radio_enabled,
  morning_radio_time,
  evening_radio_time,
  morning_duration_minutes,
  evening_duration_minutes,
  timezone,
  display_name,
  voice_feature_enabled
)
select
  u.id,
  '{}'::text[],
  '{}'::text[],
  true,
  '07:00',
  true,
  false,
  '07:00',
  '17:00',
  3,
  3,
  'Asia/Taipei',
  null,
  false
from auth.users u
left join public.news_user_preferences p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

-- 清除逾時仍卡在 generating 的 server 稿件（>20 分鐘）

update public.news_daily_radio_scripts
set
  status = 'failed',
  error_message = coalesce(nullif(trim(error_message), ''), 'stale_generating_reset'),
  updated_at = now()
where generation_source = 'server'
  and status = 'generating'
  and updated_at < now() - interval '20 minutes';
