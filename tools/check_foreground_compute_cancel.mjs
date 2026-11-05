/** Private real-WASM cancellation evidence; existing client/gate/worker facade. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createForegroundWorkerClient} from './browser-library-adapter/foreground-worker-client.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,output]=process.argv.slice(2);
if(!wasm||!output||fs.existsSync(output))throw Error('Need PINNED_WASM NEW_OUTPUT');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(fs.readFileSync(wasm)),'569504ce84a5083486518302c21d31e6edef2761789441212bbd2bce2a2ae14a');
const gate=createWorkerGate(),traces=[];let stopped=0;
const client=createForegroundWorkerClient({gate,rgba:true,cancellationProtocol:'cooperative-foreground-cancel-v1',createWorker(){
 const buffer=new SharedArrayBuffer(24),trace=new BigInt64Array(buffer);traces.push(trace);
 const worker=nodeTaskWorker(new URL('../tests/fixtures/foreground-protocol-thread.mjs',import.meta.url),{wasm,maxMemoryBytes:536870912,trace:buffer},64);
 return {...worker,async terminate(){await worker.terminate();stopped++;}};
}});
const input=()=>{const width=1000,height=1000,rgb=new Uint8Array(width*height*3),alpha=new Uint8Array(width*height);for(let i=0;i<alpha.length;i++){rgb[i*3]=i%251;rgb[i*3+1]=(i*3)%253;rgb[i*3+2]=(i*7)%255;alpha[i]=i%256;}return {width,height,rgb,alpha};};
let requested;
try{
 const controller=new AbortController(),pending=client.estimate(input(),{signal:controller.signal}),rejected=assert.rejects(pending,e=>e.code==='aborted');
 const deadline=Date.now()+30000;
 while(Atomics.load(traces[0],0)===0n){if(Date.now()>deadline)throw Error('enter-timeout');await new Promise(r=>setTimeout(r,1));}
 requested=process.hrtime.bigint();assert.equal(Atomics.load(traces[0],1),0n,'computation already returned');controller.abort();assert.equal(gate.getState().busy,true);await rejected;
 assert.equal(gate.getState().busy,false);assert.equal(gate.getState().blocked,false);assert.equal(stopped,1);
 const result=await client.estimate(input()),control=await client.estimate(input());assert.deepEqual(new Uint8Array(result.data),new Uint8Array(control.data));assert.equal(stopped,3);
 const times=traces.map(t=>[...t].map(String));for(const t of traces){assert.ok(t[0]>0n&&t[0]<=t[1]&&t[1]<=t[2]);}assert.ok(traces[0][2]<traces[1][0]);assert.ok(requested<traces[0][1]);
 fs.writeFileSync(output,JSON.stringify({status:'passed',dimensions:[1000,1000],timesNs:times,cancelRequestedNs:String(requested),cancelToReturnMs:Number(traces[0][1]-requested)/1e6,workersStopped:stopped,retryByteEqualToControl:true,rgbaSha256:sha(new Uint8Array(result.data)),gate:gate.getState(),limits:['Node worker_threads actual WASM, not native browser acceptance','Timestamp wrapper around unchanged runtime.estimate; no artificial delay/compute replacement','Synthetic generated RGB/alpha; not general foreground quality evidence','No GPU/model/browser started']},null,2)+'\n',{flag:'wx',mode:0o600});
}finally{await client.close();}
