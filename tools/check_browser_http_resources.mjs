/** Read-only HTTP checks. Reuses the application's bounded SHA/length verifier. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createResourcePolicy} from './browser-library-adapter/resource-policy.mjs';

export async function checkHttpResources({appOrigin,files},{fetchImpl=fetch,signal=AbortSignal.timeout(30000)}={}){
 const app=new URL(appOrigin);
 if(app.origin!==appOrigin||app.username||app.password||!(app.protocol==='https:'||(app.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(app.hostname))))throw Error('invalid-app-origin');
 if(!Array.isArray(files)||!files.length||files.length>256||files.some(f=>!['application/wasm','text/javascript','application/javascript','application/json','application/octet-stream'].includes(f.contentType)))throw Error('invalid-http-resource-list');
 const policy=createResourcePolicy({files,signal,makeHasher(){const hash=createHash('sha256');return {update:bytes=>hash.update(bytes),digestHex:()=>hash.digest('hex')};},
  cache:{async match(){return undefined;},async put(){throw Error('no-cache-writes');}},
  async fetchImpl(url,init){
   const cross=new URL(url).origin!==appOrigin;
   const headers=new Headers(init.headers);if(cross)headers.set('Origin',appOrigin);
   const response=await fetchImpl(url,{...init,headers});
   const file=files.find(f=>new URL(f.url).href===url);
   const mime=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
   if(mime!==file.contentType||(cross&&response.headers.get('Access-Control-Allow-Origin')!==appOrigin)){
    await response.body?.cancel();throw Error('http-header-mismatch');
   }
   return response;
  }});
 const results=[];
 for(const file of files){
  const response=await policy.fetch(file.url),reader=response.body.getReader();
  try{while(!(await reader.read()).done){/* Stream through the existing verifier; retain no asset bytes. */}}
  finally{reader.releaseLock();}
  results.push({sha256:file.sha256,bytes:file.bytes,contentType:file.contentType});
 }
 return {status:'http-resource-bytes-and-response-headers-verified',resources:results,
  limits:['Node header checks do not prove browser CORS/CSP or deployed application acceptance.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==3)throw Error();const input=JSON.parse(await readFile(process.argv[2],'utf8'));console.log(JSON.stringify(await checkHttpResources(input)));}
 catch{process.stderr.write('HTTP resource check failed; supply one explicit descriptor JSON file.\n');process.exitCode=1;}
}
