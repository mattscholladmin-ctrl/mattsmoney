-- Supabase-only preference storage. Does not change money tables or their rows.
create table public.app_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 131072),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.app_preferences enable row level security;
revoke all on public.app_preferences from anon, authenticated;
grant select, insert, update on public.app_preferences to authenticated;
create policy "Read own app preferences" on public.app_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own app preferences" on public.app_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own app preferences" on public.app_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Merge individual keys under a row lock. Separate devices can edit separate
-- toggles without replacing each other's entire plan. The first import wins.
create function public.patch_app_preferences(p_patch jsonb, p_initialize_only boolean default false)
returns setof public.app_preferences
language plpgsql security invoker set search_path = ''
as $$
declare
  item record;
begin
  if auth.uid() is null then raise exception 'Sign in to save preferences' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 131072 then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(p_patch) loop
    if length(item.key) > 240 then raise exception 'Preference key too long' using errcode = '22023'; end if;
    if item.key !~ '^(plan:(needs|wants|savings)|planOff:[gd]-.+|rejectedIdeas:.+|spreadBills|fs|extraId|dismissed)$' then
      raise exception 'Unknown preference key' using errcode = '22023';
    end if;
    -- JSON null is an explicit reset of one key.
    if item.value = 'null'::jsonb then continue; end if;
    if item.key ~ '^plan:' then
      if jsonb_typeof(item.value) <> 'number' then raise exception 'Invalid plan amount' using errcode = '22023'; end if;
      if (item.value::text)::numeric < 0 or (item.value::text)::numeric > 1000000 then raise exception 'Invalid plan amount' using errcode = '22023'; end if;
    elsif item.key ~ '^(planOff:|rejectedIdeas:)' or item.key = 'spreadBills' then
      if jsonb_typeof(item.value) <> 'boolean' then raise exception 'Invalid switch' using errcode = '22023'; end if;
    elsif item.key = 'fs' then
      if item.value not in ('"s"'::jsonb, '"m"'::jsonb, '"l"'::jsonb, '"xl"'::jsonb) then raise exception 'Invalid text size' using errcode = '22023'; end if;
    elsif item.key = 'extraId' then
      if jsonb_typeof(item.value) <> 'string' or length(item.value #>> '{}') > 200 then raise exception 'Invalid reviewed income ID' using errcode = '22023'; end if;
    elsif item.key = 'dismissed' then
      if jsonb_typeof(item.value) <> 'array' then raise exception 'Invalid dismissed items' using errcode = '22023'; end if;
      if jsonb_array_length(item.value) > 500 or exists (select 1 from jsonb_array_elements(item.value) v where jsonb_typeof(v) <> 'string') then raise exception 'Invalid dismissed items' using errcode = '22023'; end if;
    end if;
  end loop;
  if p_initialize_only then
    insert into public.app_preferences(user_id, preferences, revision)
      values (auth.uid(), p_patch, 1) on conflict (user_id) do nothing;
  else
    insert into public.app_preferences as existing(user_id, preferences, revision)
      values (auth.uid(), p_patch, 1)
      on conflict (user_id) do update set
        preferences = existing.preferences || excluded.preferences,
        revision = existing.revision + 1,
        updated_at = now();
  end if;
  return query select * from public.app_preferences where user_id = auth.uid();
end;
$$;
revoke all on function public.patch_app_preferences(jsonb, boolean) from public, anon;
grant execute on function public.patch_app_preferences(jsonb, boolean) to authenticated;
