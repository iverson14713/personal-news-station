-- 允許同一 user / 日期 / 時長 同時存在 app 與 server 兩筆稿件
-- app 稿件不再阻擋 Cron 產生 server 早報

alter table public.news_daily_radio_scripts
  drop constraint if exists news_daily_radio_scripts_unique_per_day;

alter table public.news_daily_radio_scripts
  drop constraint if exists news_daily_radio_scripts_unique_per_source;

alter table public.news_daily_radio_scripts
  add constraint news_daily_radio_scripts_unique_per_source
  unique (user_id, script_date, duration_minutes, generation_source);

comment on constraint news_daily_radio_scripts_unique_per_source
  on public.news_daily_radio_scripts is
  'app 與 server 早報可共存；server Cron 不因 app 稿件而 skip';
