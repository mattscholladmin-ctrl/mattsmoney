// Shared validation and optimistic concurrency for app and connector bill edits.
export const BILL_CONFLICT = 'This bill changed in another session. Your edit was not saved. Reload the latest bill and try again.';
export const OUTSTANDING_KEYS = ['outstanding_amount','outstanding_through','outstanding_as_of','outstanding_due_date','outstanding_note','outstanding_estimated'];
const keys = ['name','amount','category','cadence','due_day','smooth','smooth_since','start_date','active','paid_through','partial_paid','partial_for', ...OUTSTANDING_KEYS];
/** @param {Record<string,any>} bill */
export function billSnapshot(bill) {
  return Object.fromEntries(keys.filter(k => k in bill).map(k => [k, bill[k] ?? null]));
}
/** @param {Record<string,any>} input */
export function billFields(input) {
  const out = Object.fromEntries(keys.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
  if (OUTSTANDING_KEYS.some(k => k in out)) {
    if (!OUTSTANDING_KEYS.every(k => k in out)) throw new Error('Save the balance, dates, source and estimate label together.');
    const n = typeof out.outstanding_amount === 'string' && !out.outstanding_amount.trim() ? NaN : Number(out.outstanding_amount);
    if (out.outstanding_amount == null || !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n*100)) || Math.abs(n*100-Math.round(n*100)) > 0.000001) throw new Error('Enter an outstanding balance of zero or more, with at most two decimal places.');
    out.outstanding_amount = Math.round(n*100)/100;
    for (const k of ['outstanding_through','outstanding_as_of','outstanding_due_date']) {
      const s=out[k];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '') || !Number.isFinite(Date.parse(s+'T12:00:00Z')) || new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s) throw new Error('Enter valid balance dates.');
    }
    if (out.outstanding_through > out.outstanding_as_of || out.outstanding_due_date > out.outstanding_through) throw new Error('The balance date must cover the included due dates.');
    out.outstanding_note=String(out.outstanding_note || '').trim();
    if (!out.outstanding_note || out.outstanding_note.length>1500) throw new Error('Describe the balance source in 1–1500 characters.');
    if (typeof out.outstanding_estimated !== 'boolean') throw new Error('Choose confirmed or calculated balance.');
  }
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
  if ('cadence' in out && !['monthly','weekly','biweekly'].includes(out.cadence)) throw new Error('Choose a monthly, weekly, or every-two-weeks schedule.');
  if (out.cadence === 'biweekly' && (!/^\d{4}-\d{2}-\d{2}$/.test(out.start_date || '') || !Number.isFinite(Date.parse(out.start_date + 'T12:00:00Z')) || new Date(out.start_date + 'T12:00:00Z').toISOString().slice(0,10) !== out.start_date)) throw new Error('Choose the first payment date for every two weeks.');
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
