import { checkingBalance, computePaycheckPlan } from "./paycheck-plan.js";
import {
  accountSummaries,
  countsAsSpendable,
  upcomingIncome,
  unpaidBills,
  upcomingBills,
  isBillOccurrencePaid,
  debtsAsBills,
  totalEarmarked,
  totalSetAside,
  goalSpent,
} from "./budget.js";
import { isoDate } from "./format.js";

const cents = (/** @type {any} */ n) => Math.round(Number(n || 0) * 100);
const dayAfter = (/** @type {string} */ day, /** @type {number} */ days) => {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + days);
  return isoDate(d);
};
/** @param {{data?:any,state?:any,today?:string,horizon?:number,dailySpend?:number}} options */
export function forecastCash({
  data = {},
  state = {},
  today = isoDate(),
  horizon = 90,
  dailySpend = 0,
}) {
  const days = Math.max(1, Math.min(90, Math.trunc(horizon) || 90));
  const through = dayAfter(today, days);
  const plan = computePaycheckPlan({ data, state, todayIso: today });
  const accounts = accountSummaries(data.accounts || [], data.balances || []).filter(
    (a) => !a.hidden && countsAsSpendable(a) && !/credit|card|loan/i.test(a.kind || a.type || ""),
  );
  const missing = accounts
    .filter((a) => a.availableMissing || !Number.isFinite(a.balance))
    .map((a) => a.name);
  const protectedCash =
    Math.max(0, Number(data.settings?.buffer_floor || 0)) +
    totalEarmarked(data.goals || [], data.transactions || [], data.accounts || []) +
    totalSetAside(data.setAsides || []) +
    Number(plan.info.tripFunds || 0) +
    Number(plan.info.goalReserve || 0);
  const incomes = upcomingIncome(data.income || [], today, days, data.transactions || []).filter(
    (i) => i.date > today && i.date <= through,
  );
  const debts = (data.debts || [])
    .filter((/** @type {any} */ d) => d.active !== false && !state.planOff?.[`d-${d.id}`])
    .map((/** @type {any} */ d) => ({ ...d, smooth: false }));
  const scheduled = [...(data.bills || []), ...debtsAsBills(debts)];
  const transactions = data.transactions || [];
  const bills = [
    ...unpaidBills(scheduled, transactions, today, days).filter(
      (b) => /** @type {any} */ (b).overdue,
    ),
    ...upcomingBills(scheduled, today, days).filter((b) => {
      const source = scheduled.find((s) => s.id === b.billId);
      return (
        (!source?.paid_through || b.date > source.paid_through) &&
        !isBillOccurrencePaid(b, transactions, today)
      );
    }),
  ].filter((b) => (/** @type {any} */ (b).originalDate || b.date) <= through);
  /** @type {Map<string,number>} */
  const remainingDebt = new Map(
    debts.map((/** @type {any} */ d) => [
      `debt-${d.id}`,
      cents(Math.max(0, Number(d.balance || 0))),
    ]),
  );
  /** @type {Array<{date:string,name:string,delta:number,kind:string}>} */
  const events = [];
  for (const bill of bills.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    let amount = cents(bill.amount);
    if (remainingDebt.has(bill.billId)) {
      amount = Math.min(amount, remainingDebt.get(bill.billId) || 0);
      remainingDebt.set(bill.billId, (remainingDebt.get(bill.billId) || 0) - amount);
    }
    if (amount > 0)
      events.push({
        date: bill.date < today ? today : bill.date,
        name: bill.name,
        delta: -amount,
        kind: "bill",
      });
  }
  for (const income of incomes)
    events.push({
      date: income.date,
      name: `Expected: ${income.name}`,
      delta: cents(income.amount),
      kind: "income",
    });
  // Savings contributions are protected on each distinct payday, once even if two jobs pay that day.
  for (const goal of data.goals || []) {
    const row = plan.planRows.find((r) => r.id === `g-${goal.id}`);
    if (!row || state.planOff?.[row.id]) continue;
    const funded = Math.max(Number(goal.current || 0), goalSpent(goal.id, data.transactions || []));
    let remaining = cents(Math.max(0, Number(goal.target || 0) - funded - Number(row.share || 0)));
    for (const date of [...new Set(incomes.map((i) => i.date))]) {
      const amount = Math.min(remaining, cents(row.share));
      if (amount > 0)
        events.push({ date, name: `Reserve: ${goal.name}`, delta: -amount, kind: "goal" });
      remaining -= amount;
    }
  }
  const perDay = Math.max(0, cents(Number.isFinite(dailySpend) ? dailySpend : 0));
  for (let i = 1; i <= days; i++)
    if (perDay)
      events.push({
        date: dayAfter(today, i),
        name: "Everyday spending assumption",
        delta: -perDay,
        kind: "daily",
      });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.delta - b.delta);
  let cash = cents(checkingBalance(data)) - cents(protectedCash);
  const opening = cash;
  let lowest = cash;
  /** @type {string|null} */ let firstShortfall = cash < 0 ? today : null;
  const points = [];
  for (let i = 0; i <= days; i++) {
    const date = dayAfter(today, i);
    const entries = events.filter((e) => e.date === date);
    for (const e of entries) {
      cash += e.delta;
      lowest = Math.min(lowest, cash);
      if (cash < 0 && !firstShortfall) firstShortfall = date;
    }
    points.push({
      date,
      balance: cash / 100,
      entries: entries.map((e) => ({ ...e, delta: e.delta / 100 })),
    });
  }
  return {
    opening: opening / 100,
    protectedCash,
    ending: cash / 100,
    lowest: lowest / 100,
    firstShortfall,
    points,
    missing,
    expectedIncome: incomes.reduce((s, i) => s + Number(i.amount || 0), 0),
    through,
  };
}

/** Scheduled-payment amortization comparison; never changes a saved debt. */
/** @param {{balance:number,payment:number,apr?:number|null,extraMonthly?:number,extraNow?:number,today?:string,firstDate?:string,frequency?:string}} options */
export function estimatePayoff({balance,payment,apr=null,extraMonthly=0,extraNow=0,today=isoDate(),firstDate,frequency='monthly'}) {
  if (![balance,payment,extraMonthly,extraNow].every(Number.isFinite) || balance<0 || payment<0 || extraMonthly<0 || extraNow<0 || (apr!=null && (!Number.isFinite(apr) || apr<0 || apr>1000))) return null
  const periodsPerYear=frequency==='weekly' ? 52 : frequency==='biweekly' ? 26 : 12
  let owed=cents(balance)-Math.min(cents(balance),cents(extraNow)),interest=0,periods=0
  const pay=cents(payment + extraMonthly*12/periodsPerYear)
  while(owed>0 && periods<periodsPerYear*100) {
    const charge=Math.round(owed*Number(apr || 0)/100/periodsPerYear)
    if(pay<=charge)return {paidOff:false,months:null,periods:null,interest:null,total:null,date:null,unknownApr:apr==null}
    interest+=charge;owed=Math.max(0,owed+charge-pay);periods++
  }
  const hasFirst=Boolean(periods>0 && firstDate && firstDate>=today)
  const anchor=hasFirst ? firstDate : today
  const d=new Date(anchor+'T12:00:00')
  const intervals=Math.max(0,periods-(hasFirst ? 1 : 0))
  if(periodsPerYear!==12)d.setDate(d.getDate()+intervals*(periodsPerYear===52 ? 7 : 14))
  else {const wanted=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+intervals);d.setDate(Math.min(wanted,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()))}
  return {paidOff:owed===0,months:owed ? null : Math.ceil(periods*12/periodsPerYear),periods:owed ? null : periods,interest:interest/100,total:balance+interest/100,date:owed ? null : isoDate(d),unknownApr:apr==null}
}
/** @param {any} debt @param {string} today */
export function nextDebtDate(debt,today=isoDate()) {
  const anchor=debt.start_date && debt.start_date>today ? debt.start_date : debt.next_payment_date
  if(anchor && anchor>=today)return anchor
  const frequency=debt.pay_frequency || 'monthly'
  if(anchor && ['weekly','biweekly'].includes(frequency)) {
    let date=anchor;while(date<today)date=dayAfter(date,frequency==='weekly' ? 7 : 14);return date
  }
  const d=new Date(today+'T12:00:00'),wanted=Number(debt.due_day || 0)
  if(!Number.isInteger(wanted) || wanted<1 || wanted>31)return undefined
  const candidate=(/** @type {number} */ month) => {const date=new Date(d.getFullYear(),month,1,12);date.setDate(Math.min(wanted,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));return isoDate(date)}
  const date=candidate(d.getMonth());return date>=today ? date : candidate(d.getMonth()+1)
}
