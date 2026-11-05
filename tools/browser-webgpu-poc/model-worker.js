import * as ort from '/runtime/ort.webgpu.min.mjs';
import {readWarmModel} from './stored-model.mjs';
let config;
let session;
let device;
let strict;
let runNumber = 0;
let totalBytes = 0;
let currentJob;
let busy = false;
const gpuKernels = new Map();
const send = (type,detail={}) => self.postMessage({type,jobId:currentJob,...detail});
const hex = buffer => [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
function summarizeTensor(type, data, dims) {
  if (!['float16','float32'].includes(type)) throw new Error('Diagnostic tensor must be FP16 or FP32');
  const bytesPerElement = type === 'float16' ? 2 : 4;
  const elements = dims.reduce((a,b)=>a*b,1);
  if (data.byteLength !== elements*bytesPerElement) throw new Error('Diagnostic tensor byte/shape mismatch');
  const values = type === 'float16'
    ? new Uint16Array(data.buffer,data.byteOffset,elements)
    : new Float32Array(data.buffer,data.byteOffset,elements);
  const result = {elements,finite:0,nan:0,positiveInfinity:0,negativeInfinity:0,
    firstNonfiniteIndex:null,min:null,max:null};
  let minimum=Infinity, maximum=-Infinity;
  for (let i=0;i<elements;i++) {
    let value=values[i];
    if (type === 'float16') {
      const sign=(value&0x8000)?-1:1, exponent=(value>>>10)&31, fraction=value&1023;
      value=exponent===31 ? (fraction?NaN:sign*Infinity)
        : sign*(exponent===0 ? 2**-14*fraction/1024 : 2**(exponent-15)*(1+fraction/1024));
    }
    if (Number.isFinite(value)) {result.finite++;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
    else {
      if (result.firstNonfiniteIndex===null) result.firstNonfiniteIndex=i;
      if (Number.isNaN(value)) result.nan++;
      else if (value>0) result.positiveInfinity++;
      else result.negativeInfinity++;
    }
  }
  if (result.finite) {result.min=minimum;result.max=maximum;}
  return result;
}
async function verifiedFetch(file) {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error('HTTP '+response.status+' for '+file.name);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.bytes) throw new Error('Byte length mismatch for '+file.name);
  if (hex(await crypto.subtle.digest('SHA-256',bytes)) !== file.sha256) throw new Error('SHA256 mismatch for '+file.name);
  totalBytes += bytes.byteLength;
  send('progress',{phase:'verified-fetch',file:file.name,bytes:bytes.byteLength,totalBytes});
  return bytes;
}
function storageCacheOptions(mode) {
  if(mode === undefined || mode === 'default')return {};
  if(!['disabled','lazyRelease'].includes(mode))throw new Error('Unsupported diagnostic storage cache mode');
  return {storageBufferCacheMode:mode};
}
async function load(message) {
  const cacheOptions = storageCacheOptions(message.storageBufferCacheMode);
  if (session || device) throw new Error('Dispose the existing session before loading another model');
  config = message.config; strict = message.strict;
  const started = performance.now();
  const modelSource=message.modelSource??'network';
  if(!['network','opfs-warm'].includes(modelSource))throw Error('Unsupported model source');
  // Verify and collect existing bytes before requesting a GPU. Never fetch on a miss.
  const warm=modelSource==='opfs-warm'?await readWarmModel(config,file=>send('progress',{phase:'warm-cache-file',name:file.name,bytes:file.bytes})):null;
  const adapterStarted=performance.now();
  if (!navigator.gpu) throw new Error('WebGPU not exposed in this Worker');
  const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  if (config.precision === 'float16' && !adapter.features.has('shader-f16')) {
    throw new Error('This FP16 model requires shader-f16');
  }
  const info = adapter.info ?? {};
  const adapterInfo = {vendor:info.vendor,architecture:info.architecture,device:info.device,
    description:info.description,isFallbackAdapter:info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null};
  const requiredLimits = {};
  for (const key of ['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize',
    'maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupSizeZ']) {
    requiredLimits[key] = adapter.limits[key];
  }
  device = await adapter.requestDevice({requiredLimits,
    requiredFeatures:['shader-f16','timestamp-query','subgroups'].filter(feature=>adapter.features.has(feature))});
  const ownedDevice = device;
  device.lost.then(info => {
    if (device === ownedDevice) send('device-lost',{reason:info.reason,message:info.message});
  });
  device.addEventListener('uncapturederror',event => console.error('GPU validation: '+event.error.message));
  const diagnostic = message.diagnostic !== false;
  ort.env.logLevel = diagnostic ? 'verbose' : 'warning'; ort.env.debug = diagnostic;
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('/runtime/',self.location).href;
  ort.env.webgpu.adapter = adapter;
  ort.env.webgpu.profiling = diagnostic ? {mode:'default',ondata:data=>{
    const name = data.kernelType ?? data.programName ?? 'unknown';
    gpuKernels.set(name,(gpuKernels.get(name)??0)+1);
  }} : {mode:'off'};
  const fetchStarted = performance.now();
  const modelFile = config.files.find(file=>file.name.endsWith('.onnx'));
  if (!modelFile) throw new Error('ONNX file missing');
  const read=async file=>{if(!warm)return verifiedFetch(file);const stored=warm.files.find(item=>item.name===file.name);if(!stored?.data)throw Error('Verified warm artifact missing');totalBytes+=stored.bytes;return stored.data;};
  const model = await read(modelFile);
  const externalData = [];
  for (const file of config.files.filter(file=>file !== modelFile)) {
    externalData.push({path:file.name,data:await read(file)});
  }
  const modelFetchAndShaMs = warm?0:performance.now()-fetchStarted;
  send('progress',{phase:'session-create',strict,adapter:adapterInfo,requiredLimits});
  const sessionStarted = performance.now();
  session = await ort.InferenceSession.create(model,{executionProviders:[{name:'webgpu',device,...cacheOptions}],
    externalData,enableProfiling:diagnostic,logSeverityLevel:diagnostic?0:2,logVerbosityLevel:diagnostic?1:0,
    extra:{session:{disable_cpu_ep_fallback:strict?'1':'0'}}});
  send('ready',{modelId:config.modelId,runtimeVersion:ort.env.versions.web,strict,adapter:adapterInfo,
    requiredLimits,totalBytes,modelSource,modelNetworkBytes:warm?0:config.files.reduce((sum,file)=>sum+file.bytes,0),modelCacheReadAndShaMs:warm?.readAndHashMs??0,adapterSetupMs:fetchStarted-adapterStarted,modelFetchAndShaMs,sessionCreateMs:performance.now()-sessionStarted,
    diagnostic,storageBufferCacheMode:message.storageBufferCacheMode ?? 'default',loadMs:performance.now()-started,inputNames:session.inputNames,outputNames:session.outputNames});
}
async function run(message) {
  if (!session) throw new Error('Session not ready');
  const item = config.cases.find(item=>item.id===message.caseId);
  if (!item) throw new Error('Unknown case ID');
  const bytes = await verifiedFetch({...item,name:item.file});
  const dtype = item.dtype;
  if (!['float16','float32'].includes(dtype) || dtype !== config.precision) {
    throw new Error('Input dtype contract mismatch');
  }
  const elementBytes = dtype === 'float16' ? 2 : 4;
  if (bytes.byteLength % elementBytes) throw new Error('Input byte alignment mismatch');
  // Uint16Array carries the original IEEE binary16 bits; no numeric conversion.
  const data = dtype === 'float16'
    ? new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2)
    : new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const expectedElements = item.shape.reduce((a,b)=>a*b,1);
  if (data.length !== expectedElements) throw new Error('Input shape mismatch');
  const input = new ort.Tensor(dtype,data,item.shape);
  let results;
  const started = performance.now();
  try {
    gpuKernels.clear();
    results = await session.run({[config.inputName]:input});
    const output = results[config.outputName];
    if (config.diagnosticCheckpoint) {
      const expected = config.diagnosticCheckpoint;
      if (!output || output.type!==expected.output_dtype || output.dims.join(',')!==expected.output_shape.join(',')) {
        throw new Error('Checkpoint output type/shape mismatch');
      }
      const data = await output.getData();
      const statistics = summarizeTensor(output.type,data,output.dims);
      send('diagnostic-result',{caseId:item.id,shape:output.dims,outputDtype:output.type,statistics,
        runNumber:++runNumber,runMsIncludingReadback:performance.now()-started,strict,
        scope:'Intermediate original-dtype diagnostic; not full model or alpha acceptance'});
      return;
    }
    if (!output || output.type !== 'float32') throw new Error('Expected float32 alpha output');
    const expected = [1,1,...item.shape.slice(2)];
    if (output.dims.join(',') !== expected.join(',')) throw new Error('Output shape mismatch');
    const pixels = new Float32Array(await output.getData());
    if (!pixels.every(Number.isFinite)) {
      send('nonfinite-output',{shape:output.dims,outputDtype:output.type,
        statistics:summarizeTensor(output.type,pixels,output.dims)});
      throw new Error('Non-finite output');
    }
    const runMs = performance.now()-started;
    const digest = hex(await crypto.subtle.digest('SHA-256',pixels));
    const report = {type:'result',jobId:currentJob,caseId:item.id,shape:output.dims,outputDtype:'float32',
      outputSha256:digest,runNumber:++runNumber,runMsIncludingReadback:runMs,strict,
      gpuProfilingCounts:Object.fromEntries(gpuKernels),totalBytes,output:pixels.buffer};
    self.postMessage(report,[pixels.buffer]);
  } finally {
    input.dispose();
    for (const output of Object.values(results??{})) output.dispose();
  }
}
async function dispose() {
  const started=performance.now(),ownedSession=session,ownedDevice=device;
  // Clear ownership before intentional destruction so device.lost isn't a new job failure.
  session=undefined;device=undefined;config=undefined;
  try { if(ownedSession) await ownedSession.release(); }
  finally { if(ownedDevice) ownedDevice.destroy(); }
  gpuKernels.clear();runNumber=0;totalBytes=0;
  send('disposed',{releaseMs:performance.now()-started});
}
self.onmessage = async ({data}) => {
  if (busy) {
    self.postMessage({type:'error',jobId:data.jobId,phase:data.type,message:'A Worker operation is already active'});
    return;
  }
  busy = true;
  currentJob = data.jobId;
  try {
    if (data.type === 'load') await load(data);
    else if (data.type === 'run') await run(data);
    else if (data.type === 'dispose') await dispose();
    else throw new Error('Unknown Worker operation');
  } catch (error) {
    send('error',{phase:data.type,caseId:data.caseId,name:error.name??'Error',message:String(error.message??error),strict,totalBytes});
  } finally { busy = false; }
};
