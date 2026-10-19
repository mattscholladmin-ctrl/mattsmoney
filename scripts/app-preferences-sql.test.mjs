import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

// Runs against an isolated in-memory database. Never reads or writes production.
test('preferences SQL enforces ownership, atomic key merges, validation and first-import semantics', async () => {
  const db = new PGlite()
  try {
    const a = randomUUID(), b = randomUUID()
    await db.exec(`create role authenticated; create role anon;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${a}'), ('${b}');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261019030455_app_preferences.sql', import.meta.url), 'utf8'))
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${a}';`)
    const call = (patch, initialize = false) => db.query('select * from public.patch_app_preferences($1::jsonb,$2)', [JSON.stringify(patch), initialize])
    let r = await call({ fs: 'l', 'planOff:g-trip': true }, true)
    assert.equal(r.rows[0].preferences.fs, 'l')
    r = await call({ fs: 's' }, true)
    assert.equal(r.rows[0].preferences.fs, 'l', 'a later device cannot replace the first imported settings')
    await call({ spreadBills: false })
    r = await call({ 'plan:wants': 17 })
    assert.equal(r.rows[0].preferences.spreadBills, false)
    assert.equal(r.rows[0].preferences['planOff:g-trip'], true)
    assert.equal(r.rows[0].preferences['plan:wants'], 17)
    assert.equal(Number(r.rows[0].revision), 3)
    await assert.rejects(call({ buffer_floor: 0 }), /Unknown preference key/)
    await assert.rejects(call({ fs: 'tiny' }), /Invalid text size/)
    await assert.rejects(call({ spreadBills: 'yes' }), /Invalid switch/)
    await assert.rejects(call({ 'plan:wants': -1 }), /Invalid plan amount/)
    await db.exec(`set request.jwt.claim.sub = '${b}';`)
    assert.equal((await db.query('select * from public.app_preferences')).rows.length, 0)
    await assert.rejects(db.query('insert into public.app_preferences(user_id) values ($1)', [a]), /row-level security/)
    await call({ fs: 's' }, true)
    assert.equal((await db.query('select * from public.app_preferences')).rows.length, 1)
    await db.exec(`set role anon; set request.jwt.claim.sub = '';`)
    await assert.rejects(call({ fs: 'm' }), /permission denied/)
    await assert.rejects(db.query('select * from public.app_preferences'), /permission denied/)
  } finally { await db.close() }
})
