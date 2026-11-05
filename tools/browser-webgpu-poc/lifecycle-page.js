// Fixed diagnostic sequence. Only one live model Worker; never retries inference.
const probe=window.lifecycleProbe={state:'idle',events:[],runs:[],worker:null};
const expectedByCase={'reference-01':{hr:'6033bcdb6d04d768c269fd174251b93a92247f991e07d1f4e1f02d11d1e272cc',
  matte:'70675e6cc330c903430ee47efe2228bbe7fd2693d24515ec091a4afee2f8868d'},
 'reference-square-2000':{hr:'86d425839bc958e5a5a5b73ea67240b921c16f789140d4a185a9d83094328f2f',
 matte:'9478e672ad71450fd0a0470bdb9f4a839fb8d1bd1fb14c866ba5140bfa878764'}};
const caseId=new URLSearchParams(window.location.search).get('case')||'reference-01';
const storageBufferCacheMode=new URLSearchParams(window.location.search).get('storage-cache')||'default';
if(!['default','disabled','lazyRelease'].includes(storageBufferCacheMode))throw Error('Unsupported storage cache mode');
const expected=expectedByCase[caseId];
if(!expected)throw Error('Unsupported diagnostic case');
let operation=0,job=0,pending;
const note=data=>{probe.events.push({...data,observedAtMs:performance.now()});document.querySelector('#status').textContent=JSON.stringify(probe.events.at(-1),null,2);};
function stop(){++operation;probe.worker?.terminate();probe.worker=null;if(pending){pending.reject(Error('cancelled'));pending=null;}}
function request(message,type){
 if(pending)throw Error('A request is already pending');
 return new Promise((resolve,reject)=>{const jobId=++job;pending={resolve,reject,type,jobId};probe.worker.postMessage({...message,jobId});});
}
function create(token){
 if(operation!==token)throw Error('cancelled');
 if(probe.worker)throw Error('Previous Worker not terminated');
 const worker=new Worker('/model-worker.js',{type:'module'});probe.worker=worker;
 worker.onmessage=({data})=>{
  if(operation!==token || probe.worker!==worker)return;
  // Prior full-output comparisons pin the SHA; do not retain another 16MB tensor in page state.
  if(data.output)delete data.output;
  note(data);
  if(data.type==='error'||data.type==='device-lost'){if(pending){pending.reject(Error(data.type));pending=null;}probe.state='error';return;}
  if(pending&&data.jobId===pending.jobId&&data.type===pending.type){const p=pending;pending=null;p.resolve(data);}
 };
 worker.onerror=()=>{if(operation!==token)return;note({type:'error',phase:'worker'});probe.state='error';if(pending){pending.reject(Error('Worker failed'));pending=null;}};
}
document.querySelector('#cancel').onclick=()=>{stop();probe.state='cancelled';note({type:'cancelled'});};
document.querySelector('#start').onclick=async()=>{
 if(probe.state!=='idle')return;
 probe.state='running';const token=++operation;const started=performance.now();
 try{
  for(const role of ['hr','matte']){
   if(operation!==token)throw Error('cancelled');
   const response=await fetch('/configs/'+role+'.json',{cache:'no-store'});
   if(!response.ok)throw Error('Configuration HTTP failure');const config=await response.json();
   if(!config.cases.some(c=>c.id===caseId))throw Error('Case missing from fixed configuration');
   create(token);note({type:'stage',role,phase:'load'});
   const ready=await request({type:'load',config,strict:role==='hr',diagnostic:false,storageBufferCacheMode},'ready');
   note({type:'stage',role,phase:'run'});
   const result=await request({type:'run',caseId},'result');
   if(result.outputSha256!==expected[role])throw Error('Output SHA changed from captured reference');
   note({type:'stage',role,phase:'release'});
   const disposed=await request({type:'dispose'},'disposed');
   probe.worker.terminate();probe.worker=null;
   probe.runs.push({role,modelId:config.modelId,files:config.files,ready,result,disposed});
   note({type:'stage',role,phase:'worker-terminated'});
  }
  probe.state='complete';probe.totalMs=performance.now()-started;note({type:'complete',totalMs:probe.totalMs});
 }catch(error){if(operation!==token)return;probe.state='error';note({type:'error',phase:'sequence',message:error.message});stop();}
};
