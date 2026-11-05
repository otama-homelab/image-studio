import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {checkHttpResources} from '../tools/check_browser_http_resources.mjs';
const bytes=Buffer.from('verified-resource');
const file={url:'https://assets.example.com/runtime.wasm',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'application/wasm'};
const config={appOrigin:'https://app.example.com',files:[file]};
test('cross-origin GET omits credentials and verifies bytes using existing resource policy',async()=>{
 const report=await checkHttpResources(config,{fetchImpl:async(url,init)=>{
  assert.equal(url,file.url);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers.get('Origin'),config.appOrigin);
  return new Response(bytes,{headers:{'Content-Type':'application/wasm','Access-Control-Allow-Origin':config.appOrigin}});
 }});assert.equal(report.resources[0].sha256,file.sha256);
});
test('reject MIME, missing/wildcard/wrong CORS and corrupted or truncated bytes',async()=>{
 for(const change of [{mime:'text/html'},{origin:null},{origin:'*'},{origin:'https://other.example.com'},{body:Buffer.from('bad')},{body:Buffer.alloc(bytes.length)}]){
  await assert.rejects(checkHttpResources(config,{fetchImpl:async()=>new Response(change.body??bytes,{headers:{'Content-Type':change.mime??file.contentType,...(change.origin===null?{}:{'Access-Control-Allow-Origin':change.origin??config.appOrigin})}})}));
 }
});
test('invalid descriptor list fails before any fetch',async()=>{
 let calls=0;for(const input of [{...config,appOrigin:'https://app.example.com/path'},{...config,files:[{...file,contentType:'text/html'}]},{...config,files:[{...file,sha256:'bad'}]}])await assert.rejects(checkHttpResources(input,{fetchImpl:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
});
test('real loopback HTTP response supports streamed bytes and exact Origin checks',async()=>{
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/wasm','Access-Control-Allow-Origin':req.headers.origin});res.write(bytes.subarray(0,4));res.end(bytes.subarray(4));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url='http://127.0.0.1:'+server.address().port+'/runtime.wasm';const result=await checkHttpResources({...config,files:[{...file,url}]});assert.equal(result.resources.length,1);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
