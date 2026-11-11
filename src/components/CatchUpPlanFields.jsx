// @ts-nocheck
export default function CatchUpPlanFields({value,onChange}) {
  const set=(k,v)=>onChange({...value,[k]:v})
  return <fieldset>
    <legend>Temporary catch-up plan</legend>
    <p className="dw-mute">These payments replace the normal minimum for the agreed dates. The remaining card balance and APR stay in place afterward.</p>
    <label className="dw-field">Plan payment<input aria-label="Catch-up payment" type="number" min="0.01" step="0.01" required value={value.amount} onChange={e=>set('amount',Number(e.target.value))}/></label>
    <label className="dw-field">First plan payment<input aria-label="First catch-up date" type="date" required value={value.first_due} onChange={e=>set('first_due',e.target.value)}/></label>
    <label className="dw-field">Number of monthly payments<input aria-label="Catch-up payment count" type="number" min="1" max="60" required value={value.count} onChange={e=>set('count',Number(e.target.value))}/></label>
    <label className="dw-field">Plan confirmation or source<textarea aria-label="Catch-up source" required maxLength={1500} value={value.source} onChange={e=>set('source',e.target.value)}/></label>
    <label className="dw-field"><span><input type="checkbox" aria-label="AutoPay confirmed for this plan" checked={!!value.autopay} onChange={e=>set('autopay',e.target.checked)}/> AutoPay confirmed for this plan only</span></label>
    <label className="dw-field">Regular minimum verified on, after the plan (optional)<input aria-label="Regular minimum verified on" type="date" value={value.regular_minimum_verified_on || ''} onChange={e=>set('regular_minimum_verified_on',e.target.value || null)}/></label>
    <p className="dw-mute">After the last agreed payment, update the regular minimum above from a new statement and enter its check date here. Until then, the last known regular minimum is only a budget estimate.</p>
  </fieldset>
}
