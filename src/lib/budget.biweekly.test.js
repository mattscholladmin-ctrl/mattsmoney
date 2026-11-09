import test from 'node:test';
import assert from 'node:assert/strict';
import {billOccurrences, upcomingBills, unpaidBills} from './budget.js';
import {billFields} from './bill-write.js';

test('persisted biweekly bill repeats from first date across month/year boundaries',()=>{
  const bill={id:'electric',name:'Electric',amount:60,cadence:'biweekly',start_date:'2026-11-19',due_day:1,active:true};
  assert.deepEqual(billOccurrences(bill,'2026-11-09',90),['2026-11-19','2026-12-03','2026-12-17','2026-12-31','2027-01-14','2027-01-28']);
  assert.deepEqual(billOccurrences(bill,'2026-12-04',15),['2026-12-17']);
  assert.equal(upcomingBills([bill],'2026-11-09',90).reduce((n,b)=>n+b.amount,0),360);
  assert.equal(unpaidBills([bill],[],'2026-11-09',30)[0].originalDate,'2026-11-19');
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
