// WSL observer -> Windows task Chrome: CDP native save, then copy through the mounted drive.
// The app's download links are unchanged. No HTTP downloader or image processing here.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {isTaskProfile}=require('./browser_process_resources.cjs');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function downloadDirectory(profile,token){
 if(!isTaskProfile(profile)||path.win32.normalize(profile)!==profile||!uuid.test(token))throw Error('invalid-download-owner');
 const windows=profile+'-downloads-'+token;
 return {windows,local:process.platform==='win32'?windows:'/mnt/c/'+windows.slice(3).replaceAll('\\','/')};
}
async function createTaskDownloads(browser,profile,{io=fs,token=randomUUID(),onState=()=>{}}={}){
 const directory=downloadDirectory(profile,token);let session,active=null,closed=false;
 const note=state=>{try{onState(state);}catch{}};
 io.mkdirSync(directory.local,{mode:0o700});
 try{
  session=await browser.newBrowserCDPSession();
  await session.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:directory.windows,eventsEnabled:true});note('configured');
 }catch{try{await session?.detach();}catch{}io.rmSync(directory.local,{recursive:true,force:true});throw Error('download-configure-failed');}
 return Object.freeze({
  async saveFromClick(click,target,{expectedBytes,maxBytes=64*1024**2,timeoutMs=15000}={}){
   if(closed||active||typeof click!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>128*1024**2
    ||(expectedBytes!==undefined&&(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>maxBytes)))throw Error('invalid-download-request');
   let guid,complete=false,timer,begin,progress;
   const job={};job.finished=new Promise(resolve=>{job.finish=resolve;});active=job;
   const completion=new Promise((resolve,reject)=>{
    job.reject=reject;
    begin=event=>{
     if(guid||!uuid.test(event.guid)||typeof event.url!=='string'||!event.url.startsWith('blob:')){reject(Error('unexpected-download'));return;}
     guid=event.guid;note('started');
    };
    progress=event=>{
     if(event.guid!==guid)return;
     if(!Number.isSafeInteger(event.receivedBytes)||event.receivedBytes<0||event.receivedBytes>maxBytes){reject(Error('download-size-exceeded'));return;}
     if(event.state==='canceled'){reject(Error('download-canceled'));return;}
     if(event.state==='completed'){
      complete=true;
      if(event.receivedBytes<1||(expectedBytes!==undefined&&event.receivedBytes!==expectedBytes)){reject(Error('download-size-mismatch'));return;}
      note('completed');resolve(event.receivedBytes);
     }
    };
    session.on('Browser.downloadWillBegin',begin);session.on('Browser.downloadProgress',progress);
    timer=setTimeout(()=>reject(Error('download-timeout')),timeoutMs);
   });
   try{
    const [,bytes]=await Promise.all([Promise.resolve().then(click),completion]);
    const source=path.join(directory.local,guid);let stat;
    for(let attempt=0;attempt<20;attempt++){
     try{stat=io.lstatSync(source);break;}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(r=>setTimeout(r,50));}
    }
    if(!stat?.isFile()||stat.isSymbolicLink()||stat.size!==bytes)throw Error('download-file-invalid');
    io.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);note('copied');return {bytes};
   }finally{
    clearTimeout(timer);session.removeListener('Browser.downloadWillBegin',begin);session.removeListener('Browser.downloadProgress',progress);
    if(guid&&!complete)try{await session.send('Browser.cancelDownload',{guid});}catch{}
    if(active===job)active=null;job.finish();
   }
  },
  async close(){if(closed)return;closed=true;const pending=active;pending?.reject(Error('download-closed'));if(pending)await pending.finished;try{await session.detach();}catch{}io.rmSync(directory.local,{recursive:true,force:true,maxRetries:5,retryDelay:100});note('closed');},
 });
}
module.exports={downloadDirectory,createTaskDownloads};
