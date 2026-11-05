import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createSerialInference} from '../tools/browser-library-adapter/serial-inference.mjs';
import {createInferenceOperation} from '../tools/browser-library-adapter/inference-operation.mjs';
import {inferenceTransport} from '../tools/browser-library-adapter/inference-input.mjs';
function setup({refine=true,tri=[0,128,255],failMatte=false,waitHrDispose,recoverForeground}={}){
 const real=createImageRegistry(),input=real.register({width:3,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60,70,80,90).buffer},'session'),intermediate=[];
 const registry={...real,register(...args){const asset=real.register(...args);intermediate.push(asset.id);return asset;}};
 const events=[],matteInputs=[];let role=null,current=true;
 const client={async request(command){
  if(command.type==='prepare'){assert.equal(role,null);role=command.model;events.push(role+':prepare');return {type:'prepared'};}
  if(command.type==='dispose'){events.push(role+':dispose');if(role==='hr'&&waitHrDispose)await waitHrDispose;role=null;return {type:'disposed'};}
  const transport=inferenceTransport(command),received=structuredClone(transport.request,{transfer:transport.transfer});events.push(role+':infer');
  if(role==='matte'){
   matteInputs.push({alpha:[...new Uint8Array(received.hrAlpha.data)],trimap:[...new Uint8Array(received.trimap.data)]});
   if(failMatte)throw Error('private matte failure');
  }
  return {type:'result',key:command.key,alpha:{width:3,height:1,layout:'alpha-u8',data:Uint8Array.from(role==='hr'?[5,100,250]:[0,128,255]).buffer}};
 }};
 const prepareHr={type:'prepare',model:'hr',modelVersion:'set-1'},prepareMatte={type:'prepare',model:'matte',modelVersion:'set-1'};
 const execute=createSerialInference({registry,client,prepareHr,prepareMatte,recoverForeground,makeTrimap:async()=>({width:3,height:1,layout:'trimap-u8',data:Uint8Array.from(tri).buffer})});
 const context={rgbAssetId:input.id,key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},refine};
 return {execute,context,events,matteInputs,registry,input,intermediate,hooks:{isCurrent:()=>current},invalidate:()=>{current=false;}};
}
test('HR is disposed before matte preparation; original RGB and HR alpha feed refinement',async()=>{
 const f=setup(),result=await f.execute(f.context,f.hooks);
 assert.deepEqual(f.events,['hr:prepare','hr:infer','hr:dispose','matte:prepare','matte:infer','matte:dispose']);
 assert.deepEqual(f.matteInputs,[{alpha:[5,100,250],trimap:[0,128,255]}]);assert.deepEqual([...new Uint8Array(result.alpha.data)],[0,128,255]);
 assert.deepEqual([...new Uint8Array(f.registry.copy(f.input.id).data)],[10,20,30,40,50,60,70,80,90]);
 assert.equal(f.intermediate.length,1);assert.throws(()=>f.registry.get(f.intermediate[0]),e=>e.code==='image-not-found');
});
test('refinement off or missing anchors skips matte without changing HR alpha',async()=>{
 for(const options of [{refine:false},{tri:[0,255,255]},{tri:[128,255,255]},{tri:[0,128,128]}]){
  const f=setup(options),result=await f.execute(f.context,f.hooks);
  assert.deepEqual(f.events,['hr:prepare','hr:infer','hr:dispose']);assert.deepEqual([...new Uint8Array(result.alpha.data)],[5,100,250]);assert.equal(f.intermediate.length,0);
 }
});
test('next model does not prepare until awaited HR disposal completes',async()=>{
 let release;const wait=new Promise(r=>{release=r;}),f=setup({waitHrDispose:wait}),pending=f.execute(f.context,f.hooks);
 await new Promise(r=>setImmediate(r));assert.deepEqual(f.events,['hr:prepare','hr:infer','hr:dispose']);
 release();await pending;assert.ok(f.events.includes('matte:prepare'));
});
test('matte failure releases temporary HR and never returns HR as a silent fallback',async()=>{
 const f=setup({failMatte:true});await assert.rejects(f.execute(f.context,f.hooks));
 assert.equal(f.intermediate.length,1);assert.throws(()=>f.registry.get(f.intermediate[0]),e=>e.code==='image-not-found');
});
test('stale intent stops later stages and invalid trimap cannot trigger matte',async()=>{
 const f=setup();f.invalidate();await assert.rejects(f.execute(f.context,f.hooks),e=>e.code==='operation-stale');assert.equal(f.events.length,0);
 const bad=setup({tri:[0,127,255]});await assert.rejects(bad.execute(bad.context,bad.hooks),e=>e.code==='invalid-trimap');assert.equal(bad.events.includes('matte:prepare'),false);
});

test('mixed model-set versions are rejected before loading either role',async()=>{
 const f=setup();f.context.key={...f.context.key,modelVersion:'different-set'};
 await assert.rejects(f.execute(f.context,f.hooks),e=>e.code==='invalid-model-set');assert.equal(f.events.length,0);
});

test('foreground recovery follows final model disposal and preserves alpha for commit',async()=>{
 for(const options of [{refine:false},{refine:true},{refine:true,tri:[0,255,255]}]){
  let received;const childGate={marker:'existing gate'};
  const f=setup({...options,recoverForeground:async(input,hooks)=>{assert.equal(f.events.at(-1),options.refine&& !options.tri?'matte:dispose':'hr:dispose');assert.equal(hooks.workerGate,childGate);received=[...input.alpha];structuredClone(input,{transfer:[input.rgb.buffer,input.alpha.buffer]});return {width:3,height:1,format:'rgba-u8',data:new ArrayBuffer(12)};}});
  const result=await f.execute(f.context,{...f.hooks,workerGate:childGate});assert.equal(result.cutout.data.byteLength,12);assert.equal(result.alpha.data.byteLength,3);assert.deepEqual([...new Uint8Array(result.alpha.data)],received);assert.equal(f.registry.copy(f.input.id).data.byteLength,9);
 }
});
test('stale foreground result is discarded after recovery without another model request',async()=>{
 const f=setup({refine:false,recoverForeground:async()=>{f.invalidate();return {width:3,height:1,format:'rgba-u8',data:new ArrayBuffer(12)};}});
 await assert.rejects(f.execute(f.context,f.hooks),error=>error.code==='operation-stale');assert.deepEqual(f.events,['hr:prepare','hr:infer','hr:dispose']);
});
test('recovery failure or malformed output never returns raw alpha as a successful cutout',async()=>{
 for(const recoverForeground of [async()=>{throw Error('failed');},async()=>({width:3,height:1,format:'rgba-u8',data:new ArrayBuffer(1)})]){
  const f=setup({recoverForeground});await assert.rejects(f.execute(f.context,f.hooks));assert.equal(f.intermediate.length,1);assert.throws(()=>f.registry.get(f.intermediate[0]),error=>error.code==='image-not-found');
 }
});


test('retained base alpha skips background preparation with refinement on or off and rejects malformed pixels',async()=>{
 for(const refine of [true,false]){
 const registry=createImageRegistry(),asset=registry.register({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)},'photo');
 const context={rgbAssetId:asset.id,key:{inputId:'source',inferenceRevision:3,modelVersion:'set'},refine},events=[];
 const prior=()=>({width:3,height:1,layout:'alpha-u8',data:Uint8Array.of(0,120,255).buffer});
 const options={registry,prepareBackground:{type:'prepare',model:'hr',modelVersion:'set'},prepareMatte:{type:'prepare',model:'matte',modelVersion:'set'},
  client:{async request(c){events.push(c.type==='prepare'?c.model:c.type);if(c.type==='infer')return {key:c.key,alpha:prior()};}},
  getBackgroundAlpha:prior,onBackgroundAlpha(){throw Error('must not replace the retained base with matte output');},
  makeTrimap:async()=>({width:3,height:1,layout:'trimap-u8',data:Uint8Array.of(0,128,255).buffer})};
 const result=await createSerialInference(options)(context,{isCurrent:()=>true});
 assert.deepEqual(events,refine?['matte','infer','dispose']:[]);assert.deepEqual([...new Uint8Array(result.alpha.data)],[0,120,255]);
 events.length=0;await assert.rejects(createSerialInference({...options,getBackgroundAlpha:()=>({...prior(),width:2})})(context,{isCurrent:()=>true}),e=>e.code==='invalid-alpha-result');assert.deepEqual(events,[]);
 }
});


const suspensionPoints=['hr:prepare','hr:infer','hr:dispose','trimap','matte:prepare','matte:infer','matte:dispose','foreground'];
for(const point of suspensionPoints)for(const intent of ['context-change','cancel'])for(const outcome of ['resolve','reject'])test(`${intent} at ${point} discards late ${outcome} without later work or commit`,async()=>{
 const registry=createImageRegistry(),input=registry.register({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)},'session');
 let context={rgbAssetId:input.id,key:{inputId:'input',inferenceRevision:1,modelVersion:'set'},refine:true};
 let resume,reject,reached,role,commits=0,stops=0;
 const suspended=new Promise(resolve=>{reached=resolve;}),wait=new Promise((a,b)=>{resume=a;reject=b;});
 const events=[],intermediate=[],realRegister=registry.register;
 const observedRegistry={...registry,register(...args){const value=realRegister(...args);intermediate.push(value.id);return value;}};
 const boundary=async name=>{events.push(name);if(name===point){reached();await wait;}};
 const alpha=()=>({width:3,height:1,layout:'alpha-u8',data:Uint8Array.of(0,128,255).buffer});
 const execute=createSerialInference({registry:observedRegistry,prepareHr:{type:'prepare',model:'hr',modelVersion:'set'},prepareMatte:{type:'prepare',model:'matte',modelVersion:'set'},
  client:{async request(command){if(command.type==='prepare')role=command.model;await boundary(role+':'+command.type);if(command.type==='infer')return {key:command.key,alpha:alpha()};}},
  async makeTrimap(){await boundary('trimap');return {...alpha(),layout:'trimap-u8'};},
  async recoverForeground(){await boundary('foreground');return {width:3,height:1,format:'rgba-u8',data:new ArrayBuffer(12)};}
 });
 const operation=createInferenceOperation({execute,getCurrent:()=>context,cancelOwned:async()=>{stops++;},committer:{commit(){commits++;return {status:'committed'};}}});
 const pending=operation.start();await suspended;
 if(intent==='context-change')context={...context,key:{...context.key,inferenceRevision:2}};
 else await operation.cancel();
 if(outcome==='resolve')resume();else reject(Error('retired stage failure'));
 assert.equal((await pending).status,intent==='context-change'?'stale':'cancelled');assert.equal(commits,0);assert.equal(stops,1);
 assert.deepEqual(events,suspensionPoints.slice(0,suspensionPoints.indexOf(point)+1));
 assert.equal(operation.getState().running,false);assert.equal(operation.getState().stopping,false);
 for(const id of intermediate)assert.throws(()=>registry.get(id),error=>error.code==='image-not-found');
 assert.equal(registry.copy(input.id).data.byteLength,9);
});
