-- No existing financial records are rewritten by this migration.
create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric not null check (amount > 0 and amount <= 90071992547409.91 and amount = round(amount,2)),
  balance_effect numeric not null check (balance_effect >= 0 and balance_effect <= amount),
  paid_on date not null,
  note text,
  created_at timestamptz not null default now()
);
create index debt_payments_owner_debt_date on public.debt_payments(user_id,debt_id,paid_on desc);
alter table public.debt_payments enable row level security;
create policy debt_payment_owner on public.debt_payments for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.debts d where d.id=debt_id and d.user_id=(select auth.uid())
));
grant select,insert,delete on public.debt_payments to authenticated;
-- PostgreSQL row locks require UPDATE privilege on at least one column.
grant update(id) on public.debt_payments to authenticated;
grant all on public.debt_payments to service_role;

create function public.record_debt_payment(p_debt_id uuid,p_amount numeric,p_paid_on date,p_note text,p_request_id uuid)
returns public.debt_payments language plpgsql security invoker set search_path='' as $$
declare d public.debts; p public.debt_payments; effect numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to record a payment'; end if;
  if p_request_id is null or p_paid_on is null or p_amount is null or not (p_amount>0 and p_amount<=90071992547409.91 and p_amount=round(p_amount,2)) then
    raise exception 'Enter a positive payment with at most two decimal places and a payment date';
  end if;
  select * into d from public.debts where id=p_debt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Debt not found'; end if;
  select * into p from public.debt_payments where id=p_request_id;
  if found then
    if p.debt_id<>p_debt_id or p.amount<>p_amount or p.paid_on<>p_paid_on or p.note is distinct from p_note then
      raise exception 'This payment request was already used with different details';
    end if;
    return p;
  end if;
  effect := case when d.plaid_account_id is not null or d.plaid_item_id is not null then 0 else p_amount end;
  if effect>0 and (d.balance is null or d.balance<effect) then raise exception 'Payment exceeds the recorded balance; check the amount or update the balance first'; end if;
  insert into public.debt_payments(id,user_id,debt_id,amount,balance_effect,paid_on,note)
    values(p_request_id,auth.uid(),p_debt_id,p_amount,effect,p_paid_on,p_note) returning * into p;
  if effect>0 then
    update public.debts set balance=balance-effect where id=d.id and user_id=auth.uid();
    if not found then raise exception 'Debt balance could not be updated'; end if;
  end if;
  return p;
end $$;

create function public.remove_debt_payment(p_payment_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.debt_payments; d public.debts;
begin
  if auth.uid() is null then raise exception 'Sign in to remove a payment'; end if;
  select * into p from public.debt_payments where id=p_payment_id and user_id=auth.uid();
  if not found then return false; end if;
  -- Same lock order as record: debt first, then its history row.
  select * into d from public.debts where id=p.debt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Debt not found'; end if;
  select * into p from public.debt_payments where id=p_payment_id and user_id=auth.uid() for update;
  if not found then return false; end if;
  if p.balance_effect>0 then
    if d.plaid_account_id is not null or d.plaid_item_id is not null then
      raise exception 'This debt is now bank-linked; its bank balance cannot be restored manually';
    end if;
    update public.debts set balance=balance+p.balance_effect where id=d.id and user_id=auth.uid();
    if not found then raise exception 'Debt balance could not be restored'; end if;
  end if;
  delete from public.debt_payments where id=p.id and user_id=auth.uid();
  if not found then raise exception 'Payment history could not be removed'; end if;
  return true;
end $$;
revoke all on function public.record_debt_payment(uuid,numeric,date,text,uuid) from public,anon;
revoke all on function public.remove_debt_payment(uuid) from public,anon;
grant execute on function public.record_debt_payment(uuid,numeric,date,text,uuid) to authenticated;
grant execute on function public.remove_debt_payment(uuid) to authenticated;

-- start_date is the persisted biweekly anchor, shared by app and connector.
alter table public.recurring_bills drop constraint recurring_bills_cadence_check;
alter table public.recurring_bills add constraint recurring_bills_cadence_check
  check (cadence in ('monthly','weekly','biweekly'));
alter table public.recurring_bills add constraint recurring_bills_biweekly_start
  check (cadence<>'biweekly' or start_date is not null);
