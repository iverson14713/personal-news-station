-- push_platform：記錄裝置推播平台（ios / android）

alter table public.news_user_preferences
  add column if not exists push_platform text;

alter table public.news_user_preferences
  drop constraint if exists news_user_preferences_push_platform_check;

alter table public.news_user_preferences
  add constraint news_user_preferences_push_platform_check
  check (push_platform is null or push_platform in ('ios', 'android'));

comment on column public.news_user_preferences.push_platform is '推播平台：ios | android';
