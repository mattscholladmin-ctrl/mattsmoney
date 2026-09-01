// Daily cloud "sender" — Vercel Cron hits this once a day (see vercel.json).
// It checks each user's bills, balance, phases and paychecks against their
// notification toggles, and pushes alerts to their opted-in devices.
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import {
  currentBalance,
  upcomingBills,
  unpaidBills,
  upcomingIncome,
  spendableToday,
  phaseStatus,
  spendByCategory,
} from '../src/lib/budget.js'
import { isoDate, shortDate, money } from '../src/lib/format.js'

function groupBy(rows, key) {
  const map = {}
  for (const r of rows) {
    ;(map[r[key]] ||= []).push(r)
  }
  return map
}

export default async function handler(req, res) {
  // Only Vercel Cron (or someone with the secret) may trigger this.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:budget@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const [settings, subs, bills, balances, income, phases, budgets, transactions] = await Promise.all([
    supabase.from('settings').select('*'),
    supabase.from('push_subscriptions').select('*'),
    supabase.from('recurring_bills').select('*'),
    supabase.from('balance_entries').select('*'),
    supabase.from('income_sources').select('*'),
    supabase.from('phases').select('*'),
    supabase.from('budgets').select('*'),
    supabase.from('transactions').select('*'),
  ])

  const firstError =
    settings.error || subs.error || bills.error || balances.error || income.error || phases.error
  if (firstError) return res.status(500).json({ error: firstError.message })

  const today = isoDate()
  const subsByUser = groupBy(subs.data || [], 'user_id')
  const billsByUser = groupBy(bills.data || [], 'user_id')
  const balancesByUser = groupBy(balances.data || [], 'user_id')
  const incomeByUser = groupBy(income.data || [], 'user_id')
  const phasesByUser = groupBy(phases.data || [], 'user_id')
  const budgetsByUser = groupBy(budgets.data || [], 'user_id')
  const txnsByUser = groupBy(transactions.data || [], 'user_id')

  let sent = 0

  for (const s of settings.data || []) {
    const uid = s.user_id
    const userSubs = subsByUser[uid] || []
    if (!userSubs.length) continue

    const userBills = billsByUser[uid] || []
    const userIncome = incomeByUser[uid] || []
    const messages = []

    // Bill due soon — fires on the lead-time day (e.g. 2 days before).
    // Already-paid bills (matching payment in the feed) don't nag.
    if (s.notify_bill_due) {
      const lead = Number(s.notify_bill_days ?? 2)
      const window = unpaidBills(userBills, txnsByUser[uid] || [], today, lead)
      const target = isoDate(new Date(Date.now() + lead * 86400000))
      const due = window.filter((b) => b.date === target)
      for (const b of due) {
        messages.push({
          title: 'Bill due soon',
          body: `${b.name} (${money(b.amount)}) is due ${shortDate(b.date)}.`,
        })
      }
    }

    // Safe-to-spend low. Nudges Monday and Friday only — firing every single
    // day the condition holds trains the user to ignore it.
    if (s.notify_low_balance && [1, 5].includes(new Date().getDay())) {
      const latest = currentBalance(balancesByUser[uid] || [])
      if (latest) {
        const info = spendableToday(Number(latest.balance), {
          bills: userBills,
          incomes: userIncome,
          buckets: [],
          bufferFloor: Number(s.buffer_floor || 0),
          transactions: txnsByUser[uid] || [],
          fromIso: today,
        })
        const threshold = Number(s.low_balance_threshold ?? 100)
        if (info.spendable < threshold) {
          messages.push({
            title: 'Money is getting tight',
            body: `Safe to spend is down to ${money(info.spendable)}.`,
          })
        }
      }
    }

    // Phase change tomorrow.
    if (s.notify_phase_change) {
      const status = phaseStatus(phasesByUser[uid] || [], today)
      if (status?.next && status.daysToNext === 1) {
        messages.push({
          title: 'Phase change tomorrow',
          body: `${status.next.name} starts ${shortDate(status.next.starts_on)}.`,
        })
      }
    }

    // Paycheck expected today.
    if (s.notify_paycheck) {
      const todayIncome = upcomingIncome(userIncome, today, 0).filter((i) => i.date === today)
      for (const i of todayIncome) {
        messages.push({
          title: 'Paycheck expected today',
          body: `${i.name} (${money(i.amount)}) should land today.`,
        })
      }
    }

    // Budget category running low (~80%+ spent) or over, with days left.
    if (s.notify_budget_threshold) {
      const spent = spendByCategory(txnsByUser[uid] || [])
      const now = new Date()
      const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()
      for (const b of budgetsByUser[uid] || []) {
        const limit = Number(b.monthly_limit || 0)
        if (limit <= 0) continue
        const used = spent[b.category] || 0
        const pct = used / limit
        if (pct >= 1) {
          messages.push({
            title: `${b.category} budget is over`,
            body: `You're ${money(used - limit)} over your ${money(limit)} ${b.category} budget.`,
          })
        } else if (pct >= 0.8) {
          messages.push({
            title: `${b.category} budget running low`,
            body: `${Math.round(pct * 100)}% of your ${b.category} budget used, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`,
          })
        }
      }
    }

    // Weekly money recap — one Sunday summary of the past 7 days plus what's
    // coming. Plaid `amount` is positive for money out, negative for money in.
    if (s.notify_weekly_digest && new Date().getDay() === 0) {
      const weekAgo = isoDate(new Date(Date.now() - 7 * 86400000))
      const recent = (txnsByUser[uid] || []).filter(
        (t) => (t.txn_date || '') >= weekAgo && (t.txn_date || '') <= today
      )
      let spent = 0
      let cameIn = 0
      for (const t of recent) {
        const amt = Number(t.amount || 0)
        if (amt >= 0) spent += amt
        else cameIn += -amt
      }
      const net = cameIn - spent
      const coming = upcomingBills(userBills, today, 7)
      const comingTotal = coming.reduce((sum, b) => sum + Number(b.amount || 0), 0)
      const parts = [`Spent ${money(spent)}, in ${money(cameIn)} (net ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}).`]
      if (coming.length) {
        parts.push(`${money(comingTotal)} in bills due this week.`)
      }
      messages.push({
        title: 'Your week in money',
        body: parts.join(' '),
      })
    }

    for (const msg of messages) {
      for (const sub of userSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ ...msg, url: '/' })
          )
          sent++
        } catch (err) {
          // Device unsubscribed or expired — drop it.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      }
    }
  }

  return res.status(200).json({ ok: true, sent })
}
