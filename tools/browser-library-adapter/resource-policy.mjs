/** Thin hooks for an existing library's env.fetch/customCache. No downloader or storage engine. */
export class ResourcePolicyError extends Error {
  constructor(code){super(code);this.name='ResourcePolicyError';this.code=code;}
}
const fail=code=>{throw new ResourcePolicyError(code);};
/** UI uses content identity; identical aliases count as stored only together. */
export function groupResourceStates(states){
  const groups=new Map();
  for(const state of states){
    const key=state.sha256+':'+state.bytes,prior=groups.get(key);
    if(!prior)groups.set(key,{...state});
    else{for(const flag of ['stored','networkVerified','cacheVerified'])prior[flag]&&=state[flag];prior.lastError??=state.lastError;}
  }
  return [...groups.values()];
}
// Only immutable Hub model URLs opt into its cache/CDN delivery redirects.
const hubPath=url=>url.origin==='https://huggingface.co'?url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/resolve\/([a-f0-9]{40})\/(.+)$/):null;
function hubDelivery(url,file){
  try{
    const target=new URL(url);
    if(target.username||target.password||target.hash)return false;
    return (target.origin==='https://huggingface.co'&&target.pathname===file.hubCachePath)
      ||(target.origin==='https://us.aws.cdn.hf.co'&&target.pathname.startsWith('/xet-bridge-us/'));
  }catch{return false;}
}
export function createResourcePolicy({files,fetchImpl,cache,makeHasher,signal,onEvent=()=>{},now=()=>performance.now()}){
  if(!Array.isArray(files)||!files.length||typeof fetchImpl!=='function'||typeof makeHasher!=='function'||!cache?.match||!cache?.put)fail('invalid-policy');
  const manifest=new Map(),states=new Map();
  const timing={readWaitSumMs:0,hashWorkSumMs:0,verifiedBytes:0,verifiedStreams:0};
  const key=input=>new URL(input instanceof Request?input.url:String(input)).href;
  for(const file of files){
    let url;try{url=new URL(file.url);}catch{fail('invalid-manifest');}
    const secure=url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));
    if(!secure||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(file.bytes)||file.bytes<1||!/^[a-f0-9]{64}$/.test(file.sha256)||manifest.has(url.href))fail('invalid-manifest');
    const hub=hubPath(url);if(url.hostname==='huggingface.co'&&!hub)fail('invalid-manifest');
    manifest.set(url.href,Object.freeze({url:url.href,bytes:file.bytes,sha256:file.sha256,...(hub?{hubCachePath:`/api/resolve-cache/models/${hub[1]}/${hub[2]}/${hub[3]}/${hub[4]}`}:{})}));
    states.set(url.href,{networkVerified:false,cacheVerified:false,stored:false,lastError:null});
  }
  const notify=(file,type,code)=>{try{onEvent(Object.freeze({type,sha256:file.sha256,bytes:file.bytes,...(code?{code}:{})}));}catch{}};
  const markError=(file,code)=>{Object.assign(states.get(file.url),{stored:false,lastError:code});notify(file,'error',code);};
  function checked(response,file,source,activeSignal,onVerified=()=>{}){
    const discard=code=>{if(response instanceof Response&&response.body&&!response.body.locked)void response.body.cancel().catch(()=>{});markError(file,code);fail(code);};
    const hubNetwork=source==='network'&&!!file.hubCachePath;
    if(source==='network'&&response instanceof Response&&[401,403].includes(response.status))discard('resource-access-denied');
    if(source==='network'&&response instanceof Response&&response.status===429)discard('resource-rate-limited');
    if(!(response instanceof Response)||response.status!==200||response.type==='opaque'||!response.body||(response.redirected&&!hubNetwork)){discard('invalid-response');}
    if((response.redirected&&!response.url)||(response.url&&key(response.url)!==file.url&&!(hubNetwork&&response.redirected&&hubDelivery(response.url,file)))){discard('unexpected-response-url');}
    const hashReady=Promise.resolve().then(()=>makeHasher()),reader=response.body.getReader();let bytes=0,finished=false,controller;
    const cleanup=()=>{activeSignal?.removeEventListener('abort',abort);try{reader.releaseLock();}catch{}};
    const reject=(error,code)=>{
      if(finished)return;finished=true;markError(file,code);controller.error(error);
      void reader.cancel(error).catch(()=>{}).finally(cleanup);
    };
    const abort=()=>reject(new DOMException('aborted','AbortError'),'aborted');
    const body=new ReadableStream({
      start(c){controller=c;activeSignal?.addEventListener('abort',abort,{once:true});if(activeSignal?.aborted)abort();},
      async pull(c){
        if(finished)return;
        try{
          const hash=await hashReady;if(finished)return;
          if(!hash||typeof hash.update!=='function'||typeof hash.digestHex!=='function')fail('invalid-hasher');
          const readStarted=now();const {value,done}=await reader.read();timing.readWaitSumMs+=now()-readStarted;if(finished)return;
          if(done){
            if(bytes!==file.bytes)fail('bytes-mismatch');
            const hashStarted=now();const digest=await hash.digestHex();timing.hashWorkSumMs+=now()-hashStarted;if(finished)return;
            if(digest!==file.sha256)fail('checksum-mismatch');
            const state=states.get(file.url);
            if(source==='network')state.networkVerified=true;
            if(source==='cache'){state.cacheVerified=true;state.stored=true;}
            // A later network read does not undo an earlier failed cache write.
            if(source!=='network'||!['cache-quota-exceeded','cache-write-failed','cache-body-not-consumed'].includes(state.lastError))state.lastError=null;
            timing.verifiedBytes+=bytes;timing.verifiedStreams++;onVerified();notify(file,source+'-verified');finished=true;cleanup();c.close();
          }else{
            if(!(value instanceof Uint8Array)||bytes+value.length>file.bytes)fail('bytes-overflow');
            const hashStarted=now();hash.update(value);timing.hashWorkSumMs+=now()-hashStarted;bytes+=value.length;c.enqueue(value);
          }
        }catch(error){const code=error instanceof ResourcePolicyError?error.code:'stream-failed';reject(new ResourcePolicyError(code),code);}
      },
      async cancel(reason){if(finished)return;finished=true;try{await reader.cancel(reason);}finally{cleanup();}},
    });
    void hashReady.catch(()=>reject(new ResourcePolicyError('hash-init-failed'),'hash-init-failed'));
    const headers=new Headers(response.headers);headers.delete('Content-Encoding');headers.set('Content-Length',String(file.bytes));
    return new Response(body,{status:200,headers});
  }

  const policyFetch=async(input,init={})=>{
    let url;try{url=key(input);}catch{fail('resource-not-allowed');}
    const file=manifest.get(url);if(!file)fail('resource-not-allowed');
    if(String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase()!=='GET'||init.body!=null)fail('method-not-allowed');
    const signals=[signal,init.signal,input instanceof Request?input.signal:undefined].filter(Boolean);const activeSignal=signals.length>1?AbortSignal.any(signals):signals[0];
    if(activeSignal?.aborted){markError(file,'aborted');throw new DOMException('aborted','AbortError');}
    states.get(url).networkVerified=false;
    const headers=new Headers();const requested=new Headers(init.headers);if(requested.has('Accept'))headers.set('Accept',requested.get('Accept'));
    let response;
    try{response=await fetchImpl(url,{method:'GET',headers,credentials:'omit',redirect:file.hubCachePath?'follow':'error',mode:'cors',signal:activeSignal});}
    catch{const code=activeSignal?.aborted?'aborted':'transport-failed';markError(file,code);if(code==='aborted')throw new DOMException('aborted','AbortError');fail(code);}
    return checked(response,file,'network',activeSignal);
  };
  return Object.freeze({
    fetch:policyFetch,
    cache:Object.freeze({
      async match(input){
        let url;try{url=key(input);}catch{return undefined;}
        const file=manifest.get(url);if(!file)return undefined;
        if(signal?.aborted){markError(file,'aborted');throw new DOMException('aborted','AbortError');}
        Object.assign(states.get(url),{stored:false,cacheVerified:false});
        let response;try{response=await cache.match(url);}catch{markError(file,'cache-read-failed');fail('cache-read-failed');}
        return response===undefined?undefined:checked(response,file,'cache',signal);
      },
      async put(input,response){
        let url;try{url=key(input);}catch{fail('resource-not-allowed');}
        const file=manifest.get(url);if(!file)fail('resource-not-allowed');
        const state=states.get(url);state.stored=false;if(signal?.aborted){markError(file,'aborted');throw new DOMException('aborted','AbortError');}
        let consumedAndVerified=false;
        const validated=checked(response,file,'cache-write',signal,()=>{consumedAndVerified=true;});
        try{
          await cache.put(url,validated);
          if(!consumedAndVerified)fail('cache-body-not-consumed');
        }catch(error){
          // A cloned Response may have an unread tee sibling. Awaiting cancel would wait for that sibling.
          try{void validated.body.cancel().catch(()=>{});}catch{}
          const code=error instanceof ResourcePolicyError?error.code:error?.name==='QuotaExceededError'?'cache-quota-exceeded':'cache-write-failed';
          markError(file,code);fail(code);
        }
        if(signal?.aborted){markError(file,'aborted');throw new DOMException('aborted','AbortError');}state.stored=true;state.lastError=null;notify(file,'stored');
      },
    }),
    getTiming(){return Object.freeze({...timing});},
    getState(){return [...manifest.values()].map(file=>Object.freeze({sha256:file.sha256,bytes:file.bytes,...states.get(file.url)}));},
  });
}
