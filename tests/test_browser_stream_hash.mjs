import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Sha256} from '../tools/browser-webgpu-poc/sha256.mjs';
import {verifyStream,validateArtifact} from '../tools/browser-webgpu-poc/verified-stream.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const stream=chunks=>new ReadableStream({start(c){for(const b of chunks)c.enqueue(b);c.close();}});
test('SHA known answers, padding boundaries, view offsets and arbitrary chunking match native crypto',()=>{
 assert.equal(new Sha256().digestHex(),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
 assert.equal(new Sha256().update(new TextEncoder().encode('abc')).digestHex(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(new Sha256().update(new Uint8Array(1e6).fill(97)).digestHex(),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
 for(const length of [1,55,56,63,64,65,119,120,127,128,129,4097,65537]) {
  const data=randomBytes(length+13).subarray(7,7+length);
  for(const step of [1,3,63,64,65,32768]) {
   const hash=new Sha256();for(let i=0;i<data.length;i+=step)hash.update(data.subarray(i,i+step));
   assert.equal(hash.digestHex(),digest(data),`${length}/${step}`);
   assert.throws(()=>hash.update(data),/finalized/);assert.throws(()=>hash.digestHex(),/finalized/);
  }
 }
});
test('stream checks length/SHA, forwards bounded chunks, and refuses extra bytes before storage write',async()=>{
 const bytes=randomBytes(129),contract={bytes:bytes.length,sha256:digest(bytes)},written=[];
 assert.deepEqual(await verifyStream(stream([bytes.subarray(0,64),bytes.subarray(64)]),contract,{write:async v=>written.push(v.length)}),contract);
 assert.deepEqual(written,[64,65]);
 await assert.rejects(verifyStream(stream([bytes.subarray(0,128)]),contract),/shorter/);
 let writes=0;await assert.rejects(verifyStream(stream([bytes]),{...contract,bytes:128},{write:async()=>writes++}),/exceeds/);assert.equal(writes,0);
 await assert.rejects(verifyStream(stream([bytes]),{...contract,sha256:'0'.repeat(64)}),/SHA mismatch/);
});
test('abort and storage failure cancel source; diagnostic file URL cannot escape origin/routes',async()=>{
 let cancelled=false;
 const source=new ReadableStream({pull(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
 const controller=new AbortController();
 await assert.rejects(verifyStream(source,{bytes:100,sha256:'0'.repeat(64)},{signal:controller.signal,write:async()=>controller.abort()}),{name:'AbortError'});assert.equal(cancelled,true);
 await assert.rejects(verifyStream(stream([new Uint8Array([1])]),{bytes:1,sha256:'0'.repeat(64)},{write:async()=>{throw Error('quota');}}),/quota/);
 const file={bytes:1,sha256:'0'.repeat(64),url:'/models/a/model.data'};
 assert.equal(validateArtifact(file,'http://127.0.0.1:17861'),'http://127.0.0.1:17861/models/a/model.data');
 for(const url of ['https://other.test/models/a','/inputs/a','/models/a?token=x','/models/a#x','/models/../inputs/a'])assert.throws(()=>validateArtifact({...file,url},'http://127.0.0.1:17861'),/allowlist/);
});
