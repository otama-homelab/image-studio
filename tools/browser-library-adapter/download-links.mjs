export class DownloadLinkError extends Error {
 constructor(code){super(code);this.name='DownloadLinkError';this.code=code;}
}
const optionsFor=input=>Object.freeze({kind:input?.kind,format:input?.format??'png',...(input?.kind==='paper'?{paper:input.paper}:{}),...(input?.kind==='background'&&input.backgroundColor!==undefined?{backgroundColor:Object.freeze([...input.backgroundColor])}:{})});
const slot=options=>JSON.stringify([options.kind,options.format,options.paper??null]);

/** No automatic click or disk-write claim. Application binds close() to pagehide/session teardown. */
export function createDownloadLinks({getReady,urlApi=URL,BlobClass=Blob,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
 const records=new Map(),current=new Map();let closed=false;
 const ready=options=>{try{return getReady(options);}catch{return null;}};
 function revoke(record){
  if(record.timer!==null)clearTimer(record.timer);
  urlApi.revokeObjectURL(record.url);records.delete(record.id);
  if(current.get(record.slot)===record)current.delete(record.slot);
 }
 function collect(record){
  if(!records.has(record.id))return;
  if(!record.invalid&&record.owners.size)return;
  if(record.timer!==null){clearTimer(record.timer);record.timer=null;}
  const remaining=record.usedUntil-now();
  if(remaining>0){record.timer=setTimer(()=>{record.timer=null;collect(record);},remaining);return;}
  revoke(record);
 }
 function retire(record){record.invalid=true;if(current.get(record.slot)===record)current.delete(record.slot);collect(record);}
 const link=record=>Object.freeze({id:record.id,url:record.url,filename:record.file.filename,mime:record.file.mime});
 return Object.freeze({
  acquire(input,owner){
   if(closed)throw new DownloadLinkError('download-links-closed');
   if(typeof owner!=='string'||!owner)throw new DownloadLinkError('invalid-link-owner');
   const options=optionsFor(input),id=slot(options),file=ready(options);let record=current.get(id);
   if(record&&record.file!==file){retire(record);record=null;}
   if(!file)throw new DownloadLinkError('export-not-ready');
   if(!record){
    let url;
    try{const blob=new BlobClass([file.bytes],{type:file.mime});url=urlApi.createObjectURL(blob);}catch{throw new DownloadLinkError('download-prepare-failed');}
    record={id:'download-'+crypto.randomUUID(),slot:id,options,file,url,owners:new Set(),usedUntil:-Infinity,timer:null,invalid:false};
    records.set(record.id,record);current.set(id,record);
   }
   record.owners.add(owner);if(record.timer!==null){clearTimer(record.timer);record.timer=null;}
   return link(record);
  },
  beginDownload(id,owner){
   const record=records.get(id);
   if(closed||!record||record.invalid||!record.owners.has(owner))throw new DownloadLinkError('download-link-unavailable');
   if(ready(record.options)!==record.file){retire(record);throw new DownloadLinkError('export-not-ready');}
   record.usedUntil=now()+60_000;return link(record);
  },
  release(id,owner){const record=records.get(id);if(!record)return;record.owners.delete(owner);collect(record);},
  reconcile(){for(const record of [...current.values()])if(ready(record.options)!==record.file)retire(record);},
  close(){if(closed)return;closed=true;for(const record of [...records.values()])revoke(record);},
  getState(){return Object.freeze({urls:records.size,current:current.size,deferred:[...records.values()].filter(r=>r.timer!==null).length});},
 });
}
