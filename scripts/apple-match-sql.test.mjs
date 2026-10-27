import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { buildAppleMatch } from "../src/lib/apple-bill-match.js";
test("Apple matching is atomic, scoped, exact, posted-only and guarded against stale or duplicate writes", async () => {
  const db = new PGlite(),
    owner = randomUUID(),
    other = randomUUID(),
    tid = randomUUID(),
    bid = randomUUID(),
    bid2 = randomUUID();
  const t = {
    id: tid,
    merchant: "Apple.com/bill",
    amount: 14.98,
    txn_date: "2026-10-26",
    pending: false,
    note: null,
  };
  const b = {
    id: bid,
    amount: 11.99,
    cadence: "monthly",
    due_day: 26,
    start_date: null,
    active: true,
    paid_through: null,
    partial_paid: null,
    partial_for: null,
  };
  const b2 = { ...b, id: bid2, amount: 2.99 };
  const parts = [
    { bill_id: bid, amount: 11.99, due_date: "2026-10-26" },
    { bill_id: bid2, amount: 2.99, due_date: "2026-10-26" },
  ];
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;
 create table public.transactions(id uuid primary key,user_id uuid,merchant text,amount numeric,txn_date date,pending boolean,note text);
 create table public.recurring_bills(id uuid primary key,user_id uuid,amount numeric,cadence text,due_day integer,start_date date,active boolean,paid_through date,partial_paid numeric,partial_for date);
 alter table public.transactions enable row level security;alter table public.recurring_bills enable row level security;
 create policy own_tx on public.transactions to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create policy own_bill on public.recurring_bills to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 grant select,update on public.transactions,public.recurring_bills to authenticated;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261027004044_confirmed_bill_matches.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/20261027005239_bill_match_validation.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query("insert into public.transactions values($1,$2,$3,$4,$5,$6,$7)", [
      tid,
      owner,
      t.merchant,
      t.amount,
      t.txn_date,
      false,
      null,
    ]);
    for (const bill of [b, b2])
      await db.query(
        "insert into public.recurring_bills values($1,$2,$3,$4,$5,null,true,null,null,null)",
        [bill.id, owner, bill.amount, bill.cadence, bill.due_day],
      );
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const payload = buildAppleMatch(t, [b, b2], parts);
    const call = (p) =>
      db.query("select public.confirm_apple_bill_match($1,$2::jsonb,$3::jsonb,$4)", [
        p.p_transaction_id,
        JSON.stringify(p.p_expected_transaction),
        JSON.stringify(p.p_parts),
        p.p_mode,
      ]);
    const state = async () =>
      JSON.stringify(
        (
          await db.query(
            "select id,paid_through,partial_paid,partial_for from public.recurring_bills order by id",
          )
        ).rows,
      );
    const baseline = await state();
    const wrong = structuredClone(payload);
    wrong.p_parts[1].amount = 2.98;
    await assert.rejects(call(wrong), /exactly/);
    assert.equal(await state(), baseline);
    const dup = structuredClone(payload);
    dup.p_parts[1] = dup.p_parts[0];
    await assert.rejects(call(dup), /only once/);
    const date = structuredClone(payload);
    date.p_parts[0].due_date = "2026-10-25";
    await assert.rejects(call(date), /scheduled/);
    await db.query("update public.transactions set pending=true where id=$1", [tid]);
    await assert.rejects(call(payload), /posted/);
    await db.query("update public.transactions set pending=false,note=$2 where id=$1", [
      tid,
      "changed elsewhere",
    ]);
    await assert.rejects(call(payload), /Charge changed/);
    await db.query("update public.transactions set note=null where id=$1", [tid]);
    await db.query("update public.recurring_bills set amount=12 where id=$1", [bid]);
    await assert.rejects(call(payload), /Bill changed/);
    assert.equal(await state(), baseline);
    await db.query("update public.recurring_bills set amount=11.99 where id=$1", [bid]);
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    await assert.rejects(call(payload), /unavailable/);
    await db.exec(`set request.jwt.claim.sub='${owner}'`);
    // A rejected write late in the operation must roll back every earlier bill update.
    await db.exec(
      `reset role;create function public.reject_test_transaction() returns trigger language plpgsql as $$begin raise exception 'forced failure';end$$;create trigger reject_transaction before update on public.transactions for each row execute function public.reject_test_transaction();set role authenticated;`,
    );
    await assert.rejects(call(payload), /forced failure/);
    assert.equal(await state(), baseline);
    await db.exec(
      "reset role;drop trigger reject_transaction on public.transactions;set role authenticated;",
    );
    await call(payload);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.recurring_bills where paid_through='2026-10-26'",
        )
      ).rows[0].n,
      2,
    );
    const saved = (await db.query("select note from public.transactions")).rows[0].note;
    assert.match(saved, /paid:.*@2026-10-26/);
    await assert.rejects(
      call({
        ...payload,
        p_expected_transaction: { ...payload.p_expected_transaction, note: saved },
      }),
      /already reviewed/,
    );
    await db.exec(`set role anon;set request.jwt.claim.sub=''`);
    await assert.rejects(call(payload), /permission denied/);
  } finally {
    await db.close();
  }
});
