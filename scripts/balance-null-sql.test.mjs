import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { accountSummaries } from "../src/lib/budget.js";
test("a missing bank available balance persists as unknown and cannot become spendable zero or current cash", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table public.balance_entries(id integer primary key,account_id text,balance numeric not null,as_of date,created_at text,note text)",
    );
    await db.exec(
      "insert into public.balance_entries values(1,'a',125,'2026-10-26','1','Auto-synced · available')",
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/20261027013752_unknown_bank_balances.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      Number(
        (await db.query("select balance from public.balance_entries where id=1")).rows[0].balance,
      ),
      125,
    );
    await db.exec(
      "insert into public.balance_entries values(2,'a',null,'2026-10-26','2','Auto-synced · available missing · current $300.00')",
    );
    const entries = (await db.query("select *,as_of::text as as_of from public.balance_entries"))
      .rows;
    const summary = accountSummaries([{ id: "a", plaid_account_id: "plaid-a" }], entries)[0];
    assert.equal(summary.balance, null);
    assert.equal(summary.availableMissing, true);
    assert.equal(summary.bankCurrent, 300);
  } finally {
    await db.close();
  }
});
