import test from "node:test";
import assert from "node:assert/strict";
import { checkPurchase } from "./purchase-check.js";

test("purchase uses only cash left after existing commitments, never expected income", () => {
  assert.deepEqual(checkPurchase({ amount: "35.25", safeToSpend: 100, daysLeft: 5 }), {
    amount: 35.25,
    remaining: 64.75,
    shortfall: 0,
    perDay: 12.95,
    incomplete: false,
    fits: true,
  });
});
test("existing shortfall grows and cents remain exact", () => {
  const cents = checkPurchase({ amount: 0.2, safeToSpend: 0.3 });
  assert.ok(cents);
  assert.equal(cents.remaining, 0.1);
  const result = checkPurchase({ amount: 20, safeToSpend: -50, daysLeft: 4 });
  assert.ok(result);
  assert.equal(result.shortfall, 70);
  assert.ok(result);
  assert.equal(result.perDay, 0);
  assert.ok(result);
  assert.equal(result.fits, false);
});
test("missing balances or failed reload cannot return an all-clear", () => {
  for (const extra of [{ missingAvailable: ["Checking"] }, { refreshError: true }]) {
    const result = checkPurchase({ amount: 10, safeToSpend: 100, ...extra });
    assert.ok(result);
    assert.equal(result.fits, false);
    assert.ok(result);
    assert.equal(result.incomplete, true);
  }
});
test("unknown payday leaves daily allowance unknown and exact fit is permitted", () => {
  const result = checkPurchase({ amount: 100, safeToSpend: 100 });
  assert.ok(result);
  assert.equal(result.remaining, 0);
  assert.ok(result);
  assert.equal(result.fits, true);
  assert.ok(result);
  assert.equal(result.perDay, null);
});
test("rejects empty, negative, zero, subcent and nonfinite amounts", () => {
  for (const amount of ["", " ", 0, -1, "no", Infinity, NaN, 0.001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(checkPurchase({ amount, safeToSpend: 100 }), null);
  }
  assert.equal(checkPurchase({ amount: 5, safeToSpend: NaN }), null);
});
