// Read-only diagnostic OPFS namespace, shared with the existing cache probe.
// This is not the application's adopted model store.
import {verifyStream,validateArtifact} from './verified-stream.mjs';
export const cacheScope='plan36-cache-probe-v1';
export async function hashStored(directory,file,{collect=false}={}){
 const started=performance.now(),handle=await directory.getFileHandle(file.sha256+'.bin');
 const blob=await handle.getFile();
 if(blob.size!==file.bytes)throw Error('Stored file byte mismatch');
 const data=collect?new Uint8Array(file.bytes):undefined;let offset=0;
 const verified=await verifyStream(blob.stream(),file,{write:async chunk=>{if(data){data.set(chunk,offset);offset+=chunk.length;}}});
 return {...verified,readAndHashMs:performance.now()-started,...(data?{data}:{})};
}
export async function readWarmModel(config,progress=()=>{}){
 if(!navigator.storage?.getDirectory||!navigator.locks)throw Error('OPFS/Web Locks unavailable');
 if(typeof config?.modelId!=='string'||!Array.isArray(config.files)||config.files.length!==2
  ||new Set(config.files.map(file=>file.sha256)).size!==2||config.files.some(file=>file.bytes>512*1024*1024)
  ||config.files.filter(file=>file.name?.endsWith('.onnx')).length!==1)throw Error('Invalid warm model contract');
 for(const file of config.files)validateArtifact(file,self.location.origin);
 return navigator.locks.request(cacheScope,{mode:'shared'},async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle(cacheScope);
  const marker=await(await directory.getFileHandle('ready.json')).getFile();
  if(marker.size>64*1024)throw Error('Saved contract too large');
  const receipt=JSON.parse(await marker.text());
  if(receipt.modelId!==config.modelId||JSON.stringify(receipt.files)!==JSON.stringify(config.files))throw Error('Saved contract mismatch');
  const started=performance.now(),files=[];
  for(const file of config.files){progress(file);files.push({name:file.name,...await hashStored(directory,file,{collect:true})});}
  return {files,readAndHashMs:performance.now()-started,networkBytes:0};
 });
}
