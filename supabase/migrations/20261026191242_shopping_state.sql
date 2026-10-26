create table public.shopping_state (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  content jsonb not null default '{"version":2,"meals":[],"items":[],"staples":[],"receipts":[]}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint shopping_content_object check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1048576)
);
alter table public.shopping_state enable row level security;
revoke all on public.shopping_state from anon, public;
grant select, insert, update on public.shopping_state to authenticated;
grant all on public.shopping_state to service_role;
create policy shopping_select_own on public.shopping_state for select to authenticated using ((select auth.uid()) = user_id);
create policy shopping_insert_own on public.shopping_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy shopping_update_own on public.shopping_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.save_shopping_state(p_content jsonb, p_expected_revision bigint)
returns setof public.shopping_state language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text) > 1048576
    or p_content->>'version' is distinct from '2'
    or jsonb_typeof(p_content->'meals') is distinct from 'array'
    or jsonb_typeof(p_content->'items') is distinct from 'array'
    or jsonb_typeof(p_content->'staples') is distinct from 'array'
    or jsonb_typeof(p_content->'receipts') is distinct from 'array' then
    raise exception 'Invalid shopping data';
  end if;
  if p_expected_revision = 0 then
    return query insert into public.shopping_state(user_id,content)
      values(auth.uid(),p_content) on conflict(user_id) do nothing returning *;
  else
    return query update public.shopping_state set content=p_content,revision=revision+1,updated_at=now()
      where user_id=auth.uid() and revision=p_expected_revision returning *;
  end if;
  if not found then raise exception 'Shopping data changed on another device. Reload before saving.' using errcode='40001'; end if;
end;
$$;
revoke all on function public.save_shopping_state(jsonb,bigint) from public, anon;
grant execute on function public.save_shopping_state(jsonb,bigint) to authenticated;
