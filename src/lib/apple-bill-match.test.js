import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAppleMatch,
  applyDemoAppleMatch,
  validateAppleMatch,
  unmatchedAppleCharges,
  suggestedAppleParts,
} from "./apple-bill-match.js";
import { isBillOccurrencePaid, suggestBillPayment } from "./budget.js";
const bill = { id: "bill", amount: 9.99, cadence: "monthly", due_day: 26, active: true };
const tx = {
  id: "charge",
  merchant: "Apple.com/bill",
  amount: 9.99,
  txn_date: "2026-10-26",
  pending: false,
};
const part = { bill_id: "bill", amount: 9.99, due_date: "2026-10-26" };
test("Apple suggestions never mutate records and pending/refund/reviewed charges stay out", () => {
  const data = { transactions: [tx], bills: [bill] },
    before = JSON.stringify(data);
  assert.equal(suggestedAppleParts(tx, [bill]).length, 1);
  assert.equal(JSON.stringify(data), before);
  assert.equal(suggestedAppleParts(tx, [bill, { ...bill, id: "same-price" }]).length, 0);
  assert.deepEqual(
    unmatchedAppleCharges(
      [
        tx,
        { ...tx, id: "pending", pending: true },
        { ...tx, id: "refund", amount: -9.99 },
        { ...tx, id: "matched", note: "apple-paid:bill" },
        { ...tx, id: "future", txn_date: "2026-12-01" },
      ],
      "2026-10-26",
    ),
    [tx],
  );
});
test("exact posted payments apply once without mutating source or balances", () => {
  const data = { transactions: [tx], bills: [bill], accounts: [{ balance: 100 }] },
    before = JSON.stringify(data);
  const next = applyDemoAppleMatch(data, buildAppleMatch(tx, [bill], [part]));
  assert.equal(JSON.stringify(data), before);
  assert.equal(next.bills[0].paid_through, "2026-10-26");
  assert.deepEqual(next.accounts, data.accounts);
  assert.throws(
    () => buildAppleMatch(next.transactions[0], next.bills, [part]),
    /already reviewed/,
  );
});
test("partial payments accumulate only for the same occurrence", () => {
  const b = { ...bill, partial_paid: 5, partial_for: "2026-10-26" },
    t = { ...tx, amount: 4.99 };
  const next = applyDemoAppleMatch(
    { transactions: [t], bills: [b] },
    buildAppleMatch(t, [b], [{ ...part, amount: 4.99 }]),
  );
  assert.equal(next.bills[0].paid_through, "2026-10-26");
  assert.equal(next.bills[0].partial_paid, null);
  assert.match(
    String(validateAppleMatch(tx, [{ ...b, partial_for: "2026-09-26" }], [part])),
    /existing partial/,
  );
});
test("invalid amounts, stale bills, non-scheduled dates and overpayments cannot save", () => {
  for (const amount of [-1, 0, NaN, Infinity, 0.001])
    assert.ok(validateAppleMatch(tx, [bill], [{ ...part, amount }]));
  for (const t of [
    { ...tx, pending: true },
    { ...tx, amount: Infinity },
    { ...tx, merchant: "Other" },
  ])
    assert.ok(validateAppleMatch(t, [bill], [part]));
  assert.match(
    String(validateAppleMatch(tx, [bill], [{ ...part, due_date: "2026-10-25" }])),
    /scheduled/,
  );
  assert.match(String(validateAppleMatch(tx, [bill], [{ ...part, amount: 9.98 }])), /exactly/);
  assert.match(String(validateAppleMatch(tx, [bill], [part, part])), /only once/);
  const payload = buildAppleMatch(tx, [bill], [part]);
  assert.throws(
    () => applyDemoAppleMatch({ transactions: [tx], bills: [{ ...bill, amount: 10 }] }, payload),
    /Bill changed/,
  );
  assert.match(
    String(validateAppleMatch(tx, [{ ...bill, paid_through: "2026-10-26" }], [part])),
    /already recorded/,
  );
});

test("pending charges never pay bills; Apple merchant and amount alone never prove a subscription", () => {
  const occ = { billId: "bill", name: "Apple TV", amount: 9.99, date: "2026-10-26" };
  assert.equal(isBillOccurrencePaid(occ, [tx], "2026-10-26"), false);
  assert.equal(
    isBillOccurrencePaid(occ, [{ ...tx, note: "paid:bill@2026-10-26" }], "2026-10-26"),
    true,
  );
  assert.equal(
    isBillOccurrencePaid(
      occ,
      [{ ...tx, pending: true, note: "paid:bill@2026-10-26" }],
      "2026-10-26",
    ),
    false,
  );
  assert.equal(suggestBillPayment(occ, [{ ...tx, pending: true }], "2026-10-26"), null);
});

test("Home matching excludes old history and Apple Cash transfers", () => {
  assert.deepEqual(
    unmatchedAppleCharges(
      [
        tx,
        { ...tx, id: "old", txn_date: "2025-01-01" },
        { ...tx, id: "cash", merchant: "APPLE CASH SENT MONEY" },
      ],
      "2026-10-26",
    ),
    [tx],
  );
});
