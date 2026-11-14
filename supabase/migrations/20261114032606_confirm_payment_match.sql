alter table public.transactions add column payment_match jsonb;

create function public.confirm_payment_match(
  p_transaction_id uuid, p_expected_transaction jsonb, p_target jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t public.transactions;
  b public.recurring_bills;
  d public.debts;
  target_id uuid := (p_target->>'id')::uuid;
  kind text := p_target->>'kind';
  due date := (p_target->>'due')::date;
  expected_remaining numeric := (p_target->>'remaining')::numeric;
  remaining numeric;
  applied numeric;
  matched jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in before matching'; end if;
  if kind is null or kind not in ('bill','balance','card') or due is null
    or target_id is null or expected_remaining is null then
    raise exception 'Choose a payment target';
  end if;

  -- Card payment removal also touches both records. Always lock debt first.
  if kind='card' then
    select * into d from public.debts where id=target_id and user_id=auth.uid() for update;
    if not found then raise exception 'Card installment unavailable'; end if;
  end if;
  select * into t from public.transactions where id=p_transaction_id and user_id=auth.uid() for update;
  if not found then raise exception 'Bank transaction unavailable'; end if;
  if t.payment_match is not null then
    if t.payment_match @> jsonb_build_object('kind',kind,'id',target_id,'due',due) then
      return t.payment_match;
    end if;
    raise exception 'This bank transaction is already matched';
  end if;
  if t.pending is distinct from false or t.source is distinct from 'plaid'
    or t.txn_date is null or t.txn_date not between current_date-60 and current_date
    or t.amount is null or t.amount not between 0.01 and 90071992547409.91 or t.amount<>round(t.amount,2)
    or to_jsonb(t)->>'bill_id' is not null
    or coalesce(t.note,'') ~ '(^|[[:space:]])(paid:|apple-(split|paid|reviewed):)'
    or lower(coalesce(t.merchant,'')) ~ '(^|[^a-z0-9])apple([^a-z0-9]|$)' then
    raise exception 'Choose an unmatched, posted bank payment';
  end if;
  if jsonb_build_object('amount',t.amount,'txn_date',t.txn_date,'merchant',t.merchant,'note',t.note)
    is distinct from p_expected_transaction then
    raise exception 'The bank transaction changed. Reload and review it again';
  end if;

  if kind='card' then
    if to_jsonb(d)->>'active'='false' or d.kind is distinct from 'card'
      or d.catch_up_plan is null or abs(due-t.txn_date)>15 then
      raise exception 'Card installment unavailable';
    end if;
    if exists(select 1 from public.debt_payments p where p.user_id=auth.uid() and p.debt_id=d.id
      and p.amount=t.amount and p.paid_on between t.txn_date-5 and t.txn_date+5
      and not exists (select 1 from public.transactions settled where settled.id=p.id and settled.user_id=auth.uid() and settled.payment_match->>'kind'='card')) then
      raise exception 'A similar card payment is already recorded. Check its history first';
    end if;
    select coalesce(sum(amount),0) into applied from public.debt_payments
      where user_id=auth.uid() and debt_id=d.id and note='catch-up:' || due::text;
    remaining := (d.catch_up_plan->>'amount')::numeric-applied;
    if remaining is distinct from expected_remaining then raise exception 'The installment changed. Reload and review it again'; end if;
    perform public.record_debt_payment(d.id,t.amount,t.txn_date,'catch-up:' || due::text,t.id);
  else
    select * into b from public.recurring_bills where id=target_id and user_id=auth.uid() for update;
    if not found or b.active is false then raise exception 'Bill unavailable'; end if;
    if kind='balance' then
      if due is distinct from b.outstanding_through or b.outstanding_as_of is null
        or b.outstanding_as_of is distinct from (p_target->>'as_of')::date
        or t.txn_date<=b.outstanding_as_of then
        raise exception 'This payment may already be included in the statement balance';
      end if;
      remaining := b.outstanding_amount;
    else
      if (b.start_date is not null and due<b.start_date)
        or (b.paid_through is not null and due<=b.paid_through)
        or (b.outstanding_through is not null and due<=b.outstanding_through)
        or (b.partial_paid>0 and b.partial_for<>due and (b.paid_through is null or b.partial_for>b.paid_through))
        or (case b.cadence
          when 'monthly' then abs(due-t.txn_date)>15 or b.due_day is null or b.due_day not between 1 and 31
            or extract(day from due)<>least(b.due_day,extract(day from (date_trunc('month',due)+interval '1 month - 1 day')))
          when 'weekly' then abs(due-t.txn_date)>3 or b.due_day is null or extract(dow from due)<>b.due_day
          when 'biweekly' then abs(due-t.txn_date)>6 or b.start_date is null or (due-b.start_date)%14<>0
          else true
        end) then raise exception 'Choose an unpaid scheduled bill date'; end if;
      if exists(select 1 from public.transactions used where used.user_id=auth.uid() and (
        used.payment_match @> jsonb_build_object('kind','bill','id',b.id,'due',due,'complete',true)
        or (used.pending is distinct from true and (
          ('paid:' || b.id::text || '@' || due::text)=any(regexp_split_to_array(coalesce(used.note,''),'[[:space:]]+'))
          or (abs(used.txn_date-due)<=15 and ('paid:' || b.id::text)=any(regexp_split_to_array(coalesce(used.note,''),'[[:space:]]+')))
        ))
      )) then raise exception 'This bill cycle is already paid'; end if;
      remaining := b.amount - case when b.partial_for=due then coalesce(b.partial_paid,0) else 0 end;
    end if;
    if remaining is distinct from expected_remaining or t.amount>remaining then
      raise exception 'The bill changed or the payment exceeds what is owed. Reload and review it again';
    end if;
    if kind='balance' then
      update public.recurring_bills set outstanding_amount=remaining-t.amount,
        outstanding_note=right(outstanding_note || E'\n' || 'Bank payment of $' || t.amount || ' matched on ' || t.txn_date || '.',1500)
        where id=b.id and user_id=auth.uid();
    else
      update public.recurring_bills set
        partial_paid=case when remaining=t.amount then null else b.amount-remaining+t.amount end,
        partial_for=case when remaining=t.amount then null else due end
        where id=b.id and user_id=auth.uid();
    end if;
    if not found then raise exception 'Bill could not be saved'; end if;
  end if;

  matched := jsonb_build_object('kind',kind,'id',target_id,'due',due,'amount',t.amount,'complete',remaining=t.amount);
  update public.transactions set payment_match=matched where id=t.id and user_id=auth.uid();
  if not found then raise exception 'Bank transaction could not be linked'; end if;
  return matched;
end $$;
revoke all on function public.confirm_payment_match(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_payment_match(uuid,jsonb,jsonb) to authenticated;

-- Reversing a card payment also releases its bank link.
create function public.release_card_payment_match() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.transactions set payment_match=null
    where id=old.id and user_id=old.user_id and payment_match->>'kind'='card';
  return old;
end $$;
revoke all on function public.release_card_payment_match() from public,anon;
create trigger release_card_payment_match after delete on public.debt_payments
for each row execute function public.release_card_payment_match();
