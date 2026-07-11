-- Per-device APNs environment (sandbox | production) for push routing.
-- Existing rows stay NULL until the App re-syncs the token.

alter table public.news_user_preferences
  add column if not exists push_environment text;

alter table public.news_user_preferences
  drop constraint if exists news_user_preferences_push_environment_check;

alter table public.news_user_preferences
  add constraint news_user_preferences_push_environment_check
  check (
    push_environment is null
    or push_environment in ('sandbox', 'production')
  );

comment on column public.news_user_preferences.push_environment is
  'APNs environment for push_token: sandbox (Xcode Debug) or production (TestFlight/App Store)';
