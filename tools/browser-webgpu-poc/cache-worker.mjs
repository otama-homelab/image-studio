// GPU-free OPFS measurement, separate namespace/profile. Not the production cache.
import {verifyStream,validateArtifact} from './verified-stream.mjs';
import {hashStored,cacheScope as scope} from './stored-model.mjs';
let busy=false;
const workerInstanceId=crypto.randomUUID();
const check=()=>{if(!navigator.storage?.getDirectory || !navigator.locks)throw Error('OPFS/Web Locks unavailable');};
async function download(directory,file) {
  const url=validateArtifact(file,self.location.origin),started=performance.now();
  const response=await fetch(url,{cache:'no-store',redirect:'error'});
  if(!response.ok || !response.body)throw Error('Model HTTP failure');
  const handle=await directory.getFileHandle(file.sha256+'.bin',{create:true});
  const access=await handle.createSyncAccessHandle();
  let offset=0,hashAndWriteMs;
  try {
    access.truncate(0);
    await verifyStream(response.body,file,{write:async chunk=>{
      let cursor=0;
      while(cursor<chunk.length) {
        const count=access.write(chunk.subarray(cursor),{at:offset});
        if(count<1)throw Error('OPFS write made no progress');
        cursor+=count;offset+=count;
      }
    }});
    access.flush();hashAndWriteMs=performance.now()-started;
  } catch(error) {
    try {await response.body.cancel();}catch{}
    throw error;
  } finally {access.close();}
  const stored=await hashStored(directory,file);
  return {...stored,networkBytes:file.bytes,fetchHashWriteFlushMs:hashAndWriteMs,totalMs:performance.now()-started};
}
self.onmessage=async({data})=>{
  if(busy){self.postMessage({type:'error',code:'busy'});return;}
  busy=true;
  try {
    check();
    const {mode,files,modelId}=data;
    if(!['cold','warm'].includes(mode)||!Array.isArray(files)||!files.length||new Set(files.map(f=>f.sha256)).size!==files.length)throw Error('Invalid probe request');
    for(const file of files)validateArtifact(file,self.location.origin);
    await navigator.locks.request(scope,async()=>{
      const root=await navigator.storage.getDirectory();
      const directory=await root.getDirectoryHandle(scope,{create:true});
      const existing=[];for await(const key of directory.keys())existing.push(key);
      if(mode==='cold' && existing.length)throw Error('Cold requires empty diagnostic namespace; use a fresh dedicated profile');
      if(mode==='warm') {
        const marker=await directory.getFileHandle('ready.json');
        const receipt=JSON.parse(await (await marker.getFile()).text());
        if(receipt.modelId!==modelId || JSON.stringify(receipt.files)!==JSON.stringify(files))throw Error('Saved contract mismatch');
      }
      const started=performance.now(),before=await navigator.storage.estimate(),results=[];
      for(const file of files) {
        self.postMessage({type:'progress',mode,sha256:file.sha256,bytes:file.bytes});
        try {
          const result=mode==='cold'?await download(directory,file):{...await hashStored(directory,file),networkBytes:0};
          results.push({name:file.name,...result});
        } catch(error) {
          if(mode==='cold')await directory.removeEntry(file.sha256+'.bin').catch(()=>{});
          throw error;
        }
      }
      if(mode==='cold') {
        const marker=await directory.getFileHandle('ready.json',{create:true});
        const writer=await marker.createWritable();await writer.write(JSON.stringify({modelId,files}));await writer.close();
      }
      self.postMessage({type:'result',workerInstanceId,mode,modelId,files:results,totalMs:performance.now()-started,
        networkBytes:results.reduce((sum,f)=>sum+f.networkBytes,0),storageBefore:before,
        storageAfter:await navigator.storage.estimate(),scope:'GPU-free OPFS loopback diagnostic; not R2/product cold-warm acceptance'});
    });
  } catch(error) {self.postMessage({type:'error',code:error.name,detail:error.message});}
  finally {busy=false;}
};
