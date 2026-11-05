import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createResourcePolicy} from '../tools/browser-library-adapter/resource-policy.mjs';
const data=new TextEncoder().encode('{"model_type":"vitmatte"}');
const file={url:'https://assets.invalid/r1/config.json',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
const makeHasher=()=>{const hash=createHash('sha256');return {update:v=>hash.update(v),digestHex:()=>hash.digest('hex')};};
function fixture(options={}){
 const events=[],stored=new Map();let calls=[];
 const cache={async match(k){return stored.get(k)?.clone();},async put(k,r){const b=await r.arrayBuffer();stored.set(k,new Response(b));}};
 const policy=createResourcePolicy({files:[file],makeHasher,cache,fetchImpl:async(u,i)=>{calls.push({u,i});return new Response(data);},onEvent:e=>events.push(e),...options});
 return {policy,events,stored,calls};
}
test('only manifest GETs reach transport; credentials and caller headers are not forwarded',async()=>{
 const f=fixture();await assert.rejects(f.policy.fetch('https://other.invalid/config.json'),/resource-not-allowed/);
 await assert.rejects(f.policy.fetch(file.url,{method:'POST',body:'photo'}),/method-not-allowed/);assert.equal(f.calls.length,0);
 const response=await f.policy.fetch(file.url,{headers:{Accept:'application/json',Authorization:'secret','X-Photo-Name':'private'}});
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);
 assert.equal(f.calls[0].i.credentials,'omit');assert.equal(f.calls[0].i.redirect,'error');
 assert.deepEqual([...f.calls[0].i.headers],[['accept','application/json']]);assert.equal(f.policy.getState()[0].networkVerified,true);
 assert.equal(f.policy.getState()[0].stored,false);
});
test('length and checksum failures reject reads before data can be accepted',async()=>{
 for(const [body,code] of [[data.slice(0,-1),'bytes-mismatch'],[new Uint8Array(data.length+1),'bytes-overflow'],[new Uint8Array(data.length),'checksum-mismatch']]){
  const f=fixture({fetchImpl:async()=>new Response(body)});const response=await f.policy.fetch(file.url);
  await assert.rejects(response.arrayBuffer(),e=>e.code===code);assert.equal(f.policy.getState()[0].networkVerified,false);assert.equal(f.policy.getState()[0].stored,false);
 }
});
test('native cache delegation verifies both writes and reads; corrupt cached content is not trusted',async()=>{
 const f=fixture();await f.policy.cache.put(file.url,new Response(data));assert.equal(f.policy.getState()[0].stored,true);
 assert.equal(await f.policy.cache.match('https://huggingface.co/cache-key'),undefined);
 const good=await f.policy.cache.match(file.url);assert.deepEqual(new Uint8Array(await good.arrayBuffer()),data);assert.equal(f.policy.getState()[0].cacheVerified,true);
 f.stored.set(file.url,new Response(new Uint8Array(data.length)));
 await assert.rejects((await f.policy.cache.match(file.url)).arrayBuffer(),e=>e.code==='checksum-mismatch');assert.equal(f.policy.getState()[0].stored,false);
});
test('cache write failure remains observable without logging exception text',async()=>{
 const f=fixture({cache:{async match(){},async put(){throw new DOMException('private photo name','QuotaExceededError');}}});
 await assert.rejects(f.policy.cache.put(file.url,new Response(data)),e=>e.code==='cache-quota-exceeded');
 assert.equal(f.policy.getState()[0].stored,false);assert.equal(f.policy.getState()[0].lastError,'cache-quota-exceeded');
 assert.equal(JSON.stringify(f.events).includes('private photo name'),false);
});
test('abort cancels a stalled body rather than waiting for a new chunk',{timeout:1000},async()=>{
 const controller=new AbortController();let resolveCancelled,transportSignal;const cancelled=new Promise(resolve=>{resolveCancelled=resolve;});
 const body=new ReadableStream({start(c){c.enqueue(data.slice(0,1));},cancel(){resolveCancelled();}});
 const f=fixture({signal:controller.signal,fetchImpl:async(_,init)=>{transportSignal=init.signal;return new Response(body);}});
 const response=await f.policy.fetch(file.url);const read=response.arrayBuffer();controller.abort();
 await assert.rejects(read,{name:'AbortError'});assert.equal(transportSignal,controller.signal);await cancelled;assert.equal(f.policy.getState()[0].stored,false);
});
test('redirects, invalid manifests and duplicate canonical resources fail closed',async()=>{
 const response=new Response(data);Object.defineProperty(response,'redirected',{value:true});
 await assert.rejects(fixture({fetchImpl:async()=>response}).policy.fetch(file.url),/invalid-response/);
 for(const files of [[file,file],[{...file,url:file.url+'?token=secret'}],[{...file,url:'https://user:pass@assets.invalid/config.json'}],[{...file,bytes:-1}]])assert.throws(()=>fixture({files}),/invalid-manifest/);
});


test('a cache backend cannot claim a saved file without consuming and verifying its body',async()=>{
 const f=fixture({cache:{async match(){},async put(){}}});
 await assert.rejects(f.policy.cache.put(file.url,new Response(data)),e=>e.code==='cache-body-not-consumed');
 assert.equal(f.policy.getState()[0].stored,false);
});


test('a rejected transport response cancels its unread body',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
 const f=fixture({fetchImpl:async()=>new Response(body,{status:404})});
 await assert.rejects(f.policy.fetch(file.url),e=>e.code==='invalid-response');assert.equal(cancelled,true);
});

test('async hash factory works without a complete-body buffer',async()=>{
 const f=fixture({makeHasher:async()=>makeHasher()});
 assert.deepEqual(new Uint8Array(await(await f.policy.fetch(file.url)).arrayBuffer()),data);
 assert.equal(f.policy.getState()[0].networkVerified,true);
});
test('hash initialization failure cancels the body and exposes a fixed code',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
 const f=fixture({makeHasher:async()=>{throw Error('sensitive dependency error');},fetchImpl:async()=>new Response(body)});
 await assert.rejects((await f.policy.fetch(file.url)).arrayBuffer(),e=>e.code==='hash-init-failed');
 assert.equal(cancelled,true);assert.equal(JSON.stringify(f.events).includes('sensitive'),false);
});
test('abort during async hash initialization leaves no pending source read',{timeout:1000},async()=>{
 const controller=new AbortController();let resolveHash,cancelled=false,updates=0;
 const waiting=new Promise(resolve=>{resolveHash=resolve;});
 const f=fixture({signal:controller.signal,makeHasher:()=>waiting,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const response=await f.policy.fetch(file.url),read=response.arrayBuffer();controller.abort();
 await assert.rejects(read,{name:'AbortError'});assert.equal(cancelled,true);
 resolveHash({update(){updates++;},digestHex(){return file.sha256;}});await Promise.resolve();assert.equal(updates,0);
});

test('Request-carried abort signals stop a stalled resource and redact private reasons',{timeout:1000},async()=>{
 const controller=new AbortController();let cancelled=false;
 const f=fixture({fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const response=await f.policy.fetch(new Request(file.url,{signal:controller.signal}));
 const read=response.arrayBuffer();controller.abort(Error('private photo name'));
 await assert.rejects(read,e=>e.name==='AbortError'&&!e.message.includes('private'));
 assert.equal(cancelled,true);assert.equal(f.policy.getState()[0].lastError,'aborted');
});
test('transport and stream errors expose fixed codes without dependency exception text',async()=>{
 const transport=fixture({fetchImpl:async()=>{throw Error('private transport payload');}});
 await assert.rejects(transport.policy.fetch(file.url),e=>e.code==='transport-failed'&&e.message==='transport-failed');
 assert.equal(transport.policy.getState()[0].lastError,'transport-failed');
 const stream=fixture({fetchImpl:async()=>new Response(new ReadableStream({start(c){c.error(Error('private stream payload'));}}))});
 await assert.rejects((await stream.policy.fetch(file.url)).arrayBuffer(),e=>e.code==='stream-failed'&&e.message==='stream-failed');
 assert.equal(JSON.stringify([...transport.events,...stream.events]).includes('private'),false);
});
test('already aborted requests do not reach transport or propagate abort reasons',async()=>{
 const controller=new AbortController();controller.abort('private photo name');
 const f=fixture();await assert.rejects(f.policy.fetch(new Request(file.url,{signal:controller.signal})),e=>e.name==='AbortError'&&e.message==='aborted');
 assert.equal(f.calls.length,0);assert.equal(f.policy.getState()[0].lastError,'aborted');
});

test('quota rejection of a cloned Response does not wait for the unread original tee branch',{timeout:1000},async()=>{
 const f=fixture({cache:{async match(){},async put(){throw new DOMException('private quota payload','QuotaExceededError');}}});
 const response=await f.policy.fetch(file.url);
 await assert.rejects(f.policy.cache.put(file.url,response.clone()),e=>e.code==='cache-quota-exceeded');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);
 assert.equal(f.policy.getState()[0].stored,false);assert.equal(f.policy.getState()[0].networkVerified,true);
 assert.equal(f.policy.getState()[0].lastError,'cache-quota-exceeded');
});
test('abort while Web Crypto-style digest is pending cannot mark the resource verified',async()=>{
 const abort=new AbortController();let resolveDigest,started;const ready=new Promise(r=>started=r);
 const f=fixture({signal:abort.signal,makeHasher:()=>({update(){},digestHex(){started();return new Promise(r=>resolveDigest=r);}})});
 const response=await f.policy.fetch(file.url),read=response.arrayBuffer();await ready;abort.abort();await assert.rejects(read,e=>e.name==='AbortError');resolveDigest(file.sha256);await new Promise(r=>setImmediate(r));
 assert.equal(f.policy.getState()[0].networkVerified,false);assert.equal(f.policy.getState()[0].lastError,'aborted');assert.ok(!f.events.some(e=>e.type==='network-verified'));
});

test('resource timing separates reader waits and hash work without retaining resource identity',async()=>{
 let clock=0;const f=fixture({now:()=>clock,cache:{async match(){return undefined;},async put(){}},
  fetchImpl:async()=>new Response(new ReadableStream({pull(c){clock+=7;c.enqueue(data);c.close();}})),
  makeHasher:()=>{const h=createHash('sha256');return {update(value){clock+=11;h.update(value);},digestHex(){clock+=13;return h.digest('hex');}};}});
 const before=f.policy.getTiming();assert.ok(Object.isFrozen(before));assert.equal(before.verifiedStreams,0);
 await(await f.policy.fetch(file.url)).arrayBuffer();const after=f.policy.getTiming();assert.equal(after.hashWorkSumMs,24);assert.equal(after.verifiedBytes,data.length);assert.equal(after.verifiedStreams,1);assert.ok(after.readWaitSumMs>=0);assert.equal(before.verifiedStreams,0);assert.ok(!JSON.stringify(after).includes('https:'));
});

const hubCommit='b58373f8dbbfbeb58157456e2e4949f9f872aa18';
const hubUrl=`https://huggingface.co/hustvl/vitmatte-base-distinctions-646/resolve/${hubCommit}/config.json`;
const hubCacheUrl=`https://huggingface.co/api/resolve-cache/models/hustvl/vitmatte-base-distinctions-646/${hubCommit}/config.json?etag=fixed`;
function hubResponse(url,body=data){const response=new Response(body);Object.defineProperties(response,{url:{value:url},redirected:{value:true}});return response;}
test('fixed-commit Hub resources follow official delivery redirects and retain the original cache identity',async()=>{
 for(const finalUrl of [hubCacheUrl,'https://us.aws.cdn.hf.co/xet-bridge-us/model?Signature=temporary']){
  let options;const descriptor={...file,url:hubUrl};
  const f=fixture({files:[descriptor],fetchImpl:async(_,init)=>{options=init;return hubResponse(finalUrl);}});
  const response=await f.policy.fetch(hubUrl,{headers:{Authorization:'private-token'}});
  assert.equal(options.redirect,'follow');assert.equal(options.credentials,'omit');assert.equal(options.headers.has('Authorization'),false);
  await f.policy.cache.put(hubUrl,response);assert.equal(f.policy.getState()[0].stored,true);
  assert.ok(f.stored.has(hubUrl));assert.equal(f.stored.has(finalUrl),false);
  assert.deepEqual(new Uint8Array(await(await f.policy.cache.match(hubUrl)).arrayBuffer()),data);
 }
});
test('Hub manifests require immutable commits and redirected responses cannot escape the delivery allowlist',async()=>{
 for(const url of [hubUrl.replace(hubCommit,'main'),hubUrl.replace(hubCommit,'v1'),hubUrl.replace('/resolve/','/raw/')])assert.throws(()=>fixture({files:[{...file,url}]}),/invalid-manifest/);
 for(const url of ['https://evil.test/model','https://us.aws.cdn.hf.co.evil.test/model','http://us.aws.cdn.hf.co/model','https://user:pass@us.aws.cdn.hf.co/model',hubCacheUrl.replace(hubCommit,'0'.repeat(40)),hubCacheUrl.replace('config.json','other.json')]){
  let cancelled=false;const response=hubResponse(url);const original=response.body.cancel.bind(response.body);response.body.cancel=reason=>{cancelled=true;return original(reason);};
  const f=fixture({files:[{...file,url:hubUrl}],fetchImpl:async()=>response});
  await assert.rejects(f.policy.fetch(hubUrl),/unexpected-response-url/);assert.equal(cancelled,true);
 }
});
test('Hub redirect support does not bypass hash verification or trust redirected cache responses',async()=>{
 const descriptor={...file,url:hubUrl};
 const f=fixture({files:[descriptor],fetchImpl:async()=>hubResponse(hubCacheUrl,new Uint8Array(data.length))});
 await assert.rejects((await f.policy.fetch(hubUrl)).arrayBuffer(),/checksum-mismatch/);assert.equal(f.policy.getState()[0].networkVerified,false);
 const cached=fixture({files:[descriptor],cache:{async match(){return hubResponse(hubCacheUrl);},async put(){}}});
 await assert.rejects(cached.policy.cache.match(hubUrl),/invalid-response/);
});

test('shared-content progress remains incomplete until every cache alias is stored',async()=>{
 const {groupResourceStates}=await import('../tools/browser-library-adapter/resource-policy.mjs');
 const first={sha256:'a'.repeat(64),bytes:82,stored:true,networkVerified:false,cacheVerified:true,lastError:null};
 const states=[first,{...first,stored:false,cacheVerified:false}];
 assert.deepEqual(groupResourceStates(states),[{...first,stored:false,cacheVerified:false}]);assert.equal(first.stored,true);
 states[1].stored=true;states[1].cacheVerified=true;assert.deepEqual(groupResourceStates(states),[first]);
});

test('network 429 reports a fixed rate-limit reason without reading response details or retrying',async()=>{
 let calls=0,cancelled=false;const f=fixture({fetchImpl:async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:429,headers:{'Retry-After':'private-header'}});}});
 await assert.rejects(f.policy.fetch(file.url),e=>e.code==='resource-rate-limited'&&e.message==='resource-rate-limited');
 assert.equal(calls,1);assert.equal(cancelled,true);assert.equal(f.policy.getState()[0].lastError,'resource-rate-limited');
});

for(const status of [401,403])test(`network ${status} is safe access denial, cancels its body and allows explicit retry`,async()=>{
 let cancelled=false,calls=0;
 const denied=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status});
 const f=fixture({fetchImpl:async()=>++calls===1?denied:new Response(data)});
 await assert.rejects(f.policy.fetch(file.url),e=>e.code==='resource-access-denied'&&e.message==='resource-access-denied');
 assert.equal(cancelled,true);assert.equal(calls,1);assert.equal(f.policy.getState()[0].lastError,'resource-access-denied');assert.equal(f.stored.size,0);
 assert.deepEqual(new Uint8Array(await(await f.policy.fetch(file.url)).arrayBuffer()),data);
 assert.equal(calls,2);assert.equal(f.policy.getState()[0].networkVerified,true);assert.equal(f.policy.getState()[0].lastError,null);
 const cached=fixture({cache:{async match(){return new Response('private body',{status});},async put(){throw Error('unused');}}});
 await assert.rejects(cached.policy.cache.match(file.url),e=>e.code==='invalid-response');
});
