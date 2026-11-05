export const MAX_HR_STAGES=1024;
const MAX_BYTES=1024**3;
export function stageTiming(value){
 if(!value||typeof value!=='object')throw Error('invalid-stage-timing');
 const timing={};
 for(const key of ['prepareMs','inferMs','exportMs','releaseMs']){
  if(!Number.isFinite(value[key])||value[key]<0||value[key]>600000)throw Error('invalid-stage-timing');
  timing[key]=value[key];
 }
 if(value.runtimeConfigureMs!==undefined||value.modelLoadMs!==undefined){
  for(const key of ['runtimeConfigureMs','modelLoadMs']){
   if(!Number.isFinite(value[key])||value[key]<0||value[key]>600000)throw Error('invalid-stage-timing');
   timing[key]=value[key];
  }
 }
 const resourceFields=['resourceReadWaitSumMs','resourceHashWorkSumMs','resourceVerifiedBytes','resourceVerifiedStreams'];
 if(resourceFields.some(key=>value[key]!==undefined)){
  for(const key of resourceFields){
   const limit=key.endsWith('Ms')?600000:key==='resourceVerifiedBytes'?8*1024**3:1024;
   if(!Number.isFinite(value[key])||value[key]<0||value[key]>limit||(!key.endsWith('Ms')&&!Number.isSafeInteger(value[key])))throw Error('invalid-stage-timing');
   timing[key]=value[key];
  }
 }
 if(value.roundTripMs!==undefined||value.feedPreparationMs!==undefined){
  for(const key of ['roundTripMs','feedPreparationMs']){
   if(!Number.isFinite(value[key])||value[key]<0||value[key]>600000)throw Error('invalid-stage-timing');
   timing[key]=value[key];
  }
 }
 return Object.freeze(timing);
}
export function stagePorts(ports){
 if(!Array.isArray(ports)||!ports.length||ports.length>128)throw Error('invalid-stage-ports');
 const names=new Set();let total=0;
 return Object.freeze(ports.map(port=>{
  if(!port||typeof port.name!=='string'||!port.name||names.has(port.name)||!['float16','float32'].includes(port.dtype)
   ||!Array.isArray(port.dims)||!port.dims.length||port.dims.length>8||port.dims.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('invalid-stage-ports');
  const bytes=port.dims.reduce((a,b)=>a*b,port.dtype==='float16'?2:4);total+=bytes;
  if(!Number.isSafeInteger(bytes)||bytes>MAX_BYTES||total>MAX_BYTES)throw Error('invalid-stage-ports');
  names.add(port.name);return Object.freeze({name:port.name,dtype:port.dtype,dims:Object.freeze([...port.dims]),bytes});
 }));
}
export function stageFeatures(features,ports,{finite=false}={}){
 if(!Array.isArray(features)||features.length!==ports.length)throw Error('invalid-stage-features');
 const buffers=new Set(),byName=new Map();
 for(const feature of features){
  const port=ports.find(p=>p.name===feature?.name);
  if(!port||byName.has(port.name)||feature.dtype!==port.dtype||JSON.stringify(feature.dims)!==JSON.stringify(port.dims)
   ||!(feature.data instanceof ArrayBuffer)||feature.data.byteLength!==port.bytes||buffers.has(feature.data))throw Error('invalid-stage-features');
  if(finite){
   const data=port.dtype==='float16'?new Uint16Array(feature.data):new Float32Array(feature.data);
   for(let i=0;i<data.length;i++)if(port.dtype==='float16'?(data[i]&0x7c00)===0x7c00:!Number.isFinite(data[i]))throw Error('nonfinite-stage-result');
  }
  buffers.add(feature.data);byName.set(port.name,{name:port.name,dtype:port.dtype,dims:[...port.dims],data:feature.data});
 }
 return ports.map(port=>byName.get(port.name));
}
