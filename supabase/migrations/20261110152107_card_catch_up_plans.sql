-- Additive metadata; existing balances and schedules are unchanged.
create function public.valid_catch_up_plan(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare amt numeric; n integer; first_day date; reviewed date;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p)<>'object' or jsonb_typeof(p->'amount') is distinct from 'number' or jsonb_typeof(p->'count') is distinct from 'number' or jsonb_typeof(p->'first_due') is distinct from 'string' or jsonb_typeof(p->'source') is distinct from 'string' then return false; end if;
  amt:=(p->>'amount')::numeric; n:=(p->>'count')::integer;
  if not (amt>0 and amt<=90071992547409.91 and amt=round(amt,2)) or n<1 or n>60 or (p->>'count')::numeric<>n or length(btrim(p->>'source')) not between 1 and 1500 then return false; end if;
  first_day:=(p->>'first_due')::date;
  if to_char(first_day,'YYYY-MM-DD')<>p->>'first_due' then return false; end if;
  if p->>'regular_minimum_verified_on' is not null then
    reviewed:=(p->>'regular_minimum_verified_on')::date;
    if to_char(reviewed,'YYYY-MM-DD')<>p->>'regular_minimum_verified_on' then return false; end if;
  end if;
  return true;
exception when others then return false;
end $$;
alter table public.debts add column catch_up_plan jsonb;
alter table public.debts add constraint debt_catch_up_valid check (public.valid_catch_up_plan(catch_up_plan) and (catch_up_plan is null or (kind is not distinct from 'card' and coalesce(pay_frequency,'monthly')='monthly')));

CREATE OR REPLACE FUNCTION public.record_debt_payment(p_debt_id uuid, p_amount numeric, p_paid_on date, p_note text, p_request_id uuid)
 RETURNS debt_payments
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.debts; p public.debt_payments; effect numeric; due_date date; scheduled_date date; plan_paid numeric; i integer; allowed boolean;
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
  if p_note like 'catch-up:%' then
    if p_note !~ '^catch-up:[0-9]{4}-[0-9]{2}-[0-9]{2}$' or d.catch_up_plan is null then raise exception 'Choose a valid card plan installment'; end if;
    if p_paid_on>current_date then raise exception 'Record a plan payment only after it has completed'; end if;
    due_date:=substring(p_note from 10)::date; allowed:=false;
    for i in 0..((d.catch_up_plan->>'count')::integer-1) loop
      scheduled_date:=((d.catch_up_plan->>'first_due')::date + make_interval(months=>i))::date;
      if scheduled_date=due_date then allowed:=true; end if;
    end loop;
    if not allowed then raise exception 'This date is outside the agreed plan'; end if;
    select coalesce(sum(amount),0) into plan_paid from public.debt_payments where debt_id=d.id and user_id=auth.uid() and note=p_note;
    if p_amount+plan_paid>(d.catch_up_plan->>'amount')::numeric then raise exception 'Payment exceeds this installment remaining amount'; end if;
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
end $function$
