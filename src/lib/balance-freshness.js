import { latestByAccount, countsAsSpendable } from './budget.js';
/** @param {any} data @param {number} [now] */
export function balanceFreshness(data, now=Date.now()) {
  const banks=(data.accounts || []).filter((/** @type {any} */ a)=>a.plaid_account_id && !a.hidden && countsAsSpendable(a));
  if (!banks.length) return null;
  /** @type {Record<string,any>} */
  const latest=latestByAccount(data.balances || []);
  const stamps=banks.map((/** @type {any} */ a)=>Date.parse(latest[a.id]?.created_at || `${latest[a.id]?.as_of}T00:00:00`));
  const checked=data.bankCheckedAt ? Date.parse(data.bankCheckedAt) : stamps.every(Number.isFinite) ? Math.min(...stamps) : NaN;
  return {checkedAt:Number.isFinite(checked) ? new Date(checked).toISOString() : null,stale:!Number.isFinite(checked) || now-checked>300000};
}
