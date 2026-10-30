import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as vm from 'node:vm';
async function verify() {
  for (const filename of ['api.js','api.live.js']) {
    let row={id:'bill',name:'Phone',amount:85,category:null,cadence:'monthly',due_day:8},calls=0,offline=false;
    const writes=[];
    const supabase={from(table){
      assert.equal(table,'recurring_bills');calls++;
      const filters=[];let fields={},deleting=false;
      return {update(p){fields=p;writes.push({...p});return this},delete(){deleting=true;return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},select(){return this},async maybeSingle(){
        if(offline)return {error:new Error('offline'),data:null};
        if(!row || filters.some(([k,v])=>(row[k]??null)!==v))return {data:null,error:null};
        row=deleting ? null : {...row,...fields};return {data:{id:'bill'},error:null};
      }}; }};
    const context=vm.createContext({console,Date,URL,process:{env:{}}});
    const helper=new vm.SourceTextModule(await readFile(new URL('../src/lib/bill-write.js',import.meta.url),'utf8'),{context});
    await helper.link(()=>{});await helper.evaluate();
    const api=new vm.SourceTextModule(await readFile(new URL(`../src/lib/${filename}`,import.meta.url),'utf8'),{context});
    await api.link(async spec=>{
      if(spec.includes('bill-write'))return helper;
      const names=spec.includes('supabase') ? ['supabase','isSupabaseConfigured'] : [];
      return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,name==='supabase'?supabase:true)},{context});
    });await api.evaluate();
    for(const amount of ['',-1,0,Infinity,12.345])await assert.rejects(api.namespace.updateBill('bill',{amount}));
    assert.equal(calls,0);
    const original=helper.namespace.billSnapshot(row);
    await api.namespace.updateBill('bill',{name:'Renamed'},original);
    await assert.rejects(api.namespace.updateBill('bill',{amount:90},original),/another session/);
    assert.equal(row.amount,85);assert.equal(row.name,'Renamed');
    assert.deepEqual(writes[1],{amount:90});
    offline=true;await assert.rejects(api.namespace.updateBill('bill',{amount:95},helper.namespace.billSnapshot(row)),/offline/);
    assert.equal(row.amount,85);
  }
}
if(process.argv[2]==='verify')await verify();
else test('both actual bill API clients reject invalid writes, preserve concurrent edits, and surface save failures',()=>{
  execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'verify'],{stdio:'pipe'});
});
