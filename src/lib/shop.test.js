// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyShop,addIngredients,parseIngredients,parseReceipt,remindersText,remindersUrl,importLegacyShop} from './shop.js'
test('recipe ingredients consolidate by store without guessing different quantities',()=>{
 const d=emptyShop();d.staples=['Salt']
 const a=addIngredients(d,[{name:'Rice',qty:'1 cup'},{name:'Salt',qty:'1 tsp'}],'Store')
 const b=addIngredients(a,[{name:'rice',qty:'1 cup'}],'Store')
 assert.equal(b.items.length,1);assert.equal(b.items[0].qty,'1 cup + 1 cup');assert.equal(d.items.length,0)
 const c=addIngredients(b,[{name:'Rice',qty:'1 bag'}],'Other')
 assert.equal(c.items.length,2)
})
test('custom recipes preserve named ingredients and quantities',()=>{
 assert.deepEqual(parseIngredients('Rice | 1 cup\n\nBeans | 1 can'),[{name:'Rice',qty:'1 cup'},{name:'Beans',qty:'1 can'}])
})
test('receipt draft separates total from subtotal and never invents missing totals',()=>{
 const r=parseReceipt('Market\nMilk 3.99\nBread 2.50\nSUBTOTAL 6.49\nTAX 0.32\nTOTAL $6.81\nVISA 6.81')
 assert.equal(r.total,6.81);assert.equal(r.items.length,2);assert.equal(r.merchant,'Market')
 assert.equal(parseReceipt('Market\nMilk 3.99').total,null)
})
test('Reminders receives only unchecked shopping text and encoded shortcut arguments',()=>{
 const d=addIngredients(emptyShop(),[{name:'Milk & eggs',qty:'2'}],'A Store');d.items.push({id:'old',name:'Old',checked:true})
 assert.equal(remindersText(d),'2 Milk & eggs (A Store)')
 const url=remindersUrl(d);assert.ok(url.startsWith('shortcuts://run-shortcut?'));assert.equal(new URL(url).searchParams.get('text'),'2 Milk & eggs (A Store)')
})
test('legacy import excludes fake ingredients and leaves original data intact',()=>{
 const old={meals:[],staples:['Salt'],list:[{store:'Store',items:[{name:'Ingredient A'},{name:'Milk',qty:'1',checked:false}]}]}
 const imported=importLegacyShop(old)
 assert.equal(imported.items.length,1);assert.equal(imported.items[0].name,'Milk');assert.equal(old.list[0].items.length,2)
})
