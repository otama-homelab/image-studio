import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
import {createPngInput} from './browser-library-adapter/png-input.mjs';
const [library,dependencies,png,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need dimensions library, dependencies, PNG, new report');
const {imageDimensionsFromData}=await import(pathToFileURL(path.resolve(library,'index.js')));
const {decode}=await import(pathToFileURL(path.resolve(dependencies,'node_modules/fast-png/lib/index.js')));
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const read=createPngInput({inspect,decode}),bytes=fs.readFileSync(png),file=new Blob([bytes]);
const image=await read(file),sha=createHash('sha256').update(new Uint8Array(image.data)).digest('hex');
assert.equal(sha,'4597a0e0561723ccfb93206732afce3a7771fd8cb6017f8dd78dfbfe9f35a16b');
assert.deepEqual([image.width,image.height,image.format],[354,472,'rgb-u8']);
// Real CRC validation, unlike header probing, must reject an altered IDAT byte.
const broken=Uint8Array.from(bytes);let at=8;
while(at<broken.length){const length=new DataView(broken.buffer).getUint32(at);if(String.fromCharCode(...broken.subarray(at+4,at+8))==='IDAT'){broken[at+8]^=1;break;}at+=12+length;}
await assert.rejects(read(new Blob([broken])),e=>e.code==='png-decode-failed');
let calls=0;const abort=new AbortController();abort.abort();
await assert.rejects(createPngInput({inspect,decode(){calls++;}})(file,{signal:abort.signal}),e=>e.code==='aborted');assert.equal(calls,0);
const during=new AbortController();
await assert.rejects(createPngInput({inspect,decode:async(...args)=>{const result=decode(...args);during.abort();return result;}})(file,{signal:during.signal}),e=>e.code==='aborted');
await assert.rejects(createPngInput({inspect,decode:async()=>({...decode(bytes),width:1})})(file),e=>e.code==='image-dimensions-changed');
const decoded=decode(bytes),owned=await createPngInput({inspect,decode:()=>decoded})(file);new Uint8Array(owned.data).fill(0);assert.notEqual(decoded.data[0],0);
const report={status:'passed',cases:6,rgbSha256:sha,dimensions:[354,472],crcFailureRejected:true,lateAbortDiscarded:true,decoderBufferNotAliased:true,limits:['PNG raw RGB/RGBA8 boundary only; RGBA real fixture not yet checked','No EXIF/ICC/color/orientation or grayscale/palette/high-depth normalization acceptance','Real JPEG decode and production input policy unresolved','Synchronous decoder is not interruptible; production must own/terminate its Worker','Node actual fast-png, no GPU/model/browser initialized']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
