import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('database rejects invalid bill amounts atomically without changing the original bill',async()=>{
  const db=new PGlite();
  try {
    await db.exec('create table public.recurring_bills(id integer primary key,amount numeric);insert into public.recurring_bills values(1,142)');
    await db.exec(await readFile(new URL('../supabase/migrations/20261029172410_bill_amount_validation.sql',import.meta.url),'utf8'));
    for (const amount of [null,-1,0,12.345,'NaN','Infinity','-Infinity','999999999999999999999999']) {
      await assert.rejects(db.query('update public.recurring_bills set amount=$1 where id=1',[amount]),/recurring_bills_valid_amount/);
      assert.equal(Number((await db.query('select amount from public.recurring_bills where id=1')).rows[0].amount),142);
    }
    await db.query('update public.recurring_bills set amount=$1 where id=1',[142.2]);
    assert.equal(Number((await db.query('select amount from public.recurring_bills where id=1')).rows[0].amount),142.2);
  }finally{await db.close()}
});
