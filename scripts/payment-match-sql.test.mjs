import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'

test('confirm payment RPC checks ownership, transaction snapshot, duplicate use and stale amounts',async () => {
  const db=new PGlite()
  const [owner,other,bill,debt,first,second,third,pending,foreign,arrears,balanceTxn]=Array.from({length:11},()=>randomUUID())
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.debts(id uuid primary key,user_id uuid,balance numeric,kind text,pay_frequency text,plaid_account_id text,plaid_item_id text);
      create table public.transactions(id uuid primary key,user_id uuid,merchant text,amount numeric,txn_date date,pending boolean,note text,source text);
      create table public.recurring_bills(id uuid primary key,user_id uuid,amount numeric,due_day integer,active boolean,paid_through date,partial_paid numeric,partial_for date,cadence text constraint recurring_bills_cadence_check check(cadence in ('monthly','weekly')),start_date date);
      alter table public.transactions enable row level security;
      alter table public.recurring_bills enable row level security;
      alter table public.debts enable row level security;
      create policy own on public.transactions to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy own on public.recurring_bills to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy own on public.debts to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      grant select,update on public.debts,public.transactions,public.recurring_bills to authenticated;
    `)
    for(const migration of ['20261109141527_debt_history_biweekly_bills','20261109182427_bill_outstanding_balances','20261110152107_card_catch_up_plans','20261114032606_confirm_payment_match']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}.sql`,import.meta.url),'utf8'))
    }
    const {rows:[{date,due_day:day}]}=await db.query('select current_date::text date, extract(day from current_date)::int as due_day')
    await db.query('insert into auth.users values($1),($2)',[owner,other])
    await db.query("insert into public.recurring_bills(id,user_id,amount,due_day,active,cadence) values($1,$2,100,$3,true,'monthly')",[bill,owner,day])
    await db.query("insert into public.recurring_bills(id,user_id,amount,due_day,active,cadence,outstanding_amount,outstanding_as_of,outstanding_through,outstanding_due_date,outstanding_note) values($1,$2,100,$3,true,'monthly',180,current_date-1,current_date-10,current_date-10,'test')",[arrears,owner,day])
    await db.query("insert into public.debts values($1,$2,500,'card','monthly',null,null,$3)",[debt,owner,JSON.stringify({first_due:date,count:3,amount:90,source:'test'})])
    for (const [id,uid,amount,isPending] of [[first,owner,35,false],[second,owner,65,false],[third,owner,90,false],[pending,owner,10,true],[foreign,other,10,false],[balanceTxn,owner,100,false]]) {
      await db.query("insert into public.transactions values($1,$2,'Example', $3,current_date,$4,null,'plaid',null)",[id,uid,amount,isPending])
    }
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`)
    const match=(id,amount,targetId,kind,remaining,extra={})=>db.query('select public.confirm_payment_match($1,$2,$3)',[
      id,JSON.stringify({amount,txn_date:date,merchant:'Example',note:null}),
      JSON.stringify({kind,id:targetId,due:date,remaining,...extra}),
    ])
    await assert.rejects(match(pending,10,bill,'bill',100),/posted/)
    await assert.rejects(match(foreign,10,bill,'bill',100),/unavailable/)
    await assert.rejects(match(first,34,bill,'bill',100),/changed/)
    await match(first,35,bill,'bill',100)
    await match(first,35,bill,'bill',100)
    await assert.rejects(match(first,35,debt,'card',90),/already matched/)
    await assert.rejects(match(second,65,bill,'bill',100),/changed/)
    await match(second,65,bill,'bill',65)
    await assert.rejects(match(third,90,bill,'bill',100),/already paid/)
    await match(third,90,debt,'card',90)
    await match(third,90,debt,'card',90)
    assert.equal(Number((await db.query('select balance from public.debts')).rows[0].balance),410)
    assert.equal((await db.query('select count(*)::int n from public.debt_payments')).rows[0].n,1)
    await db.query('select public.remove_debt_payment($1)',[third])
    assert.equal((await db.query('select payment_match from public.transactions where id=$1',[third])).rows[0].payment_match,null)
    assert.equal(Number((await db.query('select balance from public.debts')).rows[0].balance),500)
    const {rows:[dates]}=await db.query("select (current_date-1)::text as as_of,(current_date-10)::text as due")
    await match(balanceTxn,100,arrears,'balance',180,dates)
    assert.equal(Number((await db.query('select outstanding_amount from public.recurring_bills where id=$1',[arrears])).rows[0].outstanding_amount),80)
  } finally {await db.close()}
})
