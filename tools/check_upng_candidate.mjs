/** Small-fixture comparison only. No app import, package install, browser or WASM initialization. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [candidateFile,manifestFile,outputFile]=process.argv.slice(2);
if(!outputFile||fs.existsSync(outputFile))throw Error('Need candidate source, fixture manifest and a new output file');
const source=fs.readFileSync(candidateFile,'utf8'),require=createRequire(new URL('../web/package.json',import.meta.url));
const moduleObject={exports:{}};
vm.runInNewContext(source,{module:moduleObject,require:name=>{if(name!=='pako')throw Error('Unexpected candidate import');return require('pako');}},{timeout:1000});
const UPNG=moduleObject.exports,manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),directory=path.dirname(manifestFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=bytes=>new Uint8Array(UPNG.toRGBA8(UPNG.decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)))[0]);
const cases=manifest.fixtures.map(item=>{
 const bytes=fs.readFileSync(path.join(directory,item.file));if(sha(bytes)!==item.sha256)throw Error('Fixture hash mismatch');
 try{const actual=decode(bytes),expected=Buffer.from(item.rgbaBase64,'base64');let mismatchedBytes=0,firstMismatch;
  for(let i=0;i<Math.max(actual.length,expected.length);i++)if(actual[i]!==expected[i]){mismatchedBytes++;firstMismatch??=i;}
  return {file:item.file,depth:item.depth,interlace:item.interlace,matches:mismatchedBytes===0,mismatchedBytes,...(firstMismatch!==undefined?{firstMismatch}: {})};
 }catch{return {file:item.file,depth:item.depth,interlace:item.interlace,matches:false,rejected:true};}
});
const corrupt=Buffer.from(fs.readFileSync(path.join(directory,'p1-3x5.png')));if(corrupt.toString('ascii',37,41)!=='PLTE')throw Error('Unexpected CRC fixture layout');corrupt[41]^=1;let corruptedPlteCrcAccepted=false;try{decode(corrupt);corruptedPlteCrcAccepted=true;}catch{}
const report={candidate:'upng-js@2.1.0',sourceSha256:sha(source),api:'UPNG.decode + UPNG.toRGBA8',cases,matched:cases.filter(x=>x.matches).length,total:cases.length,corruptedPlteCrcAccepted,adoption:'not adopted',scope:'Private small synthetic fixtures, Node VM plus existing pako; not a browser/memory acceptance'};
fs.writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({matched:report.matched,total:report.total,corruptedPlteCrcAccepted}));
