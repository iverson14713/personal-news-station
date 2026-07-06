-- news_user_preferences：authenticated / anon 只能讀寫自己的 user_id（含 upsert）

drop policy if exists "news_users_read_own_preferences" on public.news_user_preferences;
create policy "news_users_read_own_preferences"
  on public.news_user_preferences for select
  to authenticated, anon
  using (auth.uid() = user_id);

drop policy if exists "news_users_insert_own_preferences" on public.news_user_preferences;
create policy "news_users_insert_own_preferences"
  on public.news_user_preferences for insert
  to authenticated, anon
  with check (auth.uid() = user_id);

drop policy if exists "news_users_update_own_preferences" on public.news_user_preferences;
create policy "news_users_update_own_preferences"
  on public.news_user_preferences for update
  to authenticated, anon
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
