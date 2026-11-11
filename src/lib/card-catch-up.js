const dateOk = (/** @type {any} */ s) => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s
/** @param {string} first @param {number} months */
export function planMonth(first,months) {
  const [y,m,d]=first.split('-').map(Number), end=new Date(Date.UTC(y,m+months,0)).getUTCDate()
  return new Date(Date.UTC(y,m-1+months,Math.min(d,end))).toISOString().slice(0,10)
}
/** @param {any} plan */
export function validateCatchUpPlan(plan) {
  if (plan==null) return null
  if (typeof plan!=='object' || Array.isArray(plan)) throw new Error('Enter a valid temporary card plan.')
  const {amount,first_due,count,source,regular_minimum_verified_on=null}=plan
  if (typeof amount!=='number' || !Number.isFinite(amount) || amount<=0 || !Number.isSafeInteger(Math.round(amount*100)) || Math.abs(amount*100-Math.round(amount*100))>0.000001 || !Number.isInteger(count) || count<1 || count>60 || !dateOk(first_due) || typeof source!=='string' || !source.trim() || source.length>1500 || (regular_minimum_verified_on!=null && !dateOk(regular_minimum_verified_on))) throw new Error('A card plan needs a positive amount, first due date, 1–60 payments, and its source.')
  return {amount,first_due,count,source:source.trim(),regular_minimum_verified_on}
}
/** @param {any} debt @param {string} today @param {any[]} payments @param {number} horizonDays */
export function catchUpSchedule(debt,today,payments=[],horizonDays=90) {
  const plan=validateCatchUpPlan(debt.catch_up_plan)
  if (!plan) return null
  const through=new Date(Date.parse(today+'T12:00:00Z')+Math.max(0,horizonDays)*86400000).toISOString().slice(0,10)
  const history=payments.filter(p=>p.debt_id===debt.id && p.paid_on<=today && !p.pending)
  const installments=Array.from({length:plan.count},(_,i)=>{
    const due=planMonth(plan.first_due,i)
    const paid=Math.min(plan.amount,history.filter(p=>p.note===`catch-up:${due}`).reduce((n,p)=>n+Number(p.amount || 0),0))
    return {due,amount:plan.amount,paid,remaining:Math.max(0,Math.round((plan.amount-paid)*100)/100)}
  })
  const last=installments[installments.length-1].due
  const dueDay=Number(debt.due_day)
  const regularAnchor=Number.isInteger(dueDay) && dueDay>=1 && dueDay<=31 ? `${plan.first_due.slice(0,8)}${String(dueDay).padStart(2,'0')}` : plan.first_due
  const regularStart=planMonth(regularAnchor,plan.count)
  const verified=!!(plan.regular_minimum_verified_on && plan.regular_minimum_verified_on>=last && plan.regular_minimum_verified_on<=today)
  const regular=Math.max(Number(debt.min_payment || 0),Number(debt.plan_payment || 0))
  const items=installments.filter(p=>p.remaining>0 && p.due<=through).map(p=>({date:p.due<today ? today:p.due,originalDate:p.due,amount:p.remaining,name:`${debt.name} catch-up payment`,debtId:debt.id,temporary:true,estimated:false}))
  // After the finite plan, keep the same credit card and its last known minimum.
  // It is explicitly an estimate until a new statement minimum is verified.
  const regularDates=[]
  for(let i=0;i<Math.ceil((Date.parse(through)-Date.parse(regularStart))/2419200000)+2;i++) {
    const due=planMonth(regularAnchor,plan.count+i)
    if(due>through) break
    regularDates.push(due)
  }
  const latestPast=regularDates.filter(d=>d<today).at(-1)
  for(const due of regularDates) {
    if(due<today && due!==latestPast) continue
    const recorded=history.filter(p=>!String(p.note||'').startsWith('catch-up:') && String(p.paid_on).slice(0,7)===due.slice(0,7)).reduce((n,p)=>n+Number(p.amount || 0),0)
    const remaining=Math.max(0,Math.round((regular-recorded)*100)/100)
    if(remaining>0) items.push({date:due<today ? today:due,originalDate:due,amount:remaining,name:`${debt.name} regular card payment${verified?'':' (minimum estimate)'}`,debtId:debt.id,temporary:false,estimated:!verified})
  }
  const next=installments.find(p=>p.remaining>0)
  const monthly=next ? plan.amount:regular
  const nextDue=next?.due || items.find(p=>!p.temporary)?.originalDate || regularStart
  return {plan,installments,items,completed:installments.filter(p=>p.remaining<=0).length,scheduledEnd:last,regularStart,regularMinimumEstimated:!verified,needsMinimumReview:today>last && !verified,monthly,next_due:nextDue,status:nextDue<today?'late':nextDue>today&&today<plan.first_due?'pre_start':'due'}
}

/** @param {any} debt @param {string} due @param {number} amount @param {any[]} payments */
export function validatePlanPayment(debt,due,amount,payments=[]) {
  if(!debt) throw new Error('Card no longer exists. Reload before recording a payment.')
  const plan=validateCatchUpPlan(debt.catch_up_plan)
  const exists=plan && Array.from({length:plan.count},(_,i)=>planMonth(plan.first_due,i)).includes(due)
  const paid=payments.filter(p=>p.debt_id===debt.id && p.note===`catch-up:${due}`).reduce((n,p)=>n+Number(p.amount || 0),0)
  if(!exists || !Number.isFinite(amount) || amount<=0 || amount>plan.amount-paid+0.000001 || Math.abs(amount*100-Math.round(amount*100))>0.000001) throw new Error('Choose an unpaid plan installment and an amount no greater than its remaining payment.')
}
