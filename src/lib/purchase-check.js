// A what-if check for a new, unbudgeted purchase. Never writes budget records.
/** @param {{amount?: string | number, safeToSpend?: number, daysLeft?: number | null, missingAvailable?: string[], refreshError?: boolean | string}} [options] */
export function checkPurchase({
  amount,
  safeToSpend,
  daysLeft,
  missingAvailable = [],
  refreshError = false,
} = {}) {
  const text = String(amount ?? "").trim();
  const value = Number(text);
  if (!text || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER / 100)
    return null;
  const safe = Number(safeToSpend);
  if (!Number.isFinite(safe)) return null;
  const cost = Math.round(value * 100);
  if (!cost) return null;
  const remaining = (Math.round(safe * 100) - cost) / 100;
  const days = Number(daysLeft);
  return {
    amount: cost / 100,
    remaining,
    shortfall: Math.max(0, -remaining),
    perDay: Number.isInteger(days) && days > 0 ? Math.max(0, remaining) / days : null,
    incomplete: missingAvailable.length > 0 || Boolean(refreshError),
    fits: remaining >= 0 && missingAvailable.length === 0 && !refreshError,
  };
}
