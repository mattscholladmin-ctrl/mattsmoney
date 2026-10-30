// One active reload at a time; a failed read never replaces the last good dataset.
/** @template T @param {(...args:any[])=>Promise<T>|T} read @param {(value:T)=>void} apply @param {(error:any)=>void} fail */
export function createReload(read, apply, fail) {
  /** @type {Promise<T|null>|null} */
  let running = null;
  let active=true;
  const reload = (/** @type {any[]} */ ...args) => {
    if (running) return running;
    running = Promise.resolve().then(() => read(...args)).then(value => { if(active) apply(value); return value; })
      .catch(error => { if(active) fail(error); return null; }).finally(() => { running = null; });
    return running;
  };
  reload.afterCurrent = (/** @type {any[]} */ ...args) => running ? running.then(()=>reload(...args)) : reload(...args);
  reload.close=()=>{active=false};
  reload.open=()=>{active=true};
  return reload;
}
/** @param {(day:string)=>void} onDay
 * @param {{now?:()=>Date,target?:{addEventListener:(name:string,fn:()=>void)=>void,removeEventListener:(name:string,fn:()=>void)=>void},every?:(fn:()=>void,ms:number)=>any,cancel?:(id:any)=>void}} [options]
 */
export function watchLocalDay(onDay, { now = () => new Date(), target = globalThis, every = setInterval, cancel = clearInterval } = {}) {
  const day = () => { const d=now(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  let current=day();
  const check=()=>{const next=day();if(next!==current){current=next;onDay(next);}};
  target.addEventListener('focus',check); target.addEventListener('pageshow',check);
  const timer=every(check,30000);
  return ()=>{cancel(timer);target.removeEventListener('focus',check);target.removeEventListener('pageshow',check);};
}
