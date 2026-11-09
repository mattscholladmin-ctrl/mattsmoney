import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as vm from 'node:vm';
async function verify(){
  for(const filename of ['api.js','api.live.js']){
    const calls=[];let failure=true;
    const supabase={from(){throw new Error('Payment must not issue a separate table write')},async rpc(name,args){calls.push({name,args});return failure?{error:new Error('history unavailable')}:{data:{id:args.p_request_id || args.p_payment_id},error:null}}};
    const context=vm.createContext({console,Date,crypto:{randomUUID:()=> 'generated-request'},URL,process:{env:{}}});
    const helper=new vm.SourceTextModule(await readFile(new URL('../src/lib/bill-write.js',import.meta.url),'utf8'),{context});await helper.link(()=>{});await helper.evaluate();
    const api=new vm.SourceTextModule(await readFile(new URL(`../src/lib/${filename}`,import.meta.url),'utf8'),{context});
    await api.link(async spec=>{
      if(spec.includes('bill-write'))return helper;
      const names=spec.includes('supabase')?['supabase','isSupabaseConfigured']:[];
      return new vm.SyntheticModule(names,function(){for(const n of names)this.setExport(n,n==='supabase'?supabase:true)},{context});
    });await api.evaluate();
    const input={debt_id:'debt',amount:25,paid_on:'2026-11-09',note:'test',request_id:'same-request',bankLinked:false};
    await assert.rejects(api.namespace.addDebtPayment(input),/history unavailable/);
    failure=false;await api.namespace.addDebtPayment(input);
    assert.equal(calls[0].name,'record_debt_payment');assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
    assert.equal(calls[0].args.p_amount,25);assert.ok(!('bankLinked' in calls[0].args));
    failure=true;await assert.rejects(api.namespace.deleteDebtPayment('payment'),/history unavailable/);
    assert.equal(calls[2].name,'remove_debt_payment');
  }
}
if(process.argv[2]==='verify')await verify();
else test('actual payment API clients use one atomic RPC, preserve retry IDs, and surface errors',()=>execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'verify'],{stdio:'pipe'}));
