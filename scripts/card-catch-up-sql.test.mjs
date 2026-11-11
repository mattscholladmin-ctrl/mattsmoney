import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
test('card catch-up payment allocations are atomic, idempotent, owner-scoped and reversible',async()=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),card=randomUUID(),foreign=randomUUID()
 try {
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create table public.debts(id uuid primary key,user_id uuid,balance numeric,kind text,pay_frequency text,plaid_account_id text,plaid_item_id text);alter table public.debts enable row level security;create policy own on public.debts to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());grant select,update on public.debts to authenticated;create table public.recurring_bills(id int,cadence text constraint recurring_bills_cadence_check check(cadence in ('monthly','weekly')),start_date date);`)
 await db.query('insert into auth.users values($1),($2)',[owner,other])
 await db.query("insert into public.debts values($1,$2,300,'card','monthly',null,null),($3,$4,400,'card','monthly',null,null)",[card,owner,foreign,other])
 await db.exec(await readFile(new URL('../supabase/migrations/20261109141527_debt_history_biweekly_bills.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261110152107_card_catch_up_plans.sql',import.meta.url),'utf8'))
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`)
 const plan={amount:90,first_due:'2026-10-16',count:3,source:'Test provider confirmation'}
 for(const bad of [{...plan,amount:0},{...plan,count:0},{...plan,count:2.5},{...plan,first_due:'2026-02-30'},{...plan,source:''},{amount:90},null]) {
   if(bad===null){await assert.rejects(db.query('update public.debts set catch_up_plan=$1,kind=null where id=$2',[JSON.stringify(plan),card]));continue}
   await assert.rejects(db.query('update public.debts set catch_up_plan=$1 where id=$2',[JSON.stringify(bad),card]))
 }
 await db.query('update public.debts set catch_up_plan=$1 where id=$2',[JSON.stringify(plan),card])
 const pay=(id,amount,note='catch-up:2026-10-16',key=randomUUID(),day='2026-10-17')=>db.query('select (public.record_debt_payment($1,$2,$3,$4,$5)).*',[id,amount,day,note,key])
 const key=randomUUID();await pay(card,40,undefined,key);await pay(card,40,undefined,key)
 await pay(card,50)
 assert.equal(Number((await db.query('select balance from public.debts where id=$1',[card])).rows[0].balance),210)
 assert.equal((await db.query('select count(*)::int n from public.debt_payments')).rows[0].n,2)
 await assert.rejects(pay(card,1),/remaining amount/)
 await assert.rejects(pay(card,10,'catch-up:2026-09-16'),/outside/)
 await assert.rejects(pay(card,10,'catch-up:2026-11-16',randomUUID(),'2099-01-01'),/completed/)
 await assert.rejects(pay(foreign,10),/Debt not found/)
 await db.query('select public.remove_debt_payment($1)',[key])
 await pay(card,40)
 assert.equal(Number((await db.query('select balance from public.debts where id=$1',[card])).rows[0].balance),210)
 } finally {await db.close()}
})
