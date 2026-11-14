import { useMemo, useRef, useState } from 'react'
import { updateBill } from '../lib/api.js'
import { billSnapshot } from '../lib/bill-write.js'
import { moneyFull } from '../lib/dw-product.js'
import { subscriptionReview } from '../lib/subscription-review.js'

/** @param {{bills:any[],transactions:any[],today:string,payday?:string,onChanged:()=>Promise<unknown>}} props */
export default function SubscriptionReview({ bills, transactions, today, payday, onChanged }) {
  const [selectedMonth,setSelectedMonth] = useState('')
  const month = selectedMonth || today.slice(0,7)
  const review = useMemo(() => subscriptionReview(bills,transactions,month,today,payday), [bills,transactions,month,today,payday])
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const inFlight = useRef(false)

  /** @param {any} bill @param {number|null} amount */
  async function save(bill, amount) {
    if (inFlight.current) return
    const prompt = amount===null
      ? `Stop budgeting for ${bill.name}? This records a cancellation in Matt’s Money.`
      : `Use ${moneyFull(amount)} for future ${bill.name} charges?`
    if (!window.confirm(prompt)) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    try {
      await updateBill(bill.id,amount===null ? {active:false} : {amount},billSnapshot(bill))
      await onChanged()
      setMessage(amount===null ? 'Cancellation recorded.' : 'Recurring price updated.')
    } catch (error) {
      setMessage(error && typeof error==='object' && 'message' in error ? String(error.message) : 'Could not save. Reload and try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <details className="dw-card">
      <summary className="dw-k">Monthly subscription review</summary>
      <label className="dw-field">
        Review month
        <input type="month" value={month} max={today.slice(0,7)} onChange={event=>setSelectedMonth(event.target.value)} />
      </label>
      <p className="dw-mute">{payday ? `Due through next payday (${payday})` : 'Next payday is unconfirmed.'}</p>
      {payday && review.due.length===0 && <p className="dw-mute">No tracked subscription payments due in this window.</p>}
      {review.due.length>0 && <ul>
        {review.due.map(/** @param {any} item */ item => <li key={`${item.billId}:${item.originalDate || item.date}:${!!item.outstandingBalance}`}>{item.name} · {moneyFull(item.amount)} · {item.outstandingBalance ? 'Outstanding' : item.originalDate || item.date}</li>)}
      </ul>}
      <p className="dw-mute">This review includes bills categorized as Subscriptions.</p>
      {review.rows.length===0 && <p className="dw-mute">No tracked subscriptions.</p>}
      {review.rows.map(/** @param {any} row */ ({bill,renewal,changes}) => (
        <div key={bill.id} className="dw-legend-row" style={{display:'block'}}>
          <strong>{bill.name}</strong> · {moneyFull(Number(bill.amount))} {bill.cadence==='weekly' ? 'weekly' : bill.cadence==='biweekly' ? 'every two weeks' : 'monthly'}
          <p className="dw-mute">{renewal
            ? `${renewal.partial ? 'Partial payment matched' : renewal.confirmed ? 'Payment matched' : 'Likely renewal'} · ${moneyFull(renewal.amount)} · ${renewal.txn_date}`
            : 'No renewal identified this month.'}</p>
          {bill.active===false ? <p className="dw-mute">Inactive</p> : <>
            {changes.map(/** @param {any} charge */ charge => <div key={charge.id}>
              <p className="dw-mute">Possible price change · {moneyFull(charge.amount)} · {charge.txn_date}</p>
              <button className="dw-ctl-btn" type="button" disabled={busy} onClick={()=>save(bill,charge.amount)}>Use this price</button>
            </div>)}
            <button className="dw-text" type="button" disabled={busy} onClick={()=>save(bill,null)}>Record cancellation</button>
          </>}
        </div>
      ))}
      {message && <p className="dw-mute" role="status">{message}</p>}
    </details>
  )
}
