const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../tools/browser-webgpu-poc/lifecycle-page.js'),'utf8');
const hashes=['6033bcdb6d04d768c269fd174251b93a92247f991e07d1f4e1f02d11d1e272cc','70675e6cc330c903430ee47efe2228bbe7fd2693d24515ec091a4afee2f8868d'];
function fixture(options={}){
 const buttons=Object.fromEntries(['start','cancel','status'].map(k=>[k,{}]));const calls=[];let live=0,count=0;
 class Worker{
  constructor(){assert.equal(live,0,'must terminate before next model');live++;this.index=count++;calls.push('create');}
  postMessage(data){calls.push(data.type);queueMicrotask(()=>{
   const type={load:'ready',run:'result',dispose:'disposed'}[data.type];
   this.onmessage({data:{type,jobId:data.jobId,outputSha256:options.badSha?'bad':hashes[this.index],...(type==='result'?{output:new ArrayBuffer(4)}:{})}});
  });}
  terminate(){live--;calls.push('terminate');}
 }
 const context=vm.createContext({window:{location:{search:''}},URLSearchParams,document:{querySelector:s=>buttons[s.slice(1)]},performance,Worker,
 fetch:options.fetch|| (async url=>({ok:true,json:async()=>({modelId:url,files:[],cases:[{id:'reference-01'}]})}))});vm.runInContext(source,context);
 return {buttons,calls,context,get live(){return live;},probe:context.window.lifecycleProbe};
}
test('serial lifecycle runs and disposes each model before creating the next Worker',async()=>{
 const f=fixture();await f.buttons.start.onclick();assert.equal(f.probe.state,'complete');assert.equal(f.live,0);
 assert.deepEqual(f.calls,['create','load','run','dispose','terminate','create','load','run','dispose','terminate']);
 assert.equal(f.probe.runs.length,2);assert.equal('output' in f.probe.runs[0].result,false);
});
test('a changed HR output stops the sequence and prevents the second model load',async()=>{
 const f=fixture({badSha:true});await f.buttons.start.onclick();assert.equal(f.probe.state,'error');assert.equal(f.live,0);
 assert.deepEqual(f.calls,['create','load','run','terminate']);
});
test('cancel while configuration is loading cannot create a delayed Worker',async()=>{
 let resolve;const response=new Promise(r=>resolve=r);const f=fixture({fetch:()=>response});
 const running=f.buttons.start.onclick();f.buttons.cancel.onclick();resolve({ok:true,json:async()=>({})});await running;
 assert.equal(f.probe.state,'cancelled');assert.deepEqual(f.calls,[]);assert.equal(f.live,0);
});
