// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewPatch,
  persistReview,
  deferredQueue,
  deferReview,
  filterActivity,
} from "./transaction-review.js";
import { txnMeta, computeProduct } from "./dw-product.js";
const charge = {
  id: "purchase",
  amount: 19.95,
  account_id: "bank",
  merchant: "Shop",
  category: "Shopping",
  note: "receipt kept paid:bill@2026-10-01 purpose:wants",
};

test("review updates only classification and preserves bank amounts and bill markers", async () => {
  const original = structuredClone(charge);
  let call;
  const fields = await persistReview(charge, { purpose: "needs" }, async (...args) => {
    call = args;
  });
  assert.equal(fields.note, "receipt kept paid:bill@2026-10-01 purpose:needs");
  assert.deepEqual(call, [charge.id, fields, { expected_note: charge.note }]);
  assert.deepEqual(charge, original);
  assert.equal(fields.amount, undefined);
  assert.throws(() => reviewPatch(charge, { amount: 0 }), /cannot change transaction amounts/);
});
test("a failed save leaves the original transaction untouched", async () => {
  const original = structuredClone(charge);
  await assert.rejects(
    persistReview(charge, { purpose: "needs" }, async () => {
      throw new Error("Offline");
    }),
    /Offline/,
  );
  assert.deepEqual(charge, original);
});
test("pending charges cannot be reviewed as final posted purchases", async () => {
  let writes = 0;
  await assert.rejects(
    persistReview({ ...charge, pending: true }, { category: "Groceries" }, async () => writes++),
    /pending/,
  );
  assert.equal(writes, 0);
});
test("category corrections check the raw saved category rather than a display alias", () => {
  const p = reviewPatch({ ...charge, category: "FOOD_AND_DRINK" }, { category: "Dining Out" });
  assert.deepEqual(p.fields, { category: "Dining Out" });
  assert.deepEqual(p.expected, { expected_category: "FOOD_AND_DRINK" });
});
test("visibility can be saved and explicitly reversed without deleting a transaction", () => {
  const hidden = reviewPatch(charge, { hidden: true }).fields;
  const shown = reviewPatch({ ...charge, ...hidden }, { hidden: false }).fields;
  assert.equal(txnMeta({}, { ...charge, ...hidden }).hidden, true);
  assert.equal(txnMeta({}, { ...charge, ...shown }).hidden, false);
  assert.equal(shown.note.includes("paid:bill@2026-10-01"), true);
});
test("persisted corrections override old local review metadata", () => {
  const state = { meta: { purchase: { purpose: "wants", category: "Other", hidden: true } } };
  const meta = txnMeta(state, {
    ...charge,
    category: "Groceries",
    note: "purpose:needs hidden:false",
  });
  assert.equal(meta.purpose, "needs");
  assert.equal(meta.category, "Groceries");
  assert.equal(meta.hidden, false);
  assert.equal(txnMeta(state, { ...charge, note: null }).purpose, "unreviewed");
});
test("skip rotates an item to the back without losing the next item or looping early", () => {
  const rows = ["a", "b", "c"].map((id) => ({ id }));
  let deferred = deferReview([], "a");
  assert.deepEqual(
    deferredQueue(rows, deferred).map((r) => r.id),
    ["b", "c", "a"],
  );
  deferred = deferReview(deferred, "b");
  assert.deepEqual(
    deferredQueue(rows, deferred).map((r) => r.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    deferredQueue(
      rows.filter((r) => r.id !== "c"),
      deferred,
    ).map((r) => r.id),
    ["a", "b"],
  );
  deferred = deferReview(deferred, "a");
  assert.deepEqual(
    deferredQueue(
      rows.filter((r) => r.id !== "c"),
      deferred,
    ).map((r) => r.id),
    ["b", "a"],
  );
});
test("the review queue is chronological and excludes pending and reviewed items", () => {
  const transactions = [
    { id: "later", txn_date: "2026-10-18", amount: 20, merchant: "Shop" },
    { id: "earlier", txn_date: "2026-10-01", amount: 30, merchant: "Shop" },
    { id: "pending", txn_date: "2026-09-01", amount: 30, merchant: "Shop", pending: true },
    { id: "reviewed", txn_date: "2026-09-02", amount: 30, merchant: "Shop", note: "purpose:paid" },
  ];
  const result = computeProduct({ data: { transactions }, state: {}, month: "2026-10" });
  assert.deepEqual(
    result.queue.map((r) => r.id),
    ["earlier", "later"],
  );
});

test("all-activity mode retains income and payments while spending totals exclude them", () => {
  const data = {
    transactions: [
      {
        id: "purchase",
        txn_date: "2026-10-05",
        merchant: "Shop",
        amount: 50,
        category: "Shopping",
        note: "purpose:wants",
      },
      {
        id: "payment",
        txn_date: "2026-10-06",
        merchant: "Card payment",
        amount: 50,
        category: "Debt Payments",
      },
      {
        id: "income",
        txn_date: "2026-10-07",
        merchant: "Payroll",
        amount: -500,
        category: "Income",
      },
      {
        id: "transfer",
        txn_date: "2026-10-08",
        merchant: "Transfer",
        amount: 100,
        category: "Transfers",
      },
      {
        id: "hidden",
        txn_date: "2026-10-09",
        merchant: "Shop",
        amount: 20,
        category: "Shopping",
        note: "hidden:true",
      },
    ],
  };
  const product = computeProduct({ data, state: {}, month: "2026-10" });
  assert.equal(product.recentSpend, 50);
  assert.equal(filterActivity(product.txns, { scope: "all" }).length, 5);
  assert.deepEqual(
    filterActivity(product.txns, { scope: "spending" }).map((t) => t.id),
    ["purchase", "hidden"],
  );
  assert.deepEqual(
    filterActivity(product.txns, { scope: "all", month: "2026-10", category: "Income" }).map(
      (t) => t.id,
    ),
    ["income"],
  );
  assert.equal(filterActivity(product.txns, { scope: "all", month: "2026-09" }).length, 0);
});
