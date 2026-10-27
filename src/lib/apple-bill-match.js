// @ts-nocheck
import {
  billOccurrences,
  isAppleMerchant,
  parseAppleSplit,
  uniqueBillForCharge,
} from "./budget.js";
import { isoDate } from "./format.js";
const day = (date, delta) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return isoDate(d);
};
export const billMatchState = (b) =>
  Object.fromEntries(
    [
      "amount",
      "cadence",
      "due_day",
      "start_date",
      "active",
      "paid_through",
      "partial_paid",
      "partial_for",
    ].map((k) => [k, b[k] ?? null]),
  );
export const transactionMatchState = (t) => ({
  note: t.note ?? null,
  amount: Number(t.amount),
  txn_date: t.txn_date,
  merchant: t.merchant,
  pending: Boolean(t.pending),
});
export function unmatchedAppleCharges(transactions = [], today = isoDate()) {
  return transactions
    .filter(
      (t) =>
        !t.pending &&
        isAppleMerchant(t.merchant) &&
        Number(t.amount) > 0 &&
        t.txn_date <= today &&
        !/\bapple-(?:split|paid|reviewed):/.test(String(t.note || "")),
    )
    .sort(
      (a, b) =>
        String(b.txn_date).localeCompare(String(a.txn_date)) ||
        String(a.id).localeCompare(String(b.id)),
    );
}
export function matchDueDates(bill, chargeDate) {
  if (
    !bill ||
    !["monthly", "weekly"].includes(bill.cadence) ||
    !Number.isInteger(Number(bill.due_day)) ||
    bill.due_day == null
  )
    return [];
  const dueDay = Number(bill.due_day);
  if (bill.cadence === "weekly" ? dueDay < 0 || dueDay > 6 : dueDay < 1 || dueDay > 31) return [];
  return billOccurrences(bill, day(chargeDate, -45), 90);
}
export function suggestedAppleParts(transaction, bills, transactions = []) {
  const eligible = bills.filter((b) => b.active !== false && Number(b.amount) > 0);
  // A saved split and a unique amount are suggestions only. No record changes here.
  const saved = [...transactions]
    .filter((t) => !t.pending && t.id !== transaction.id && isAppleMerchant(t.merchant))
    .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)))
    .map((t) => parseAppleSplit(t.note))
    .find(
      (s) =>
        s &&
        Math.round(s.total * 100) === Math.round(Number(transaction.amount) * 100) &&
        s.parts.every((p) =>
          eligible.some(
            (b) =>
              b.id === p.id && Math.round(Number(b.amount) * 100) === Math.round(p.amount * 100),
          ),
        ),
    );
  const unique = uniqueBillForCharge(eligible, transaction.amount);
  const parts = saved?.parts || (unique ? [{ id: unique.id, amount: Number(unique.amount) }] : []);
  return parts.flatMap((p) => {
    const bill = eligible.find((b) => b.id === p.id);
    const dates = matchDueDates(bill, transaction.txn_date).filter(
      (d) => !bill.paid_through || d > bill.paid_through,
    );
    dates.sort(
      (a, b) =>
        Math.abs(Date.parse(a) - Date.parse(transaction.txn_date)) -
        Math.abs(Date.parse(b) - Date.parse(transaction.txn_date)),
    );
    return dates[0] ? [{ bill_id: p.id, amount: p.amount, due_date: dates[0] }] : [];
  });
}
export function validateAppleMatch(transaction, bills, parts, mode = "match") {
  if (!["match", "not_bill"].includes(mode)) return "Invalid match.";
  if (transaction && /\bapple-(?:split|paid|reviewed):/.test(String(transaction.note || "")))
    return "Charge already reviewed.";
  if (
    !transaction ||
    !Number.isFinite(Number(transaction.amount)) ||
    transaction.pending ||
    !isAppleMerchant(transaction.merchant) ||
    !(Number(transaction.amount) > 0)
  )
    return "Choose a posted Apple charge.";
  if (mode === "not_bill") return null;
  if (!Array.isArray(parts) || !parts.length)
    return "Choose the bills and due dates this charge paid.";
  const ids = new Set();
  let total = 0;
  for (const part of parts) {
    const b = bills.find((b) => b.id === part.bill_id),
      amount = Number(part.amount);
    if (!b || b.active === false || ids.has(part.bill_id))
      return "Choose each active bill only once.";
    ids.add(part.bill_id);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
    )
      return "Every payment must be a positive amount in whole cents.";
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(part.due_date || "") ||
      !matchDueDates(b, transaction.txn_date).includes(part.due_date)
    )
      return "Choose an actual scheduled due date.";
    if (b.paid_through && part.due_date <= b.paid_through)
      return "That bill is already recorded paid through this date.";
    if (
      Number(b.partial_paid) > 0 &&
      b.partial_for &&
      b.partial_for !== part.due_date &&
      (!b.paid_through || b.partial_for > b.paid_through)
    )
      return "Finish or correct the existing partial payment before matching another due date.";
    if (
      !Number.isFinite(Number(b.amount)) ||
      Number(b.amount) <= 0 ||
      !Number.isFinite(Number(b.partial_paid || 0)) ||
      Number(b.partial_paid || 0) < 0
    )
      return "Correct the invalid bill amount or partial payment before matching.";
    const prior = b.partial_for === part.due_date ? Number(b.partial_paid || 0) : 0;
    if (Math.round((prior + amount) * 100) > Math.round(Number(b.amount) * 100))
      return "A payment exceeds the bill’s remaining amount. Correct the bill amount first if its price changed.";
    total += Math.round(amount * 100);
  }
  return total !== Math.round(Number(transaction.amount) * 100)
    ? "The selected payments must add up exactly to the posted charge."
    : null;
}
export function buildAppleMatch(transaction, bills, parts, mode = "match") {
  const error = validateAppleMatch(transaction, bills, parts, mode);
  if (error) throw Error(error);
  return {
    p_transaction_id: transaction.id,
    p_expected_transaction: transactionMatchState(transaction),
    p_mode: mode,
    p_parts:
      mode === "not_bill"
        ? []
        : parts.map((p) => ({
            ...p,
            amount: Number(p.amount),
            expected_bill: billMatchState(bills.find((b) => b.id === p.bill_id)),
          })),
  };
}
// Demo uses the same validation and creates the full next state before saving it.
export function applyDemoAppleMatch(data, payload) {
  const t = data.transactions.find((t) => t.id === payload.p_transaction_id);
  if (
    !t ||
    JSON.stringify(transactionMatchState(t)) !== JSON.stringify(payload.p_expected_transaction)
  )
    throw Error("Charge changed. Reload before matching.");
  for (const p of payload.p_parts) {
    const b = data.bills.find((b) => b.id === p.bill_id);
    if (!b || JSON.stringify(billMatchState(b)) !== JSON.stringify(p.expected_bill))
      throw Error("Bill changed. Reload before matching.");
  }
  const error = validateAppleMatch(t, data.bills, payload.p_parts, payload.p_mode);
  if (error) throw Error(error);
  const next = structuredClone(data);
  const txn = next.transactions.find((x) => x.id === t.id);
  const markers = [];
  for (const p of payload.p_parts) {
    const b = next.bills.find((b) => b.id === p.bill_id);
    const paid =
      Math.round(
        (Number(p.amount) + (b.partial_for === p.due_date ? Number(b.partial_paid || 0) : 0)) * 100,
      ) / 100;
    if (paid === Number(b.amount)) {
      b.paid_through = p.due_date;
      b.partial_paid = null;
      b.partial_for = null;
      markers.push(`paid:${b.id}@${p.due_date}`);
    } else {
      b.partial_paid = paid;
      b.partial_for = p.due_date;
    }
  }
  txn.note = [
    txn.note,
    payload.p_mode === "not_bill"
      ? "apple-reviewed:not-bill"
      : `apple-split:${payload.p_parts.map((p) => `${p.bill_id}=${Number(p.amount).toFixed(2)}`).join(",")}`,
    ...markers,
  ]
    .filter(Boolean)
    .join(" ");
  return next;
}
