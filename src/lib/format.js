// @ts-nocheck
export function money(n) {
  const value = Number(n || 0)
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function shortDate(d) {
  const date = typeof d === 'string' ? new Date(d + 'T00:00:00') : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function isoDate(d = new Date()) {
  // YYYY-MM-DD in local time
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10)
}

export function monthKey(d = new Date()) {
  return isoDate(d).slice(0, 7) // YYYY-MM
}
