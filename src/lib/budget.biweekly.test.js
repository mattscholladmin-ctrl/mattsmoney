import test from 'node:test';
import assert from 'node:assert/strict';
import {billOccurrences, upcomingBills, unpaidBills, isBillOccurrencePaid} from './budget.js';
import {billFields} from './bill-write.js';

test('persisted biweekly bill repeats from first date across month/year boundaries',()=>{
  const bill={id:'electric',name:'Electric',amount:60,cadence:'biweekly',start_date:'2026-11-19',due_day:1,active:true};
  assert.deepEqual(billOccurrences(bill,'2026-11-09',90),['2026-11-19','2026-12-03','2026-12-17','2026-12-31','2027-01-14','2027-01-28']);
  assert.deepEqual(billOccurrences(bill,'2026-12-04',15),['2026-12-17']);
  assert.equal(upcomingBills([bill],'2026-11-09',90).reduce((n,b)=>n+b.amount,0),360);
  assert.equal(unpaidBills([bill],[],'2026-11-09',30)[0].date,'2026-11-19');
  assert.deepEqual(billOccurrences({...bill,start_date:null},'2026-11-09',30),[]);
});
test('biweekly schedules preserve weekdays across daylight saving and validate their saved anchor',()=>{
  const old=process.env.TZ;process.env.TZ='America/Denver';
  try {
    const bill={cadence:'biweekly',start_date:'2027-02-25'};
    assert.deepEqual(billOccurrences(bill,'2027-02-25',42),['2027-02-25','2027-03-11','2027-03-25','2027-04-08']);
    assert.deepEqual(billFields({cadence:'biweekly',amount:60,start_date:'2026-11-19'}),{amount:60,cadence:'biweekly',start_date:'2026-11-19'});
    for(const start_date of [null,'','2026-02-30','invalid']) assert.throws(()=>billFields({cadence:'biweekly',start_date}));
  } finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});

test('one posted top-up cannot mark a different biweekly payment date paid',()=>{
  const bill={id:'electric',name:'Electric',amount:60,cadence:'biweekly',start_date:'2026-11-19',active:true};
  const first={...bill,billId:bill.id,date:'2026-11-19'};
  const old={txn_date:'2026-11-08',merchant:'Sangre de Cristo Electric Assn.',amount:60,pending:false};
  assert.equal(isBillOccurrencePaid(first,[old],'2026-11-09'),false);
  const paid={...old,txn_date:'2026-11-19'};
  assert.equal(isBillOccurrencePaid(first,[paid],'2026-11-19'),true);
  const next={...first,date:'2026-12-03'};
  assert.equal(isBillOccurrencePaid(next,[paid],'2026-11-20'),false);
  const afterLate={...paid,txn_date:'2026-12-01'};
  assert.equal(isBillOccurrencePaid(first,[afterLate],'2026-12-02',21),false);
  assert.equal(isBillOccurrencePaid(first,[{...afterLate,note:'paid:electric@2026-11-19'}],'2026-12-02',21),true);
  const remaining=unpaidBills([bill],[paid],'2026-11-20',30);
  assert.ok(remaining.some(b=>b.date==='2026-12-03'));
  assert.ok(remaining.every(b=>b.date>'2026-11-20'));
});
