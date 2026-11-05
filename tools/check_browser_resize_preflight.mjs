/** Malformed receiver input must not initialize embedded WASM. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [browserBundle,output]=process.argv.slice(2);if(!browserBundle||!output||fs.existsSync(output))throw Error('Need bundle and new report');
const proofs=[],worker=nodeTaskWorker(new URL('../tests/fixtures/browser-export-thread.mjs',import.meta.url),{browserBundle,allowWasm:true},16,p=>proofs.push(p));
let terminal,stopped=false;
try{
 terminal=await new Promise((resolve,reject)=>{
  worker.addEventListener('error',()=>reject(Error('worker failed')));
  worker.addEventListener('message',event=>{if(event.data?.jobId==='invalid')resolve(event.data);});
  const data=new ArrayBuffer(1);worker.postMessage({type:'resize',jobId:'invalid',image:{width:2,height:2,format:'rgb-u8',data},options:{width:1,height:1}},[data]);
 });
 assert.deepEqual(terminal,{type:'error',jobId:'invalid',code:'invalid-resize-input'});
 assert.equal(proofs.length,1);assert.equal(proofs[0].wasmCompiles,0);assert.equal(proofs[0].networkAttempts,0);
}finally{await worker.terminate();stopped=true;}
const report={status:'passed',terminal,proof:proofs[0],terminationAwaited:stopped,limits:['Restricted VM on Node thread only, not actual browser acceptance']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
