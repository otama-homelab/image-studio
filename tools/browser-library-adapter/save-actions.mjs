import {normalizeExportOptions} from './export-job.mjs';
const sameOptions=(a,b)=>a&&b&&a.kind===b.kind&&a.format===b.format&&a.paper===b.paper;

/** Headless UI actions: generate explicitly, then allow a separately confirmed download click. */
export function createSaveActions({jobs,links,getOptions,onChange=()=>{}}){
 const owner='save-control-'+crypto.randomUUID();let closed=false,epoch=0,pending=null,link=null,linkOptions=null;
 let state=Object.freeze({phase:'idle',link:null,errorCode:null,busy:jobs.getState().busy});
 const publish=patch=>{
  const next={...state,...patch,busy:jobs.getState().busy};
  if(next.phase===state.phase&&next.link?.id===state.link?.id&&next.errorCode===state.errorCode&&next.busy===state.busy)return;
  state=Object.freeze(next);if(!closed)try{onChange(state);}catch{}
 };
 const releaseLink=()=>{if(link)links.release(link.id,owner);link=null;linkOptions=null;};
 const options=()=>normalizeExportOptions(getOptions());
 const adopt=selected=>{
  const next=links.acquire(selected,owner);if(link&&link.id!==next.id)links.release(link.id,owner);link=next;linkOptions=selected;
  publish({phase:'ready',link,errorCode:null});
 };
 const unsubscribe=jobs.subscribe(snapshot=>{if(pending?.jobId===null)pending.jobId=snapshot.jobId;publish({});});
 return Object.freeze({
  async generate(){
   if(closed)return {status:'closed'};
   if(pending||jobs.getState().busy)return {status:'busy'};
   let selected;try{selected=options();}catch{publish({phase:'error',errorCode:'invalid-export-options'});return {status:'error'};}
   releaseLink();const request={epoch:++epoch,options:selected,jobId:null};pending=request;
   const generated=jobs.start(selected);request.jobId??=jobs.getState().jobId;
   if(closed||epoch!==request.epoch){if(request.jobId)jobs.cancel(request.jobId);}
   else publish({phase:'generating',link:null,errorCode:null});
   try{
    const result=await generated;
    if(closed||epoch!==request.epoch)return {status:'stale'};
    if(!sameOptions(selected,options())){publish({phase:'stale',link:null,errorCode:null});return {status:'stale'};}
    if(result.status==='ready'){adopt(selected);return {status:'ready'};}
    publish({phase:result.status,link:null,errorCode:null});return result;
   }catch{
    if(closed||epoch!==request.epoch)return {status:'stale'};
    publish({phase:'error',link:null,errorCode:'save-prepare-failed'});return {status:'error'};
   }finally{if(pending===request)pending=null;if(!closed)publish({});}
  },
  beginDownload(){
   if(closed||!link)return null;
   try{if(!sameOptions(linkOptions,options()))throw Error();const current=links.beginDownload(link.id,owner);return current;}
   catch{releaseLink();publish({phase:'stale',link:null,errorCode:'export-not-ready'});return null;}
  },
  reconcile(){
   if(closed)return;
   try{
    const selected=options();
    if(pending&&(!sameOptions(pending.options,selected)||(jobs.getState().jobId===pending.jobId&&!jobs.isCurrent(pending.jobId)))){
     epoch++;if(pending.jobId)jobs.cancel(pending.jobId);releaseLink();publish({phase:'stale',link:null,errorCode:null});return;
    }
    if(pending)return;
    if(jobs.getReady(selected)){adopt(selected);return;}
    const previous=!!link;releaseLink();publish({phase:previous?'stale':'idle',link:null,errorCode:null});
   }catch{releaseLink();publish({phase:'error',link:null,errorCode:'save-prepare-failed'});}
  },
  cancel(){epoch++;if(pending?.jobId)jobs.cancel(pending.jobId);releaseLink();publish({phase:'cancelled',link:null,errorCode:null});},
  async cancelAndWait(){
   const intent=++epoch,jobId=pending?.jobId;releaseLink();
   publish({phase:jobId?'cancelling':'cancelled',link:null,errorCode:null});
   try{
    if(jobId)await jobs.cancelAndWait(jobId);
    if(!closed&&epoch===intent)publish({phase:'cancelled',link:null,errorCode:null});
   }catch{
    if(!closed&&epoch===intent)publish({phase:'error',link:null,errorCode:'save-stop-failed'});
    throw new Error('save-stop-failed');
   }
  },
  close(){if(closed)return;closed=true;epoch++;unsubscribe();if(pending?.jobId)jobs.cancel(pending.jobId);releaseLink();},
  getState(){return state;},
 });
}
