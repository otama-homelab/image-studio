/** Compare published pure JS Pica with tiny pinned Pillow reference. No browser/Canvas/WASM. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const [packageRoot,output]=process.argv.slice(2);
if(!packageRoot||!output||fs.existsSync(output))throw Error('Need extracted verified pica package and new output');
const reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-pillow-resize-reference.json',import.meta.url),'utf8'));
const source=Uint8Array.from(Buffer.from(reference.sourceRgbHex,'hex')),rgba=new Uint8Array(7*5*4);
for(let i=0;i<35;i++){rgba.set(source.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
let forbiddenCalls=0;const forbidden=()=>{forbiddenCalls++;throw Error('Forbidden runtime initialization');};
const context=vm.createContext({module:{exports:{}},exports:{},WebAssembly:undefined,Worker:forbidden,fetch:forbidden,document:undefined,navigator:undefined,setTimeout,clearTimeout,Uint8Array,Uint16Array,Uint32Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer},{codeGeneration:{strings:false,wasm:false}});
const script=fs.readFileSync(path.join(packageRoot,'dist/pica.js'),'utf8');vm.runInContext(script,context);
const pica=context.module.exports({features:['js'],concurrency:1}),cases=[];
for(const c of reference.cases){
 if(c.box){cases.push({name:c.name,status:'unsupported-by-public-buffer-api'});continue;}
 const out=await pica.resizeBuffer({src:rgba,width:7,height:5,toWidth:c.outputSize[0],toHeight:c.outputSize[1],filter:'lanczos3',unsharpAmount:0});
 const expected=Buffer.from(c.rgbHex,'hex');let maxAbs=0,total=0,different=0;const rgb=new Uint8Array(expected.length);
 for(let i=0;i<expected.length;i++){
  const value=out[Math.floor(i/3)*4+i%3];rgb[i]=value;const diff=Math.abs(value-expected[i]);maxAbs=Math.max(maxAbs,diff);total+=diff;if(diff)different++;
 }
 cases.push({name:c.name,status:'measured',rgbComponents:expected.length,differentComponents:different,maxAbsoluteDifference:maxAbs,meanAbsoluteDifference:total/expected.length,picaRgbSha256:createHash('sha256').update(rgb).digest('hex'),pillowRgbSha256:c.sha256});
}
if(forbiddenCalls!==0)throw Error('Unexpected runtime request');
const report={status:'measurement-completed',pica:JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version,pillow:reference.pillow,filter:'lanczos3',sharpening:false,execution:'Published browser-compatible UMD in restricted Node VM, pure JS only',forbiddenCalls,cases,adoption:'not-approved: fractional crop API missing and numerical acceptance unresolved',limits:['Tiny synthetic RGB only; no browser, decode, ICC, alpha or full image quality tested','Name Lanczos does not establish coefficient, phase, boundary or rounding equivalence','No custom resampler was implemented and no product dependency was added']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
