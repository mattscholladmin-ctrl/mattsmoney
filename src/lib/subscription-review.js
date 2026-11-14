// @ts-nocheck
import { billOccurrences, isAppleMerchant, merchantMatchesBill, normalizeMerchant, parseAppleSplit, unpaidBills } from './budget.js'
import { isoDate } from './format.js'

const days = 86400000
function monthBounds(month) {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(year,number-1,1,12)
  const last = new Date(year,number,0,12)
  return {start:isoDate(first),end:isoDate(last),length:last.getDate()}
}

export function subscriptionReview(bills, transactions, month, today, payday) {
  const {start,end,length} = monthBounds(month)
  const subscriptions = bills.filter(bill => /^subscriptions?$/i.test(String(bill.category || '').trim()))
  const active = subscriptions.filter(bill => bill.active !== false)
  const posted = transactions.filter(t => !t.pending && t.status !== 'pending' && Number(t.amount)>0 &&
    t.txn_date>=start && t.txn_date<=end && t.txn_date<=today && !/\bpayment-review:one-off\b/.test(t.note || ''))
  const rows = subscriptions.map(bill => {
    const occurrences = billOccurrences(bill,start,length-1)
    const charges = posted.flatMap(t => {
      const match = t.payment_match
      const split = parseAppleSplit(t.note)
      if (match) return match.kind==='bill' && match.id===bill.id ? [{...t,amount:Number(match.amount),confirmed:true,partial:!match.complete}] : []
      if (split) return split.parts.filter(p=>p.id===bill.id).map(p=>({...t,amount:p.amount,confirmed:true}))
      const linkedBill = t.bill_id || String(t.note || '').match(/(?:^|\s)paid:([^@\s]+)/)?.[1]
      if (linkedBill) return linkedBill===bill.id ? [{...t,amount:Number(t.amount),confirmed:true}] : []
      if (isAppleMerchant(t.merchant) || /\bapple-reviewed:/.test(t.note || '')) return []
      if (!merchantMatchesBill(bill.name,t.merchant)) return []
      const isNearDue = occurrences.some(due=>Math.abs(Date.parse(t.txn_date)-Date.parse(due))<=5*days)
      if (!isNearDue) return []
      const sameAmount = Math.abs(Number(t.amount)-Number(bill.amount))<0.01
      if (sameAmount) return [{...t,amount:Number(t.amount),confirmed:false}]
      if (normalizeMerchant(bill.name)!==normalizeMerchant(t.merchant)) return []
      return [{...t,amount:Number(t.amount),confirmed:false,possibleChange:true}]
    }).sort((a,b)=>b.txn_date.localeCompare(a.txn_date))
    const renewal = charges.find(t=>!t.possibleChange)
    const changes = month===today.slice(0,7) ? charges.filter(t=>t.possibleChange && (!renewal || t.txn_date>renewal.txn_date)) : []
    return {bill,renewal,changes}
  }).sort((a,b)=>Number(a.bill.active===false)-Number(b.bill.active===false) || a.bill.name.localeCompare(b.bill.name))
  const horizon = payday ? Math.max(0,Math.round((Date.parse(payday)-Date.parse(today))/days)) : 0
  const due = payday ? unpaidBills(active,transactions,today,horizon)
    .filter(item=>!item.preStart && item.date<=payday) : []
  return {rows,due}
}
