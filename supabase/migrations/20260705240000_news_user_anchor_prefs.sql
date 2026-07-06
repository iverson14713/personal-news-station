-- AI 主播偏好（雲端同步，供每日推播預生成 MP3）

alter table public.news_user_preferences
  add column if not exists ai_anchor_id text not null default 'emily',
  add column if not exists ai_anchor_voice text not null default 'coral',
  add column if not exists ai_anchor_style text not null default 'news',
  add column if not exists ai_playback_rate numeric not null default 1.0,
  add column if not exists voice_feature_enabled boolean not null default false;

comment on column public.news_user_preferences.ai_anchor_id is '主播 id：emily、ryan、sage、breeze、nova';
comment on column public.news_user_preferences.ai_anchor_voice is 'OpenAI TTS voice：coral、ash 等';
comment on column public.news_user_preferences.ai_anchor_style is '播報風格 id：news、morning 等';
comment on column public.news_user_preferences.ai_playback_rate is 'AI 主播 MP3 播放速度';
comment on column public.news_user_preferences.voice_feature_enabled is 'Pro 或內部測試：允許預生成真人語音';

alter table public.news_user_preferences
  drop constraint if exists news_user_preferences_ai_playback_rate_check;

alter table public.news_user_preferences
  add constraint news_user_preferences_ai_playback_rate_check
  check (ai_playback_rate >= 0.5 and ai_playback_rate <= 3.0);
