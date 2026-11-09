import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
test('outstanding balances preserve owner security and reject incomplete or invalid snapshots',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`create role authenticated; create table public.recurring_bills(id int primary key,user_id text,amount numeric); insert into public.recurring_bills values(1,'owner',179),(2,'other',50); alter table public.recurring_bills enable row level security; create policy own on public.recurring_bills to authenticated using(user_id=current_setting('app.owner',true)) with check(user_id=current_setting('app.owner',true)); grant select,update on public.recurring_bills to authenticated;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261109182427_bill_outstanding_balances.sql',import.meta.url),'utf8'))
 await db.exec(`set role authenticated;set app.owner='owner';`)
 assert.equal((await db.query('select * from public.recurring_bills')).rows.length,1)
 for(const patch of ["outstanding_amount=-1","outstanding_amount=1.001","outstanding_amount=716","outstanding_amount='NaN'","outstanding_amount='Infinity'"]) await assert.rejects(db.exec(`update public.recurring_bills set ${patch} where id=1`))
 const valid=`outstanding_amount=716,outstanding_through='2026-11-01',outstanding_as_of='2026-11-09',outstanding_due_date='2026-08-01',outstanding_note='Four months calculated',outstanding_estimated=true`
 await db.exec(`update public.recurring_bills set ${valid} where id=1`)
 await assert.rejects(db.exec(`update public.recurring_bills set outstanding_through='2026-12-01' where id=1`))
 await assert.rejects(db.exec(`update public.recurring_bills set outstanding_note=' ' where id=1`))
 await db.exec('update public.recurring_bills set outstanding_amount=0 where id=1')
 assert.equal(Number((await db.query('select outstanding_amount from public.recurring_bills where id=1')).rows[0].outstanding_amount),0)
 await db.exec(`update public.recurring_bills set amount=999 where id=2;reset role`)
 assert.equal(Number((await db.query('select amount from public.recurring_bills where id=2')).rows[0].amount),50)
 } finally {await db.close()}
})
