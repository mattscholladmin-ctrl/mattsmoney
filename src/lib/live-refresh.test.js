import test from 'node:test';
import assert from 'node:assert/strict';
import { createReload, watchLocalDay } from './live-refresh.js';
test('concurrent refreshes share one read and failures preserve the last good dataset',async()=>{
  /** @type {(v:string)=>void} */ let finish=()=>{throw new Error('Read not started')};
  let reads=0, value='saved', error='', shouldFail=false;
  const reload=createReload(()=>{reads++;if(shouldFail)throw new Error('offline');return new Promise(r=>{finish=r})},v=>{value=v},e=>{error=e.message});
  const a=reload(),b=reload();assert.equal(a,b);await Promise.resolve();assert.equal(reads,1);
  finish('new record from another session');await a;assert.equal(value,'new record from another session');
  shouldFail=true;await reload();assert.equal(error,'offline');assert.equal(value,'new record from another session');
});
test('day watcher advances at midnight and month rollover, including return from a suspended session',()=>{
  let current=new Date(2026,9,31,23,59),tick=()=>{};
  /** @type {Record<string,()=>void>} */ const listeners={};
  /** @type {string[]} */ const seen=[];
  const target={addEventListener:(/** @type {string} */ n,/** @type {()=>void} */ f)=>{listeners[n]=f},removeEventListener:(/** @type {string} */ n)=>{delete listeners[n]}};
  const stop=watchLocalDay(d=>seen.push(d),{now:()=>current,target,every:f=>{tick=f;return 1},cancel:()=>{}});
  current=new Date(2026,10,1,0,1);tick();listeners.focus();assert.deepEqual(seen,['2026-11-01']);
  current=new Date(2026,10,5,9);listeners.pageshow();assert.deepEqual(seen,['2026-11-01','2026-11-05']);stop();assert.equal(Object.keys(listeners).length,0);
});
test('a refresh after a write waits for the earlier read, then fetches the new record',async()=>{
  let reads=0,value='';
  /** @type {(value:string)=>void} */ let finish=()=>{};
  const reload=createReload(()=>{reads++;return reads===1 ? new Promise(resolve=>{finish=resolve}) : Promise.resolve('saved edit')},v=>{value=String(v)},()=>{});
  const before=reload();await Promise.resolve();const after=reload.afterCurrent();
  finish('old snapshot');await before;await after;
  assert.equal(value,'saved edit');assert.equal(reads,2);
});
test('a closed dashboard cannot apply an in-flight result to an old session',async()=>{
  let value='original';
  /** @type {(value:string)=>void} */ let finish=()=>{};
  const reload=createReload(()=>new Promise(resolve=>{finish=resolve}),v=>{value=String(v)},()=>{});
  const running=reload();await Promise.resolve();reload.close();finish('late result');await running;
  assert.equal(value,'original');
});
