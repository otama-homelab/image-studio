import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
const [library,fixtures,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need library, fixture directory, new output');
const {imageDimensionsFromData}=await import(pathToFileURL(path.resolve(library,'index.js')));
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:128,maxPixels:16384});
const reference=JSON.parse(fs.readFileSync(path.join(fixtures,'report.json'),'utf8'));
assert.equal(reference.status,'reference-captured');assert.equal(reference.pillow,'12.3.0');assert.deepEqual(reference.cases.map(c=>c.orientation),[1,2,3,4,5,6,7,8]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),cases=[];
for(const row of reference.cases){
 const file=fs.readFileSync(path.join(fixtures,row.filename)),pixels=fs.readFileSync(path.join(fixtures,row.referenceFilename));
 assert.equal(sha(file),row.fileSha256);assert.equal(sha(pixels),row.referenceRgbSha256);
 assert.equal(pixels.length,row.expectedSize[0]*row.expectedSize[1]*3);
 const header=await inspect(new Blob([file]));assert.equal(header.type,'jpeg');assert.deepEqual([header.width,header.height],row.rawSize);
 cases.push({orientation:row.orientation,rawSize:row.rawSize,expectedOrientedSize:row.expectedSize,rawHeaderVerified:true});
}
const report={status:'passed',cases,reference,limits:['Real synthetic JPEG headers and Pillow references only','Native browser decoding/EXIF application/color and acceptable pixel difference not tested','No GPU/model/browser initialized']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,cases:cases.length}));
