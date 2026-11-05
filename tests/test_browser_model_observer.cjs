const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const vm=require('node:vm');
const {parseArgs,copyOutput}=require('../tools/observe_browser_model_poc.cjs');
function mockPage(bytes){return {evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')(args)',{
 window:{modelPoc:{output:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}},args,Uint8Array,
 btoa:text=>Buffer.from(text,'binary').toString('base64')})};}
function fixture(t,bytes){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plan36-observer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {file:path.join(dir,'out.f32'),page:mockPage(bytes)};}

test('observation and runs pin an existing target; invalid arguments rejected',()=>{
 assert.throws(()=>parseArgs(['--output','/tmp/new']),/from-report/);
 assert.throws(()=>parseArgs(['--mode','run','--output','/tmp/new','--from-report','prior.json','--case','..']),/safe case/);
 assert.throws(()=>parseArgs(['--mode','load','--output','/tmp/new','--seconds','0']),/seconds/);
 assert.equal(parseArgs(['--mode','load','--output','/tmp/new']).mode,'load');
 assert.equal(parseArgs(['--mode','observe','--output','/tmp/new','--from-report','prior.json']).mode,'observe');
 assert.throws(()=>parseArgs(['--mode','repeat','--output','/tmp/new','--case','reference-01','--from-report','prior.json']),/fresh blank/);
 const repeat=parseArgs(['--mode','repeat','--output','/tmp/new','--case','reference-01']);
 assert.equal(repeat.mode,'repeat');assert.equal(repeat.closeBrowser,true);
});
test('browser chunks and their final partial chunk round-trip to verified disk bytes',async t=>{
 const bytes=Uint8Array.from({length:320*321*4},(_,i)=>i%251);const {file,page}=fixture(t,bytes);
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const copied=await copyOutput(page,file,{outputDtype:'float32',shape:[1,1,320,321],outputSha256:sha});
 assert.equal(copied.outputBytes,bytes.length);assert.equal(copied.outputSha256,sha);
 assert.deepEqual(fs.readFileSync(file),Buffer.from(bytes));
 await assert.rejects(copyOutput(page,file,{outputDtype:'float32',shape:[1,1,320,321],outputSha256:sha}),/EEXIST/);
});
test('incorrect digest cannot be accepted as captured output',async t=>{
 const {file,page}=fixture(t,new Uint8Array(32));
 await assert.rejects(copyOutput(page,file,{outputDtype:'float32',shape:[1,1,2,4],outputSha256:'0'.repeat(64)}),/SHA mismatch/);
});
test('shape mismatch and truncated transport are rejected',async t=>{
 const {file,page}=fixture(t,new Uint8Array(32));
 await assert.rejects(copyOutput(page,file,{outputDtype:'float32',shape:[1,1,2,5],outputSha256:'unused'}),/byte\/shape/);
 const broken={evaluate:async(fn,arg)=>arg?Buffer.alloc(31).toString('base64'):32};
 await assert.rejects(copyOutput(broken,file,{outputDtype:'float32',shape:[1,1,2,4],outputSha256:'unused'}),/Truncated/);
});
