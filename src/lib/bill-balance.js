import { billFields, OUTSTANDING_KEYS } from './bill-write.js'

/** @param {Record<string,any>} bill @param {number|string} amount @param {string} today */
export function balancePayment(bill, amount, today) {
  const n=Number(amount), owed=Number(bill.outstanding_amount)
  if (bill.outstanding_amount==null || !Number.isFinite(n) || n<=0 || Math.abs(n*100-Math.round(n*100))>0.000001 || n>owed) throw new Error('Enter a payment no greater than the outstanding balance.')
  const fields=Object.fromEntries(OUTSTANDING_KEYS.map(k=>[k,bill[k]]))
  return billFields({...fields,outstanding_amount:Math.round((owed-n)*100)/100,outstanding_as_of:today,
    outstanding_note:`${bill.outstanding_note || ''}\nPayment of $${n.toFixed(2)} recorded ${today}; remaining $${(owed-n).toFixed(2)}.`.slice(-1500)})
}
