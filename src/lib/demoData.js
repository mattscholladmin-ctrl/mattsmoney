// @ts-nocheck
// Sample data for the no-login `?demo` view (design/visual work only).
// Shapes match fetchAll(). Entirely fake — safe to ship, touches nothing real.
const iso = (d) => new Date(d).toISOString().slice(0, 10)
const addDays = (n) => iso(new Date(Date.now() + n * 86400000))
const today = iso(new Date())

export function demoData() {
  return {
    settings: { id: 'demo', buffer_floor: 200, push_enabled: false, pull_enabled: false },
    accounts: [
      { id: 'a1', name: 'SoFi SoFi Checking', kind: 'spending', sort_order: 1, include_in_spendable: true, mask: '2418', institution: 'SoFi', plaid_account_id: 'plaid_a1' },
      { id: 'a2', name: 'SoFi SoFi Savings', kind: 'savings', sort_order: 2, include_in_spendable: false, mask: '4495', institution: 'SoFi', plaid_account_id: 'plaid_a2' },
      // Long, real-world names (like the user's) so the layout is stress-tested.
      { id: 'a3', name: 'Capital One depository Account 8756', kind: 'spending', sort_order: 3, include_in_spendable: true, mask: '8756', institution: 'Capital One', plaid_account_id: 'plaid_a3' },
      // A hand-added cash account (no bank link) — powers the "Paid with" picker.
      { id: 'a4', name: 'Cash on hand', kind: 'spending', sort_order: 4, include_in_spendable: true, manual: true },
    ],
    balances: [
      { id: 'b1', account_id: 'a1', balance: 1284.56, as_of: today, note: 'Auto-synced' },
      { id: 'b2', account_id: 'a2', balance: 850.0, as_of: today, note: 'Auto-synced' },
      { id: 'b3', account_id: 'a3', balance: 312.4, as_of: today, note: 'Auto-synced' },
      { id: 'b4', account_id: 'a4', balance: 120.0, as_of: today, note: 'Balance update' },
      // Previous check-in a week ago — anchors the "since last check-in" recap.
      { id: 'b0', account_id: 'a1', balance: 1102.3, as_of: addDays(-7), note: 'Weekly check-in' },
    ],
    debts: [
      { id: 'd1', name: 'Chase Sapphire', balance: 1840.22, apr: 21.99, plan_payment: 150, min_payment: 45, due_day: 12, kind: 'card', active: true, credit_limit: 6000, original_balance: 3200 },
      // Paid every 2 weeks — exercises the frequency + next-payment-date fields.
      { id: 'd2', name: 'Amex Blue', balance: 620.5, apr: 18.49, plan_payment: 80, min_payment: 30, due_day: 20, kind: 'card', active: true, credit_limit: 3000, original_balance: 900, pay_frequency: 'biweekly', next_payment_date: addDays(4) },
      // Monthly loan whose FIRST payment is ~6 weeks out — its day-of-month (the
      // 1st) has an earlier occurrence, so this is the exact case that used to be
      // scheduled a month early. It must show on next_payment_date, not sooner.
      { id: 'd3', name: 'Friend Loan', balance: 18000, apr: 0, plan_payment: 1000, min_payment: 0, due_day: 1, pay_frequency: 'monthly', next_payment_date: addDays(40), kind: 'personal', active: true, original_balance: 20000, smooth: true, smooth_since: addDays(-30), smooth_saved: 250 },
      // Collection on a settlement plan: no monthly payment recorded, but has a
      // settlement_amount (powers the bar) + plan_end_date (powers the date).
      { id: 'd4', name: 'InDebted (Afterpay)', balance: 122.4, apr: 0, plan_payment: 0, min_payment: 0, due_day: null, kind: 'collection', active: true, is_collection: true, settlement_amount: 183.6, plan_end_date: addDays(28) },
    ],
    income: [
      { id: 'i1', name: 'Day Job', amount: 1691.55, cadence: 'biweekly', anchor_date: addDays(-13), confirmed: true },
      { id: 'i2', name: 'Photography', amount: 0, cadence: 'monthly', due_day: 15, confirmed: false },
    ],
    setAsides: [
      // Cash he already has, fenced off for a known near-term expense.
      { id: 's1', name: 'Vet visit', amount: 180, due_date: addDays(9) },
    ],
    debtPayments: [
      // Dated payment history on the Friend Loan — incl. one backdated + one extra.
      { id: 'dp1', debt_id: 'd3', amount: 200, paid_on: addDays(-8) },
      { id: 'dp2', debt_id: 'd3', amount: 200, paid_on: addDays(-38) },
      { id: 'dp3', debt_id: 'd3', amount: 250, paid_on: addDays(-2) },
    ],
    goals: [
      { id: 'g1', name: 'Emergency Fund', target: 1000, current: 420, monthly_contribution: 100, status: 'active', sort_order: 1, account_id: 'a2', target_date: addDays(90), reserved: true },
      { id: 'g2', name: 'New Camera Lens', target: 800, current: 150, monthly_contribution: 50, target_date: addDays(120), status: 'active', sort_order: 2, account_id: 'a2', created_at: addDays(-60) },
      { id: 'g3', name: 'Verizon installment', target: 359.69, current: 0, status: 'planned', target_date: addDays(11), sort_order: 3 },
      // A settlement plan series — exercises the "Edit plan" group editor.
      { id: 'g6', name: 'InDebted payment 1 of 4', target: 61.2, current: 0, status: 'done', target_date: addDays(-12), sort_order: 6 },
      { id: 'g7', name: 'InDebted payment 2 of 4', target: 61.2, current: 0, status: 'planned', target_date: addDays(2), sort_order: 7 },
      { id: 'g8', name: 'InDebted payment 3 of 4', target: 61.2, current: 0, status: 'planned', target_date: addDays(16), sort_order: 8 },
      // done 3 days ago — stays in the main list (within the 1-week grace)
      { id: 'g4', name: 'Just paid item', target: 40, current: 0, status: 'done', target_date: addDays(-3), sort_order: 4 },
      // done 10 days ago — drops into the collapsed "Completed" section
      { id: 'g5', name: 'Old paid bill', target: 50, current: 0, status: 'done', target_date: addDays(-10), sort_order: 5 },
      { id: 'g9', name: 'Christmas', target: 400, current: 80, monthly_contribution: 40, status: 'active', sort_order: 9, target_date: addDays(110), reserved: true },
    ],
    bills: [
      { id: 'bi1', name: 'Car Insurance', amount: 142, category: 'Auto', cadence: 'monthly', due_day: 4, active: true },
      { id: 'bi2', name: 'Phone', amount: 85, category: 'Utilities', cadence: 'monthly', due_day: 8, active: true },
      { id: 'bi3', name: 'Storage Unit', amount: 95, category: 'Housing', cadence: 'monthly', due_day: 2, active: true },
      { id: 'bi4', name: 'Spotify', amount: 11.99, category: 'Subscriptions', cadence: 'monthly', due_day: 22, active: true },
      { id: 'bi5', name: 'Gym', amount: 29, category: 'Health', cadence: 'monthly', due_day: 15, active: true },
    ],
    budgets: [
      { id: 'bu1', category: 'Groceries', monthly_limit: 500 },
      { id: 'bu2', category: 'Dining', monthly_limit: 200 },
      { id: 'bu3', category: 'Gas', monthly_limit: 190 },
      { id: 'bu4', category: 'Pet', monthly_limit: 150 },
    ],
    phases: [
      { id: 'p1', label: 'Survival', starts_on: addDays(-30), ends_on: addDays(20), note: 'Cover bills · EF to $1,000 · cut subscriptions' },
      { id: 'p2', label: 'Build', starts_on: addDays(21), ends_on: addDays(120), note: 'Grow the cushion' },
    ],
    buckets: [
      { id: 'bk1', name: 'Summer Trip', current: 180, target: 600, event_date: addDays(40) },
    ],
    transactions: [
      { id: 't1', txn_date: today, merchant: 'City Market', amount: 42.18, category: 'FOOD_AND_DRINK', pending: true },
      // A cash purchase paid from "Cash on hand" — deleting/editing it reverses
      // that account's balance (the "Paid with" tag drives it).
      { id: 't20', txn_date: today, merchant: 'Bird Craft', amount: 5.0, category: 'Shopping', note: 'Paid with Cash on hand' },
      { id: 't2', txn_date: addDays(-1), merchant: 'Shell', amount: 38.0, category: 'Gas' },
      { id: 't3', txn_date: addDays(-1), merchant: 'Starbucks', amount: 6.75, category: 'FOOD_AND_DRINK' },
      { id: 't4', txn_date: addDays(-2), merchant: 'PetSmart', amount: 54.2, category: 'Pet' },
      { id: 't5', txn_date: addDays(-3), merchant: 'Netflix', amount: 15.49, category: 'Subscriptions' },
      { id: 't6', txn_date: addDays(-1), merchant: 'Day Job', amount: -1691.55, category: 'Income', income_source: 'Day Job' },
      { id: 't6b', txn_date: addDays(-6), merchant: 'Mountain Dweller', amount: -240, category: 'Income', income_source: 'Photography' },
      { id: 't6c', txn_date: addDays(-2), merchant: 'Square deposit', amount: -85, category: 'Income' },
      // Tagged toward the New Camera Lens goal (g2). $300 spent vs. $150 set
      // aside, so the goal bar fills to $300 — demonstrates spending-beyond-saved.
      { id: 't7', txn_date: addDays(-2), merchant: 'B&H Photo', amount: 300, category: 'Shopping', goal_id: 'g2' },
      // Uncategorized / Plaid-coded rows to exercise auto-categorize:
      { id: 't8', txn_date: addDays(-1), merchant: 'Conoco', amount: 41.2, category: null }, // keyword → Gas
      { id: 't9', txn_date: addDays(-2), merchant: 'King Soopers', amount: 63.84, category: 'Other' }, // keyword → Food
      { id: 't10', txn_date: addDays(-3), merchant: 'Chewy.com', amount: 38.99, category: 'GENERAL_MERCHANDISE' }, // keyword → Pet
      { id: 't11', txn_date: addDays(-2), merchant: 'City Market #422', amount: 28.1, category: 'FOOD_AND_DRINK' }, // history → Food
      // A monthly subscription that isn't a bill yet — exercises recurring detection.
      { id: 't12', txn_date: addDays(-61), merchant: 'Adobe', amount: 54.99, category: 'Subscriptions' },
      { id: 't13', txn_date: addDays(-31), merchant: 'Adobe', amount: 54.99, category: 'Subscriptions' },
      { id: 't14', txn_date: addDays(-1), merchant: 'Adobe', amount: 54.99, category: 'Subscriptions' },
      // Two identical charges same day — exercises the duplicate alert.
      { id: 't15', txn_date: addDays(-2), merchant: 'Cloud Storage', amount: 9.99, category: 'Subscriptions' },
      { id: 't16', txn_date: addDays(-2), merchant: 'Cloud Storage', amount: 9.99, category: 'Subscriptions' },
      // Same purchase under a clean name + a raw bank descriptor — dedupe should
      // collapse these to ONE (keeping the clean "Threefold Bakery").
      { id: 't17', txn_date: addDays(-5), merchant: 'Threefold Bakery', amount: 5.24, category: 'FOOD_AND_DRINK' },
      { id: 't18', txn_date: addDays(-5), merchant: 'TST THREEFOLD BAKERY BRECKENRIDGE CO', amount: 5.24, category: null },
      // Pushes the Pet budget near its limit — exercises the threshold warning.
      { id: 't19', txn_date: addDays(-2), merchant: 'Mountain Vet', amount: 75.0, category: 'Pet' },
      // Nearby charges that look like unpaid bills — exercises "is this the payment?"
      { id: 't21', txn_date: addDays(-5), merchant: 'GEICO', amount: 142.0, category: 'Auto' },
      { id: 't22', txn_date: addDays(-8), merchant: 'Public Storage', amount: 95.0, category: 'Housing' },
    ],
    creditScores: [
      { id: 'cs1', score: 706, checked_on: addDays(-35), bureau: 'Equifax', model: 'VantageScore 3.0', source: 'Credit Karma' },
      { id: 'cs2', score: 718, checked_on: addDays(-3), bureau: 'Equifax', model: 'VantageScore 3.0', source: 'Credit Karma' },
      { id: 'cs3', score: 701, checked_on: addDays(-3), bureau: 'TransUnion', model: 'VantageScore 3.0', source: 'Credit Karma' },
      { id: 'cs4', score: 724, checked_on: addDays(-10), bureau: 'Experian', model: 'FICO 8', source: 'Experian.com' },
    ],
    creditMilestones: [
      { id: 'cm1', name: 'Today (baseline)', target_score: 718, target_date: addDays(-3), achieved: true, sort_order: 1 },
      { id: 'cm2', name: 'Cards under 30% utilization', target_score: 740, target_date: addDays(60), achieved: false, sort_order: 2 },
      { id: 'cm3', name: 'Chase Sapphire under $1,000', target_score: 760, target_date: addDays(180), achieved: false, sort_order: 3 },
      { id: 'cm4', name: 'InDebted settled, two years clean', target_score: 780, target_date: addDays(400), achieved: false, sort_order: 4 },
    ],
    creditTasks: [
      { id: 'ct1', phase: 'This month', label: 'Keep Chase Sapphire and Amex current — zero missed payments', sort_order: 1, done: false },
      { id: 'ct2', phase: 'This month', label: 'Finish InDebted settlement (payment 2 of 4 is due soon)', sort_order: 2, done: false },
      { id: 'ct3', phase: 'This month', label: 'Autopay the full Amex statement', sort_order: 3, done: true },
      { id: 'ct4', phase: 'Next 90 days', label: 'Bring Chase Sapphire utilization under 30%', sort_order: 4, done: false },
      { id: 'ct5', phase: 'Next 90 days', label: 'Log scores at each check-in so the trend is honest', sort_order: 5, done: false },
      { id: 'ct6', phase: 'Build from here', label: 'Do not open any new credit accounts', sort_order: 6, done: false },
      { id: 'ct7', phase: 'Build from here', label: 'Friend Loan on time every month', sort_order: 7, done: false },
    ],
  }
}
