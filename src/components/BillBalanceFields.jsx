// @ts-nocheck
export const initialBalance = (bill={}) => ({
  outstanding_amount: bill.outstanding_amount == null ? '' : String(bill.outstanding_amount),
  outstanding_through: bill.outstanding_through || '', outstanding_as_of: bill.outstanding_as_of || '',
  outstanding_due_date: bill.outstanding_due_date || '', outstanding_note: bill.outstanding_note || '',
  outstanding_estimated: !!bill.outstanding_estimated,
})

export default function BillBalanceFields({value,onChange}) {
  const set=(key,val)=>onChange({...value,[key]:val})
  const input='w-full rounded-lg border border-slate-300 px-3 py-2 text-base'
  return <fieldset className="space-y-2">
    <legend>Outstanding balance</legend>
    <p className="text-xs text-slate-500">Total still owed, after payments. Replaces bills through the included due date; future bills stay separate. Enter zero when settled.</p>
    <label className="block">Amount still owed<input className={input} aria-label="Outstanding balance" type="number" min="0" step="0.01" required value={value.outstanding_amount} onChange={e=>set('outstanding_amount',e.target.value)}/></label>
    {[['outstanding_due_date','Oldest unpaid due date'],['outstanding_through','Includes bills due through'],['outstanding_as_of','Balance checked on']].map(([key,label])=><label className="block" key={key}>{label}<input className={input} aria-label={label} type="date" required value={value[key]} onChange={e=>set(key,e.target.value)}/></label>)}
    <label className="block">Source or calculation<textarea className={input} aria-label="Balance source" required maxLength={1500} value={value.outstanding_note} onChange={e=>set('outstanding_note',e.target.value)}/></label>
    <label className="block"><input type="checkbox" checked={value.outstanding_estimated} onChange={e=>set('outstanding_estimated',e.target.checked)}/> Calculated estimate; provider balance unconfirmed</label>
  </fieldset>
}
