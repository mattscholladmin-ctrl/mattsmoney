// @ts-nocheck
// Export helpers: turn transactions into a CSV download, or open a clean
// printable view the user can "Save as PDF" from (works on iOS Safari too).
import { money, shortDate } from './format'

function csvCell(value) {
  let s = String(value ?? '')
  // Neutralize spreadsheet formula injection: a cell starting with = + - @ (or a
  // control char) can execute as a formula when the CSV is opened in Excel or
  // Google Sheets, and a bank-supplied merchant name could carry one. Prefix an
  // apostrophe so the cell is always treated as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  // Quote anything with a comma, quote, or newline; double internal quotes.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function transactionsToCSV(transactions = []) {
  const header = ['Date', 'Merchant', 'Amount', 'Category', 'Note']
  const lines = [header.join(',')]
  for (const t of transactions) {
    lines.push(
      [
        t.txn_date || '',
        csvCell(t.merchant || ''),
        Number(t.amount || 0).toFixed(2),
        csvCell(t.category || 'Uncategorized'),
        csvCell(t.note || ''),
      ].join(',')
    )
  }
  return lines.join('\n')
}

// Download the whole account (accounts, transactions, goals, debts, bills,
// income, budgets, etc.) as a single JSON file the user keeps as a safety net.
export function downloadBackup(data = {}) {
  const payload = {
    app: 'mattsmoney-budget',
    version: 1,
    exported_at: new Date().toISOString(),
    data,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCSV(transactions = [], filename) {
  const csv = transactionsToCSV(transactions)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `transactions-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Open a print-friendly window with a simple table and trigger the print
// dialog, where the user can choose "Save as PDF".
export function printTransactionsPDF(transactions = [], title = 'Transactions') {
  const total = transactions.reduce((s, t) => s + Number(t.amount || 0), 0)
  const rows = transactions
    .map(
      (t) => `
        <tr>
          <td>${shortDate(t.txn_date)}</td>
          <td>${escapeHtml(t.merchant || '')}</td>
          <td class="num">${money(t.amount)}</td>
          <td>${escapeHtml(t.category || 'Uncategorized')}</td>
        </tr>`
    )
    .join('')

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; color: #1e293b; padding: 24px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .sub { color: #64748b; font-size: 12px; margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
      th { color: #64748b; font-weight: 600; }
      .num { text-align: right; white-space: nowrap; }
      tfoot td { font-weight: 700; border-top: 2px solid #cbd5e1; border-bottom: none; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${transactions.length} transactions · generated ${new Date().toLocaleDateString()}</p>
    <table>
      <thead>
        <tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="2">Total</td><td class="num">${money(total)}</td><td></td></tr>
      </tfoot>
    </table>
    <script>window.onload = function () { window.print(); }</script>
  </body>
  </html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups to export a PDF.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
