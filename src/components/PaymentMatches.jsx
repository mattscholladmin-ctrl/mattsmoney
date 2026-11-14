import { useRef, useState } from 'react'
import { confirmPaymentMatch, updateTransaction } from '../lib/api.js'
import { paymentSnapshot } from '../lib/payment-match.js'
import { moneyFull } from '../lib/dw-product.js'

/** @typedef {{kind:string,id:string,due:string,label:string,remaining:number,asOf?:string}} MatchOption */
/** @param {{onSaved:()=>Promise<void>|void,suggestions:{txn:Record<string,any>,options:MatchOption[],differentBills:{name:string,amount:number}[]}[]}} props */
export default function PaymentMatches({ onSaved, suggestions }) {
  const [passed,setPassed] = useState(/** @type {string[]} */ ([]))
  const [choice,setChoice] = useState(/** @type {{id:string,option:MatchOption}|null} */ (null))
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const inFlight = useRef(false)
  const row = suggestions.find(({txn}) => !passed.includes(txn.id))
  const chosen = choice?.id === row?.txn.id ? choice?.option : null

  async function save(oneOff = false) {
    if (!row || (!oneOff && !chosen) || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    const {txn} = row
    try {
      if (oneOff) {
        const note = [txn.note, 'payment-review:one-off'].filter(Boolean).join(' ')
        await updateTransaction(txn.id,{note},{expected_note:txn.note ?? null})
      } else if (chosen) await confirmPaymentMatch({
        p_transaction_id:txn.id,
        p_expected_transaction:paymentSnapshot(txn),
        p_target:{kind:chosen.kind,id:chosen.id,due:chosen.due,remaining:chosen.remaining,as_of:chosen.asOf || null},
      })
      setPassed(ids => [...ids,txn.id])
      setChoice(null)
      setMessage(oneOff ? 'Recorded as a one-off purchase.' : 'Payment matched.')
      await onSaved()
    } catch (error) {
      setMessage(error && typeof error==='object' && 'message' in error ? String(error.message) : 'Could not confirm the payment. Reload and check before retrying.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (!row && !message && !passed.length) return null
  return (
    <section className="dw-card">
      <div className="dw-k">Match a bank payment</div>
      {row && <>
        <p className="dw-mute">{row.txn.merchant} · {moneyFull(Number(row.txn.amount))} · {row.txn.txn_date}</p>
        {row.differentBills.map(bill => <p className="dw-mute" key={bill.name}>
          {bill.name} usually costs {moneyFull(bill.amount)}. Was this a one-off purchase or a bill payment?
        </p>)}
        {row.options.length>0 && <label className="dw-field">
          Apply to
          <select key={row.txn.id} value={chosen ? String(row.options.findIndex(o=>o.kind===chosen.kind && o.id===chosen.id && o.due===chosen.due)) : ''} disabled={busy}
            onChange={event => {
              const option = event.target.value === '' ? null : row.options[Number(event.target.value)]
              setChoice(option ? {id:row.txn.id,option} : null)
              setMessage('')
            }}>
            <option value="">Choose bill or card installment</option>
            {row.options.map((option,i) => (
              <option value={i} key={`${option.kind}:${option.id}:${option.due}`}>
                {option.label} · {option.kind==='balance' ? 'Outstanding balance' : option.due} · {moneyFull(option.remaining)} owed
              </option>
            ))}
          </select>
        </label>}
        {chosen && <p className="dw-mute">{moneyFull(Math.max(0,chosen.remaining-Number(row.txn.amount)))} will remain on this {chosen.kind==='card' ? 'installment' : 'bill'}.</p>}
        {!row.options.length && <p className="dw-mute">If this is a changed subscription price, review the recurring amount in Bills.</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {row.options.length>0 && <button className="dw-ctl-btn" type="button" disabled={busy || !chosen} onClick={() => save()}>Confirm match</button>}
          {row.differentBills.length>0 && <button className="dw-ctl-btn" type="button" disabled={busy} onClick={() => save(true)}>One-off purchase</button>}
          <button className="dw-ctl-btn" type="button" disabled={busy} onClick={() => {
            setPassed(ids => [...ids,row.txn.id])
            setChoice(null)
            setMessage('')
          }}>Review later</button>
        </div>
      </>}
      {!row && passed.length>0 && <button className="dw-text" type="button" onClick={() => setPassed([])}>Check for remaining suggestions</button>}
      {message && <p className="dw-mute" role="status">{message}</p>}
    </section>
  )
}
