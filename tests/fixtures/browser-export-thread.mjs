/** Execute the browser bundle in a restricted VM; transport still uses a real Node thread. */
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {parentPort,workerData} from 'node:worker_threads';
const listeners=[];let networkAttempts=0,assetRequests=0,proof,wasmCompiles=0,gpuPresenceProbes=0;const instances=[];
const allowWasm=workerData.allowWasm===true;
const sandbox={...(workerData.fixedAsset?{AbortController,AbortSignal,ReadableStream,DOMException,crypto:webcrypto}:{}),ArrayBuffer,DataView,Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,TextEncoder,TextDecoder,Blob,URL,Request,Response,Headers,performance,setTimeout,clearTimeout,queueMicrotask,
 navigator:Object.freeze({hardwareConcurrency:1,...(workerData.fixedAsset?{userAgent:'crop-worker-fixture'}:{}),...(workerData.webgpuPresence?{gpu:Object.freeze({async requestAdapter(){gpuPresenceProbes++;return {features:new Set(['shader-f16'])};}})}:{})}),atob,
 WebAssembly:allowWasm?{Module:WebAssembly.Module,Memory:WebAssembly.Memory,RuntimeError:WebAssembly.RuntimeError,async compile(bytes){wasmCompiles++;return WebAssembly.compile(bytes);},async instantiate(module,imports){const instance=await WebAssembly.instantiate(module,imports);instances.push(instance);return instance;}}:undefined,
 fetch(input,options){if(workerData.fixedAsset&&String(input)===workerData.fixedAsset.url&&(options?.method??'GET')==='GET'){assetRequests++;return Promise.resolve(new Response(workerData.fixedAsset.bytes));}networkAttempts++;throw Error('Unexpected network request');},
 addEventListener(type,listener){if(type!=='message')throw Error('Unexpected event registration');listeners.push(listener);},
 postMessage(event,transfer=[]){parentPort.postMessage({type:'sandbox-proof',...proof,networkAttempts,assetRequests,wasmCompiles,gpuPresenceProbes,linearMemoryBytes:instances.map(i=>i.exports.memory.buffer.byteLength)});parentPort.postMessage(event,transfer);},
};
sandbox.self=sandbox;if(workerData.webgpuPresence)sandbox.constructor={name:'DedicatedWorkerGlobalScope'};
const context=vm.createContext(sandbox,{name:'browser-export-worker',codeGeneration:{strings:false,wasm:allowWasm}});
if(allowWasm&&workerData.trap)vm.runInContext("Math.sin=()=>{throw Error('private trap')}",context);
new vm.Script(typeof workerData.browserSource==='string'?workerData.browserSource:fs.readFileSync(workerData.browserBundle,'utf8'),{filename:'export-worker.js'}).runInContext(context,{timeout:5000});
proof={nodeGlobalsAbsent:vm.runInContext("typeof process==='undefined'&&typeof Buffer==='undefined'&&typeof require==='undefined'",context),wasmAbsent:vm.runInContext("typeof WebAssembly==='undefined'",context),dynamicCodeDisabled:true};
try{vm.runInContext('new Function("return 1")',context);throw Error('Dynamic code was not blocked');}catch(error){if(error.name!=='EvalError')throw error;}
parentPort.on('message',data=>{for(const listener of listeners)listener({data});});
