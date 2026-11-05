/** Tiny published-library compatibility check; no model, network or GPU. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {makeHashWasmFactory} from './browser-library-adapter/hash-wasm-factory.mjs';
const {default:library}=await import(pathToFileURL(process.argv[2]).href);
const makeHasher=makeHashWasmFactory(library.createSHA256);
const lengths=[0,3,55,56,63,64,65,127,128,129,1025];
await Promise.all(lengths.map(async length=>{
 const bytes=Uint8Array.from({length},(_,i)=>(i*37+11)%256);
 const hash=await makeHasher();
 for(let offset=0;offset<bytes.length;offset+=7)hash.update(bytes.subarray(offset,offset+7));
 assert.equal(hash.digestHex(),createHash('sha256').update(bytes).digest('hex'));
 assert.throws(()=>hash.update(bytes));assert.throws(()=>hash.digestHex());
}));
const abc=await makeHasher();abc.update(new TextEncoder().encode('abc'));
assert.equal(abc.digestHex(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
console.log(JSON.stringify({status:'passed',independentConcurrentCases:lengths.length,knownAbc:true,maxInputBytes:1025,modelRequests:0,gpuRequests:0}));
