import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('debt history and balances are atomic, idempotent, owner-scoped and reversible',async()=>{
  const db=new PGlite(),owner=randomUUID(),other=randomUUID(),manual=randomUUID(),linked=randomUUID(),foreign=randomUUID();
  try {
    await db.exec(`create role authenticated;create role anon;create role service_role;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;
      create table public.debts(id uuid primary key,user_id uuid,balance numeric,plaid_account_id text,plaid_item_id text);
      alter table public.debts enable row level security;
      create policy own_debt on public.debts to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      grant select,update on public.debts to authenticated;
      create table public.recurring_bills(id int,cadence text constraint recurring_bills_cadence_check check(cadence in ('monthly','weekly')),start_date date);`);
    await db.query('insert into auth.users values($1),($2)',[owner,other]);
    await db.query('insert into public.debts values($1,$2,100,null,null),($3,$2,100,\'bank-account\',null),($4,$5,200,null,null)',[manual,owner,linked,foreign,other]);
    await db.exec(await readFile(new URL('../supabase/migrations/20261109134419_debt_history_biweekly_bills.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
    const pay=(id,amount,key=randomUUID())=>db.query('select (public.record_debt_payment($1,$2,$3,$4,$5)).*',[id,amount,'2026-11-09','test',key]);
    const balance=async(id)=>Number((await db.query('select balance from public.debts where id=$1',[id])).rows[0].balance);
    const key=randomUUID();await pay(manual,30,key);await pay(manual,30,key);
    assert.equal(await balance(manual),70);assert.equal((await db.query('select count(*)::int n from public.debt_payments')).rows[0].n,1);
    await assert.rejects(pay(manual,31,key),/different details/);
    for(const amount of [null,0,-1,1.001,'NaN','Infinity',101]) await assert.rejects(pay(manual,amount));
    assert.equal(await balance(manual),70);
    await assert.rejects(pay(foreign,10),/Debt not found/);
    assert.equal((await db.query('select * from public.debt_payments where user_id=$1',[other])).rows.length,0);
    const bankKey=randomUUID();await pay(linked,200,bankKey);assert.equal(await balance(linked),100);
    assert.equal(Number((await db.query('select balance_effect from public.debt_payments where id=$1',[bankKey])).rows[0].balance_effect),0);
    await db.query('select public.remove_debt_payment($1)',[bankKey]);assert.equal(await balance(linked),100);
    // A failure after inserting history rolls back the history and balance together.
    await db.exec(`reset role;create function reject_balance() returns trigger language plpgsql as $$begin raise exception 'simulated balance failure';end$$;
      create trigger fail_write before update on public.debts for each row execute function reject_balance();set role authenticated;`);
    const failed=randomUUID();await assert.rejects(pay(manual,5,failed),/simulated balance failure/);
    assert.equal((await db.query('select * from public.debt_payments where id=$1',[failed])).rows.length,0);assert.equal(await balance(manual),70);
    await assert.rejects(db.query('select public.remove_debt_payment($1)',[key]),/simulated balance failure/);
    assert.equal((await db.query('select * from public.debt_payments where id=$1',[key])).rows.length,1);
    await db.exec('reset role;drop trigger fail_write on public.debts;set role authenticated');
    await db.query('select public.remove_debt_payment($1)',[key]);await db.query('select public.remove_debt_payment($1)',[key]);assert.equal(await balance(manual),100);
    // Ownership cannot be forged by writing a history row against someone else's debt.
    await assert.rejects(db.query('insert into public.debt_payments(user_id,debt_id,amount,balance_effect,paid_on) values($1,$2,5,5,current_date)',[owner,foreign]),/row-level security/);
    await db.exec('reset role');
    await assert.rejects(db.exec("insert into public.recurring_bills values(1,'biweekly',null)"),/biweekly_start/);
    await db.exec("insert into public.recurring_bills values(1,'biweekly','2026-11-19')");
    await db.exec('set role anon');await assert.rejects(pay(manual,1),/permission denied/);
  } finally {await db.close();}
});
