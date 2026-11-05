const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {downloadDirectory,createTaskDownloads}=require('../tools/browser_download_transport.cjs');
const profile='C:\\Users\\tester\\AppData\\Local\\Temp\\image-studio-plan36-test',token='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',guid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
function fixture(){const session=new EventEmitter(),calls=[],copies=[],states=[];session.send=async(method,args)=>calls.push({method,args});session.detach=async()=>{};
 const io={mkdirSync(){},rmSync(){},lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,size:64}),copyFileSync:(source,target)=>copies.push({source,target}),unlinkSync(){}};
 return {session,calls,copies,states,io,browser:{newBrowserCDPSession:async()=>session}};}
test('maps only a scoped Windows task directory; no shell or normal browser paths',()=>{
 const d=downloadDirectory(profile,token);assert.ok(d.windows.startsWith(profile+'-downloads-'));assert.ok(d.local.startsWith('/mnt/c/Users/tester/AppData/Local/Temp/'));
 for(const bad of ['C:\\Users\\tester\\Chrome',profile+'\\..',profile.replace('tester','..')])assert.throws(()=>downloadDirectory(bad,token));
 assert.throws(()=>downloadDirectory(profile,'../unsafe'));
});
test('uses native absolute path and copies only after completed bytes agree',async()=>{
 const f=fixture(),bridge=await createTaskDownloads(f.browser,profile,{io:f.io,token,onState:s=>f.states.push(s)});
 assert.equal(f.calls[0].args.downloadPath,downloadDirectory(profile,token).windows);
 const result=await bridge.saveFromClick(async()=>{f.session.emit('Browser.downloadWillBegin',{guid,url:'blob:https://example.invalid/id'});f.session.emit('Browser.downloadProgress',{guid,state:'completed',receivedBytes:64});},'private-target',{expectedBytes:64});
 assert.equal(result.bytes,64);assert.equal(f.copies.length,1);assert.ok(f.copies[0].source.endsWith(guid));assert.deepEqual(f.states,['configured','started','completed','copied']);await bridge.close();
});
for(const [state,bytes,message] of [['canceled',0,'download-canceled'],['completed',63,'download-size-mismatch'],['inProgress',65,'download-size-exceeded']])test('does not copy on '+message,async()=>{
 const f=fixture(),bridge=await createTaskDownloads(f.browser,profile,{io:f.io,token});
 await assert.rejects(bridge.saveFromClick(async()=>{f.session.emit('Browser.downloadWillBegin',{guid,url:'blob:https://example.invalid/id'});f.session.emit('Browser.downloadProgress',{guid,state,receivedBytes:bytes});},'target',{expectedBytes:64,maxBytes:64}),new RegExp(message));assert.equal(f.copies.length,0);await bridge.close();
});
test('timeout cancels only the owned GUID and never retries a download',async()=>{
 const f=fixture(),bridge=await createTaskDownloads(f.browser,profile,{io:f.io,token});let clicks=0;
 await assert.rejects(bridge.saveFromClick(async()=>{clicks++;f.session.emit('Browser.downloadWillBegin',{guid,url:'blob:https://example.invalid/id'});},'target',{timeoutMs:5}),/download-timeout/);
 assert.equal(clicks,1);assert.ok(f.calls.some(c=>c.method==='Browser.cancelDownload'&&c.args.guid===guid));assert.equal(f.copies.length,0);await bridge.close();
});
test('closing an in-flight save cancels its GUID and waits for listener cleanup',async()=>{
 const f=fixture(),bridge=await createTaskDownloads(f.browser,profile,{io:f.io,token});let began;
 const started=new Promise(resolve=>{began=resolve;});
 const pending=bridge.saveFromClick(async()=>{f.session.emit('Browser.downloadWillBegin',{guid,url:'blob:https://example.invalid/id'});began();},'target');
 await started;const closing=bridge.close();await assert.rejects(pending,/download-closed/);await closing;
 assert.equal(f.copies.length,0);assert.equal(f.session.listenerCount('Browser.downloadProgress'),0);assert.equal(f.session.listenerCount('Browser.downloadWillBegin'),0);assert.ok(f.calls.some(c=>c.method==='Browser.cancelDownload'&&c.args.guid===guid));
});
