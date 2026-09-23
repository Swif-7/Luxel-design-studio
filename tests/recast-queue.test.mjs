import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as core from '../src/recast-core.js';
class Element {
  constructor(){ this.hidden=false; this.dataset={}; this.style={setProperty(){}}; this.classList={remove(){},toggle(){}}; this.children=[]; this.attrs={}; }
  querySelector(){ return new Element(); }
  appendChild(e){this.children.push(e)}
  setAttribute(k,v){this.attrs[k]=v}
  removeAttribute(k){delete this[k]}
  remove(){}
  click(){}
}
async function setup() {
  const nodes=new Map(); const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
  const workers=[]; const timers=new Map(); let timerId=0;
  class Worker {
    constructor(){ workers.push(this); }
    postMessage(job){this.job=job}
    terminate(){this.terminated=true}
    reply(size=120){this.onmessage?.({data:{id:this.job.id,ok:true,blob:new Blob([new Uint8Array(size)],{type:this.job.options.mime}),width:100,height:100,srcWidth:100,srcHeight:100}})}
  }
  const ctx=vm.createContext({...core,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Worker,
    document:{getElementById:get,documentElement:{dataset:{}},querySelector:()=>new Element(),querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener(){},body:new Element()},
    matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem(){return null},setItem(){}},navigator:{hardwareConcurrency:8},addEventListener(){},
    initI18n(){},mountLangSwitch(){},recast:{},
    canUseWorkers:true,probeEncoders:async()=>new Set(['image/jpeg','image/png','image/webp']),encodeImage:async()=>{throw Error('unexpected fallback')},inspectImage:async()=>({mime:'image/png',width:100,height:100}),
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)} });
  let source=await fs.readFile(new URL('../src/recast.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'').replace("new URL('./recast-worker.js', import.meta.url)","'worker'");
  const api=await vm.runInContext('(async()=>{'+source+';return {addFiles,clearAll,rerunAll,cancelProcessing,idle:()=>intakeChain,items:()=>items};})()',ctx);
  return {api,ctx,nodes,workers,timers};
}
const file=()=>Object.assign(new Blob([new Uint8Array(100)],{type:'image/png'}),{name:'a.png'});
test('changing quality invalidates completed result before debounce; always exports encoded bytes',async()=>{
  const {api,nodes,workers}=await setup();api.addFiles([file()]);await api.idle();
  workers[0].reply(120);
  assert.equal(api.items()[0].out.size,120);
  assert.equal(nodes.get('download').disabled,false);
  nodes.get('quality').oninput({target:{value:'20'}});
  assert.equal(api.items()[0].status,'queued');
  assert.equal(api.items()[0].out,null);
  assert.equal(nodes.get('download').disabled,true);
});
test('cancel terminates worker and late replies cannot publish; retry restarts job',async()=>{
  const {api,nodes,workers}=await setup();api.addFiles([file()]);await api.idle();
  const oldReply=workers[0].onmessage,oldJob=workers[0].job;
  api.cancelProcessing();
  assert.equal(workers[0].terminated,true);
  assert.equal(api.items()[0].status,'cancelled');
  oldReply({data:{id:oldJob.id,ok:true,blob:new Blob(['old'])}});
  assert.equal(api.items()[0].status,'cancelled');
  nodes.get('retry').onclick();
  workers[1].reply(70);
  assert.equal(api.items()[0].status,'done');
  assert.equal(api.items()[0].out.size,70);
});
test('clearing cancels pending debounce and old workers, new batch completes independently',async()=>{
  const {api,nodes,workers,timers}=await setup();api.addFiles([file()]);await api.idle();
  nodes.get('quality').oninput({target:{value:'35'}});
  api.clearAll();assert.equal(timers.size,0);assert.equal(api.items().length,0);
  api.addFiles([file()]);await api.idle();
  workers.at(-1).reply(60);assert.equal(api.items()[0].out.size,60);
});
