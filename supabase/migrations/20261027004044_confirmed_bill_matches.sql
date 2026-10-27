-- A confirmation is one atomic, owner-scoped operation. Rendering never writes.
create or replace function public.confirm_apple_bill_match(
 p_transaction_id uuid, p_expected_transaction jsonb, p_parts jsonb,
 p_mode text default 'match'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 t public.transactions%rowtype;
 b public.recurring_bills%rowtype;
 part jsonb; due date; allocation numeric; prior numeric; total numeric := 0;
 markers text := ''; split text := ''; merchant_name text;
begin
 if auth.uid() is null then raise exception 'Sign in before matching'; end if;
 if p_mode is null or p_mode not in ('match','not_bill') or jsonb_typeof(p_parts) is distinct from 'array'
 or jsonb_typeof(p_expected_transaction) is distinct from 'object' then raise exception 'Invalid match'; end if;
 if jsonb_array_length(p_parts)>50 or (p_mode='match' and jsonb_array_length(p_parts)=0)
 or (p_mode='not_bill' and jsonb_array_length(p_parts)<>0) then raise exception 'Invalid match parts'; end if;
 select * into t from public.transactions where id=p_transaction_id and user_id=auth.uid() for update;
 if not found then raise exception 'Charge unavailable'; end if;
 merchant_name := trim(regexp_replace(lower(coalesce(t.merchant,'')),'[^a-z0-9]+',' ','g'));
 if coalesce(t.pending,false) or t.amount<=0 or t.amount::text in ('NaN','Infinity','-Infinity')
 or not (merchant_name='apple' or merchant_name like 'apple %' or merchant_name like '% apple%')
 then raise exception 'Choose a posted Apple charge'; end if;
 if jsonb_build_object('note',t.note,'amount',t.amount,'txn_date',t.txn_date,'merchant',t.merchant,'pending',coalesce(t.pending,false)) is distinct from p_expected_transaction
 then raise exception 'Charge changed. Reload before matching' using errcode='40001'; end if;
 if coalesce(t.note,'') ~ 'apple-(split|paid|reviewed):' then raise exception 'Charge already reviewed'; end if;
 if p_mode='not_bill' then
  update public.transactions set note=concat_ws(' ',nullif(note,''),'apple-reviewed:not-bill') where id=t.id and user_id=auth.uid();
  return jsonb_build_object('ok',true,'bills',0);
 end if;
 if (select count(distinct x->>'bill_id') from jsonb_array_elements(p_parts) x) <> jsonb_array_length(p_parts)
 then raise exception 'Choose each bill only once'; end if;
 -- Stable lock order prevents two split confirmations from deadlocking.
 perform id from public.recurring_bills where user_id=auth.uid() and id in
 (select (x->>'bill_id')::uuid from jsonb_array_elements(p_parts) x) order by id for update;
 for part in select * from jsonb_array_elements(p_parts) loop
  select * into b from public.recurring_bills where id=(part->>'bill_id')::uuid and user_id=auth.uid();
  if not found or b.active is false then raise exception 'Bill unavailable'; end if;
  if jsonb_build_object('amount',b.amount,'cadence',b.cadence,'due_day',b.due_day,'start_date',b.start_date,'active',b.active,'paid_through',b.paid_through,'partial_paid',b.partial_paid,'partial_for',b.partial_for) is distinct from part->'expected_bill'
  then raise exception 'Bill changed. Reload before matching' using errcode='40001'; end if;
  allocation := (part->>'amount')::numeric; due := (part->>'due_date')::date;
  if allocation is null or allocation::text in ('NaN','Infinity','-Infinity') or allocation<=0 or allocation<>round(allocation,2)
  or due is null or due::text is distinct from part->>'due_date' or b.amount is null or b.amount<=0
  or b.amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment amount or date'; end if;
  if due<t.txn_date-45 or due>t.txn_date+45 or (b.start_date is not null and due<b.start_date)
  or (b.cadence='weekly' and extract(dow from due)<>b.due_day)
  or (b.cadence='monthly' and (b.due_day not between 1 and 31 or extract(day from due)<>least(b.due_day,extract(day from (date_trunc('month',due)+interval '1 month - 1 day')))))
  or b.cadence is null or b.cadence not in ('monthly','weekly') then raise exception 'Choose an actual scheduled due date'; end if;
  if b.paid_through>=due then raise exception 'Bill already paid through this date'; end if;
  if coalesce(b.partial_paid,0)>0 and b.partial_for is not null and b.partial_for<>due
   and (b.paid_through is null or b.partial_for>b.paid_through) then raise exception 'Existing partial payment has another due date'; end if;
  prior := case when b.partial_for=due then coalesce(b.partial_paid,0) else 0 end;
  if allocation+prior>b.amount then raise exception 'Payment exceeds remaining bill amount'; end if;
  total := total+allocation;
 end loop;
 if total<>t.amount then raise exception 'Payments must equal the posted charge exactly'; end if;
 for part in select * from jsonb_array_elements(p_parts) loop
  select * into b from public.recurring_bills where id=(part->>'bill_id')::uuid and user_id=auth.uid();
  due := (part->>'due_date')::date; allocation := (part->>'amount')::numeric;
  prior := case when b.partial_for=due then coalesce(b.partial_paid,0) else 0 end;
  if allocation+prior=b.amount then
   update public.recurring_bills set paid_through=due,partial_paid=null,partial_for=null where id=b.id and user_id=auth.uid();
   markers := markers || ' paid:' || b.id::text || '@' || due::text;
  else
   update public.recurring_bills set partial_paid=allocation+prior,partial_for=due where id=b.id and user_id=auth.uid();
  end if;
  if not found then raise exception 'Bill could not be saved'; end if;
  split := concat_ws(',',nullif(split,''),b.id::text || '=' || allocation::text);
 end loop;
 update public.transactions set note=concat_ws(' ',nullif(note,''),'apple-split:' || split || markers) where id=t.id and user_id=auth.uid();
 if not found then raise exception 'Charge could not be saved'; end if;
 return jsonb_build_object('ok',true,'bills',jsonb_array_length(p_parts));
end $$;
revoke all on function public.confirm_apple_bill_match(uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.confirm_apple_bill_match(uuid,jsonb,jsonb,text) to authenticated;
