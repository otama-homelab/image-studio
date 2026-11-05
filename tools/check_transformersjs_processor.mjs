/** Execute the published library's processor on tiny synthetic buffers, without models. */
import {createVitMatteInference} from './browser-library-adapter/vitmatte-inference.mjs';
import {matteOutputToAlpha} from './browser-library-adapter/matte-output.mjs';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const [bundle,tensorBackend,fixturePath,output]=process.argv.slice(2);
if(!bundle||!tensorBackend||!fixturePath||!output||process.argv.length!==6)throw Error('Need local browser bundle, pure-JS common backend, small fixture JSON and new output JSON');
if(fs.existsSync(output)||fs.statSync(fixturePath).size>8192)throw Error('Use a new result path and a small fixture');
const memorySamples=[{phase:'before-import',rssBytes:process.memoryUsage().rss}];
const inheritedMaxRssKiB=process.resourceUsage().maxRSS;
let networkRequests=0,gpuRequests=0,sessionRequests=0;
globalThis.fetch=async()=>{networkRequests++;throw Error('Network forbidden during processor-only check');};
Object.defineProperty(globalThis.navigator,'gpu',{value:{requestAdapter:async()=>{gpuRequests++;throw Error('GPU forbidden during processor-only check');}},configurable:true});
try {
 const common=await import(pathToFileURL(tensorBackend).href);
 common.InferenceSession.create=async()=>{sessionRequests++;throw Error('Model sessions forbidden during processor-only check');};
 globalThis[Symbol.for('onnxruntime')]=common;
 const {VitMatteImageProcessor,RawImage,Tensor,env}=await import(pathToFileURL(bundle).href);
 env.allowRemoteModels=false;env.allowLocalModels=false;
 memorySamples.push({phase:'after-import',rssBytes:process.memoryUsage().rss});
 const fixture=JSON.parse(fs.readFileSync(fixturePath));
 const processor=new VitMatteImageProcessor(fixture.config);
 const infer=createVitMatteInference({RawImage,VitMatteImageProcessor,processorConfig:fixture.config});
 const rgbPalette=Object.keys(fixture.rgb_values).map(Number),triPalette=Object.keys(fixture.trimap_values).map(Number),cases=[];
 for(const [width,height] of fixture.sizes){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65||height>65)throw Error('Fixture exceeds tiny-test dimensions');
  const rgb=new Uint8Array(width*height*3),tri=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   for(let c=0;c<3;c++)rgb[(y*width+x)*3+c]=rgbPalette[(x+3*y+c)%rgbPalette.length];
   tri[y*width+x]=triPalette[(x+y)%triPalette.length];
  }
  const result=await processor(new RawImage(rgb,width,height,3),new RawImage(tri,width,height,1));
  const tensor=result.pixel_values,pw=Math.ceil(width/32)*32,ph=Math.ceil(height/32)*32;
  if(tensor.type!=='float32'||JSON.stringify(tensor.dims)!==JSON.stringify([1,4,ph,pw]))throw Error('Processor dtype/shape mismatch');
  let maxError=0,paddingViolations=0;
  for(let c=0;c<4;c++)for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
   const actual=tensor.data[(c*ph+y)*pw+x];
   if(!Number.isFinite(actual))throw Error('Nonfinite processor output');
   if(x>=width||y>=height){if(actual!==0)paddingViolations++;continue;}
   const value=c<3?fixture.rgb_values[rgb[(y*width+x)*3+c]]:fixture.trimap_values[tri[y*width+x]];
   maxError=Math.max(maxError,Math.abs(actual-value));
  }
  if(maxError>fixture.processor_absolute_tolerance||paddingViolations)throw Error('Processor differs from captured values or zero-padding contract');
  if(JSON.stringify(result.original_sizes)!==JSON.stringify([[height,width]])||JSON.stringify(result.reshaped_input_sizes)!==JSON.stringify([[height,width]]))throw Error('Processor resized or changed source dimensions');
  const syntheticOutput=new Float32Array(ph*pw).fill(NaN);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)syntheticOutput[y*pw+x]=((x+3*y)%9)/8;
  const alpha=matteOutputToAlpha({data:syntheticOutput,dims:[1,1,ph,pw]},width,height,tri);
  const unknown=[0,32,64,96,128,159,191,223,255];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,expected=tri[i]===128?unknown[(x+3*y)%9]:tri[i];
   if(alpha[i]!==expected)throw Error('Synthetic output crop/anchor mismatch');
  }
  let inputDisposals=0,outputDisposals=0;
  const bridged=await infer({model:async({pixel_values})=>{
   const releaseInput=pixel_values.dispose.bind(pixel_values);pixel_values.dispose=()=>{inputDisposals++;releaseInput();};
   const outputTensor=new Tensor('float32',syntheticOutput.slice(),[1,1,ph,pw]);const releaseOutput=outputTensor.dispose.bind(outputTensor);outputTensor.dispose=()=>{outputDisposals++;releaseOutput();};return {alphas:outputTensor};
  }},{type:'infer',key:{inputId:'processor-fixture',inferenceRevision:1,modelVersion:'synthetic-only'},refine:true,rgb:{width,height,layout:'rgb-u8-interleaved',data:rgb.slice().buffer},hrAlpha:{width,height,layout:'alpha-u8',data:alpha.slice().buffer},trimap:{width,height,layout:'trimap-u8',data:tri.slice().buffer}},{model:'matte'});
  if(!new Uint8Array(bridged.data).every((value,index)=>value===alpha[index])||inputDisposals!==1||outputDisposals!==1)throw Error('Inference adapter or tensor disposal mismatch');
  tensor.dispose();
  cases.push({width,height,shape:[1,4,ph,pw],maxAbsoluteError:maxError,paddingViolations,syntheticOutputCropAndAnchorsMatch:true,inferenceAdapterMatches:true,inputAndOutputDisposedOnce:true});
  memorySamples.push({phase:width+'x'+height,rssBytes:process.memoryUsage().rss});
 }
 if(networkRequests||gpuRequests||sessionRequests)throw Error('Unexpected network/GPU call');
 const report={status:'tiny_published_processor_patterns_match_captured_python_values',library:'@huggingface/transformers 4.3.2 browser bundle',tensorBackend:'Actual ORT Common 1.31.1 JS via library global backend injection; Web 1.31.1 alias only resolves the static import, no inference/runtime initialization tested',networkRequests,gpuRequests,sessionRequests,cases,memoryObservation:{samples:memorySamples,highestObservedRssBytes:Math.max(...memorySamples.map(s=>s.rssBytes)),inheritedMaxRssKiB,rawMaxRssKiB:process.resourceUsage().maxRSS,note:'Sampled current RSS. maxRSS was already high before import and reproduced in an empty Node control; not attributed to this experiment.'},limitations:['Artificial raw RGB/L patterns only; no image decode, resize, ICC or EXIF tested.','Output plane is synthetic, sized from real processor padding; no model/session, full-image equality, cache or browser execution tested.','Captured reference values cover RGB 80/128/200 and trimap 0/128/255; not every uint8 value.','The existing ORT JS alias is a processor-only test setup, not a validated dependency override for the application.']};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}catch(error){console.error((error.stack||error.message).split('\n').slice(0,6).join('\n'));process.exitCode=1;}
