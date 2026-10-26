// @ts-nocheck
import { isExpense } from "./dw-product.js";
const purposes = new Set(["needs", "wants", "savings", "unreviewed", "paid"]);
export function reviewPatch(transaction, changes) {
  if (!transaction?.id) throw new Error("Transaction is missing. Reload and try again.");
  if (transaction.pending || transaction.status === "pending")
    throw new Error("Wait for this pending transaction to post before reviewing it.");
  if (Object.keys(changes).some((key) => !["purpose", "category", "hidden"].includes(key)))
    throw new Error("Review cannot change transaction amounts or account balances.");
  const fields = {},
    expected = {};
  let note = String(transaction.note || "");
  if (changes.purpose !== undefined) {
    if (!purposes.has(changes.purpose)) throw new Error("Choose a valid purpose.");
    note = note.replace(/\bpurpose:(needs|wants|savings|unreviewed|paid)\b/gi, "").trim();
    note = `${note} purpose:${changes.purpose}`.trim();
  }
  if (changes.hidden !== undefined) {
    if (typeof changes.hidden !== "boolean") throw new Error("Choose a valid visibility setting.");
    note = note.replace(/\bhidden:(1|true|0|false)\b/gi, "").trim();
    note = `${note} hidden:${changes.hidden}`.trim();
  }
  if (note !== String(transaction.note || "")) {
    fields.note = note;
    expected.expected_note = transaction.note ?? null;
  }
  if (changes.category !== undefined) {
    const category = String(changes.category).trim();
    if (!category || category.length > 120) throw new Error("Choose a category.");
    fields.category = category;
    expected.expected_category = transaction.category ?? null;
  }
  return { fields, expected };
}
export async function persistReview(transaction, changes, write) {
  const patch = reviewPatch(transaction, changes);
  if (Object.keys(patch.fields).length) await write(transaction.id, patch.fields, patch.expected);
  return patch.fields;
}
export function deferredQueue(items, deferredIds = []) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = [...new Set(deferredIds)].filter((id) => byId.has(id));
  const skipped = new Set(ids);
  return [...items.filter((item) => !skipped.has(item.id)), ...ids.map((id) => byId.get(id))];
}
export function deferReview(deferredIds, id) {
  return [...deferredIds.filter((old) => old !== id), id];
}

export function filterActivity(
  transactions,
  { scope = "spending", month = "", category = "", purpose = "all", query = "" } = {},
) {
  const search = query.trim().toLowerCase();
  return transactions.filter(
    (t) =>
      (scope === "all" || isExpense(t)) &&
      (!month || String(t.txn_date || "").startsWith(month)) &&
      (!category || t.category === category) &&
      (purpose === "all" || t.purpose === purpose) &&
      (!search ||
        String(t.merchant || "")
          .toLowerCase()
          .includes(search)),
  );
}
