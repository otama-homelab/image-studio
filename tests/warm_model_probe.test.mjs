import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readWarmModel,hashStored,cacheScope} from '../tools/browser-webgpu-poc/stored-model.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
 const content=[new Uint8Array([1,2,3]),new Uint8Array([4,5,6,7])];
 const config={modelId:'synthetic',files:content.map((data,i)=>({name:i?'model.onnx.data':'model.onnx',url:'/models/'+(i?'model.onnx.data':'model.onnx'),bytes:data.length,sha256:sha(data)}))};
 const entries=new Map(config.files.map((file,i)=>[file.sha256+'.bin',new Blob([content[i]])]));entries.set('ready.json',new Blob([JSON.stringify({modelId:config.modelId,files:config.files})]));
 const calls=[];const directory={async getFileHandle(name,...options){calls.push(['file',name,options]);if(!entries.has(name))throw Error('NotFoundError');return {getFile:async()=>entries.get(name)};}};
 return {config,content,entries,calls,directory,navigator:{storage:{getDirectory:async()=>({getDirectoryHandle:async(name,...options)=>{calls.push(['directory',name,options]);assert.equal(name,cacheScope);return directory;}})},locks:{request:async(name,options,run)=>{assert.equal(name,cacheScope);assert.deepEqual(options,{mode:'shared'});return run();}},get gpu(){throw Error('GPU must not be requested');}}};
}
async function withStorage(f,run){
 const saved=Object.fromEntries(['navigator','self','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{navigator:{configurable:true,value:f.navigator},self:{configurable:true,value:{location:{origin:'http://127.0.0.1:17861'}}},fetch:{configurable:true,value:()=>{throw Error('Network fallback forbidden');}}});
 try{return await run();}finally{for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
test('warm source verifies existing bytes once into owned exact-sized arrays without fetch/create/GPU',async()=>{
 const f=fixture();await withStorage(f,async()=>{const result=await readWarmModel(f.config);assert.equal(result.networkBytes,0);for(let i=0;i<2;i++){assert.deepEqual(result.files[i].data,f.content[i]);assert.equal(result.files[i].sha256,f.config.files[i].sha256);}assert.ok(f.calls.every(call=>call[2].length===0));});
 const metadata=await hashStored(f.directory,f.config.files[0]);assert.equal(metadata.bytes,3);assert.ok(!('data' in metadata));
});
test('missing receipt, changed contract, missing data, wrong bytes and wrong SHA never fall back',async()=>{
 for(const issue of ['receipt','contract','missing','length','sha']){
  const f=fixture();if(issue==='receipt')f.entries.delete('ready.json');if(issue==='contract')f.entries.set('ready.json',new Blob([JSON.stringify({modelId:'other',files:f.config.files})]));if(issue==='missing')f.entries.delete(f.config.files[1].sha256+'.bin');if(issue==='length')f.entries.set(f.config.files[1].sha256+'.bin',new Blob([new Uint8Array(2)]));if(issue==='sha')f.entries.set(f.config.files[1].sha256+'.bin',new Blob([new Uint8Array(4)]));
  await withStorage(f,async()=>{await assert.rejects(readWarmModel(f.config));});
 }
});
test('invalid diagnostic contracts are rejected before OPFS reads',async()=>{
 for(const invalid of ['origin','size','duplicate']){
  const f=fixture();if(invalid==='origin')f.config.files[0].url='https://outside.invalid/models/model.onnx';if(invalid==='size')f.config.files[0].bytes=512*1024*1024+1;if(invalid==='duplicate')f.config.files[1].sha256=f.config.files[0].sha256;
  await withStorage(f,async()=>{await assert.rejects(readWarmModel(f.config));assert.equal(f.calls.length,0);});
 }
});
test('existing warm-session page posts load and dispose only and terminates after acknowledgement',async()=>{
 const nodes={};const node=id=>nodes[id]??=( {id,textContent:''} );
 const workers=[];class Worker{constructor(){this.messages=[];this.terminated=false;workers.push(this);}postMessage(value){this.messages.push(value);}terminate(){this.terminated=true;}}
 const candidate=JSON.parse(readFileSync(new URL('../docs/browser/models.candidate.json',import.meta.url),'utf8')).models.find(model=>model.id==='onnx-birefnet-grid-03-fp32-means-01');
 const config={modelId:'synthetic',files:candidate.files,runtimeVersion:'1.31.1',precision:'float16'};
 const context={document:{querySelector:node},window:{},Worker,fetch:async()=>({ok:true,json:async()=>config}),URLSearchParams,location:{search:''},performance};
 const html=readFileSync(new URL('../tools/browser-webgpu-poc/warm-session.html',import.meta.url),'utf8'),source=html.split('<script type="module">')[1].split('</script>')[0];vm.runInNewContext(source,context);
 await node('#start').onclick();const worker=workers[0];assert.equal(worker.messages[0].modelSource,'opfs-warm');assert.equal(worker.messages[0].diagnostic,false);assert.equal(worker.messages[0].strict,true);
 worker.onmessage({data:{type:'ready',modelId:'synthetic',runtimeVersion:'1.31.1',modelSource:'opfs-warm',modelNetworkBytes:0,strict:true}});
 assert.deepEqual(worker.messages.map(message=>message.type),['load','dispose']);worker.onmessage({data:{type:'disposed',releaseMs:1}});assert.equal(context.window.warmSession.state,'complete');assert.equal(worker.terminated,true);
 await node('#start').onclick();assert.equal(workers.length,1);
});

test('warm page rejects changed HR artifacts/runtime before creating a Worker',async()=>{
 const candidate=JSON.parse(readFileSync(new URL('../docs/browser/models.candidate.json',import.meta.url),'utf8')).models.find(model=>model.id==='onnx-birefnet-grid-03-fp32-means-01');
 const html=readFileSync(new URL('../tools/browser-webgpu-poc/warm-session.html',import.meta.url),'utf8'),source=html.split('<script type="module">')[1].split('</script>')[0];
 for(const issue of ['runtime','precision','size','sha','name','missing','duplicate']){
  const config={modelId:'synthetic',files:structuredClone(candidate.files),runtimeVersion:'1.31.1',precision:'float16'};
  if(issue==='runtime')config.runtimeVersion='other';if(issue==='precision')config.precision='float32';if(issue==='size')config.files[0].bytes++;if(issue==='sha')config.files[0].sha256='0'.repeat(64);if(issue==='name')config.files[0].name='other.onnx';if(issue==='missing')config.files.pop();if(issue==='duplicate')config.files[1]=config.files[0];
  const nodes={},node=id=>nodes[id]??={textContent:''};let workers=0;
  const context={document:{querySelector:node},window:{},Worker:class{constructor(){workers++;}},fetch:async()=>({ok:true,json:async()=>config}),URLSearchParams,location:{search:''},performance};
  vm.runInNewContext(source,context);await node('#start').onclick();assert.equal(workers,0,issue);assert.equal(context.window.warmSession.state,'error');assert.equal(context.window.warmSession.events.at(-1).message,'Unexpected HR warm-session contract');
 }
});
