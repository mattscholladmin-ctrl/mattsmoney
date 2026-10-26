import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
test('shopping isolation and compare-before-write survive simultaneous devices',async()=>{
 const db=new PGlite(),a=randomUUID(),b=randomUUID()
 try {
  await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('${a}'),('${b}');`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261026191242_shopping_state.sql',import.meta.url),'utf8'))
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}'`)
  const content={version:2,meals:[],items:[{id:'milk',name:'Milk'}],staples:[],receipts:[]}
  const save=(doc,revision)=>db.query('select * from public.save_shopping_state($1::jsonb,$2)',[JSON.stringify(doc),revision])
  assert.equal(Number((await save(content,0)).rows[0].revision),1)
  await assert.rejects(save({...content,items:[]},0),/another device/)
  assert.equal(Number((await save(content,1)).rows[0].revision),2)
  await assert.rejects(save({...content,items:[]},1),/another device/)
  await assert.rejects(save({items:[]},2),/Invalid shopping/)
  await db.exec(`set request.jwt.claim.sub='${b}'`)
  assert.equal((await db.query('select * from public.shopping_state')).rows.length,0)
  await assert.rejects(db.query('update public.shopping_state set user_id=$1 where user_id=$2',[b,a]).then(r=>{if(r.affectedRows===0)throw Error('no access')}),/no access/)
  await save({...content,items:[]},0)
  await db.exec(`set role anon;set request.jwt.claim.sub=''`)
  await assert.rejects(save(content,0),/permission denied/)
  await assert.rejects(db.query('select * from public.shopping_state'),/permission denied/)
 }finally{await db.close()}
})
