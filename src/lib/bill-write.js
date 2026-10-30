// Shared validation and optimistic concurrency for app and connector bill edits.
export const BILL_CONFLICT = 'This bill changed in another session. Your edit was not saved. Reload the latest bill and try again.';
const keys = ['name','amount','category','cadence','due_day','smooth','smooth_since','start_date','active','paid_through','partial_paid','partial_for'];
/** @param {Record<string,any>} bill */
export function billSnapshot(bill) {
  return Object.fromEntries(keys.filter(k => k in bill).map(k => [k, bill[k] ?? null]));
}
/** @param {Record<string,any>} input */
export function billFields(input) {
  const out = Object.fromEntries(keys.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
  if ('name' in out) {
    out.name = String(out.name || '').trim();
    if (!out.name) throw new Error('Enter a bill name.');
  }
  if ('amount' in out) {
    const n = typeof out.amount === 'string' && !out.amount.trim() ? NaN : Number(out.amount);
    if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(Math.round(n * 100)) || Math.abs(n * 100 - Math.round(n * 100)) > 0.000001)
      throw new Error('Enter a bill amount greater than zero, with no more than two decimal places.');
    out.amount = Math.round(n * 100) / 100;
  }
  if ('cadence' in out && !['monthly','weekly'].includes(out.cadence)) throw new Error('Choose a monthly or weekly schedule.');
  if ('due_day' in out && out.due_day != null) {
    const n = Number(out.due_day);
    if (!Number.isInteger(n) || n < 0 || n > 31 || (out.cadence === 'monthly' && n < 1) || (out.cadence === 'weekly' && n > 6)) throw new Error('Choose a valid due day.');
    out.due_day = n;
  }
  return out;
}
/** @param {any} query @param {Record<string,any>|undefined} expected */
export function expectBill(query, expected) {
  for (const [key, value] of Object.entries(expected || {})) {
    if (!keys.includes(key)) throw new Error('Invalid bill comparison.');
    query = value == null ? query.is(key, null) : query.eq(key, value);
  }
  return query;
}
/** @param {Record<string,any>|null|undefined} bill @param {Record<string,any>|undefined} expected */
export function checkBillSnapshot(bill, expected) {
  if (!bill || Object.entries(expected || {}).some(([key,value]) => (bill[key] ?? null) !== (value ?? null))) throw new Error(BILL_CONFLICT);
}
