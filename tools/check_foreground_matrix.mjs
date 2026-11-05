/** Small aspect-ratio/iteration-boundary matrix; no photo/model/browser execution. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createForegroundRuntime} from './browser-library-adapter/foreground-runtime.mjs';
import {foregroundToRgba} from './browser-library-adapter/foreground-rgba.mjs';
const [wasm,referencePath,output]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need BOUNDED_WASM MATRIX_REFERENCE NEW_OUTPUT');
const reference=JSON.parse(fs.readFileSync(referencePath));assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');assert.deepEqual(reference.fixtureModes,{byteAlpha:true,dimensionMatrix:true});assert.deepEqual(reference.versions,{numpy:'2.3.5',numba:'0.68.0',llvmlite:'0.50.0'});
const runtime=await createForegroundRuntime(fs.readFileSync(wasm),{maxMemoryBytes:524288}),cases=[];
try{for(const row of reference.cases){
 assert.ok(row.width*row.height<=2048);const input={width:row.width,height:row.height,rgb:Float32Array.from(row.inputRgb),alpha:Float32Array.from(row.inputAlpha)};
 if(row.status==='reference-exception'){assert.equal(row.name,'single');assert.throws(()=>runtime.estimate(input),/invalid-foreground-input/);cases.push({name:row.name,expectedException:true});continue;}
 const beforeRgb=input.rgb.slice(),beforeAlpha=input.alpha.slice(),result=runtime.estimate(input),item={name:row.name,width:row.width,height:row.height};
 for(const name of ['foreground','background']){const expected=Float32Array.from(row[name]),actual=result[name];let maxDifference=0,mismatchingSamples=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);maxDifference=Math.max(maxDifference,delta);if(delta!==0)mismatchingSamples++;}item[name]={maxDifference,mismatchingSamples,byteExact:Buffer.from(actual.buffer).equals(Buffer.from(expected.buffer))};}
 const rgba=foregroundToRgba(Uint8Array.from(Buffer.from(row.rgbBase64,'base64')),Uint8Array.from(Buffer.from(row.alphaBase64,'base64')),result.foreground);item.rgbaByteExact=Buffer.from(rgba).equals(Buffer.from(row.rgbaBase64,'base64'));assert.deepEqual(input.rgb,beforeRgb);assert.deepEqual(input.alpha,beforeAlpha);cases.push(item);
}}finally{runtime.close();}
const passed=cases.every(row=>row.expectedException||(row.foreground.byteExact&&row.background.byteExact&&row.rgbaByteExact)),report={status:passed?'passed':'mismatch',cases,caseCount:cases.length,budgetBytes:524288,inputsUnchanged:true,limits:['Small synthetic dimensions up to37px around iteration threshold, no full-size acceptance','Node WASM and host Math only; browser/model/visual quality untested','Budget is linear memory, not process RSS or physical memory release']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,caseCount:cases.length,mismatches:cases.filter(row=>!row.expectedException&&(!row.foreground.byteExact||!row.background.byteExact||!row.rgbaByteExact))}));if(!passed)process.exitCode=1;
