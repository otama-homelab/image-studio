/** Offline staging only. No upload, deployment, model or WebAssembly initialization. */
import {createReadStream,constants} from 'node:fs';
import {readFile,lstat,mkdir,copyFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export async function verifyArtifact(file,expected){
 const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==expected.bytes)throw Error('runtime-artifact-size-or-type');
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
 if(hash.digest('hex')!==expected.sha256)throw Error('runtime-artifact-sha');
}
export async function verifyRuntimeStage(output,runtimeFamily='native'){
 if(!['native','jsep'].includes(runtimeFamily))throw Error('runtime-family-mismatch');
 const root=await lstat(output);if(!root.isDirectory()||root.isSymbolicLink())throw Error('runtime-stage-directory');
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const trusted=JSON.parse(await readFile(path.join(repo,'docs/browser',runtimeFamily==='jsep'?'runtime-assets.jsep.candidate.json':'runtime-assets.candidate.json'),'utf8'));
 const notices=JSON.parse(await readFile(path.join(repo,'docs/browser/runtime-notices/sources.json'),'utf8')).sources.map(({file,bytes,sha256})=>({file,bytes,sha256}));
 const receipt=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
 const files=trusted.files.map(({url,...file})=>({...file,key:`runtime/ort/${trusted.version}/${file.sha256}/${file.name}`}));
 if(receipt.status!=='staged-not-deployed'||receipt.deploymentPerformed!==false||receipt.runtimeFamily!==runtimeFamily||receipt.runtime!==trusted.runtime||receipt.version!==trusted.version||receipt.wasmFamily!==trusted.wasmFamily||!isDeepStrictEqual(receipt.entrypoint,trusted.entrypoint)||!isDeepStrictEqual(receipt.files,files)||!isDeepStrictEqual(receipt.notices,notices))throw Error('runtime-stage-contract-mismatch');
 const expected=new Map(files.map(file=>[`${file.hosting}/${file.key}`,file]));
 for(const notice of notices)expected.set(`pages/runtime/ort/${trusted.version}/${notice.file}`,notice);
 const found=new Set();
 async function visit(directory){
  for(const name of await readdir(directory)){
   const file=path.join(directory,name),stat=await lstat(file),key=path.relative(output,file).split(path.sep).join('/');
   if(stat.isSymbolicLink())throw Error('runtime-stage-symlink');
   if(stat.isDirectory()){await visit(file);continue;}
   if(!stat.isFile()||(key!=='manifest.json'&&!expected.has(key)))throw Error('runtime-stage-unexpected-file');
   found.add(key);
  }
 }
 await visit(output);
 for(const [key,file] of expected){if(!found.has(key))throw Error('runtime-stage-missing-file');await verifyArtifact(path.join(output,key),file);}
 return {status:'runtime-stage-verified-not-deployed',runtimeFamily,version:trusted.version,files:expected.size,totalBytes:[...expected.values()].reduce((sum,file)=>sum+file.bytes,0),deploymentPerformed:false};
}
export async function stageRuntime(packageRoot,output,runtimeFamily='native'){
 try{await lstat(output);throw Error('runtime-output-exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(!['native','jsep'].includes(runtimeFamily))throw Error('runtime-family-mismatch');
 const manifest=JSON.parse(await readFile(path.join(repo,'docs/browser',runtimeFamily==='jsep'?'runtime-assets.jsep.candidate.json':'runtime-assets.candidate.json'),'utf8'));
 const expected=runtimeFamily==='jsep'?{family:'jsep',init:'jsepInit',entry:'ort.bundle.min.mjs'}:{family:'asyncify',init:'webgpuInit',entry:'ort.webgpu.bundle.min.mjs'};
 const pkg=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8'));
 if(pkg.name!=='onnxruntime-web'||pkg.version!==manifest.version||manifest.version!=='1.31.1'||manifest.files.length!==2)throw Error('runtime-package-mismatch');
 if(manifest.wasmFamily!==expected.family||manifest.requiredModuleExport!==expected.init||manifest.entrypoint?.name!==expected.entry)throw Error('runtime-family-mismatch');
 await verifyArtifact(path.join(packageRoot,'dist',manifest.entrypoint.name),manifest.entrypoint);
 const entry=await readFile(path.join(packageRoot,'dist',manifest.entrypoint.name),'utf8');
 if(!entry.includes(`ort-wasm-simd-threaded.${expected.family}.mjs`)||!entry.includes(manifest.requiredModuleExport))throw Error('runtime-entry-abi-mismatch');
 for(const file of manifest.files){
  const extension=file.hosting==='pages'?'mjs':file.hosting==='r2'?'wasm':null;
  if(!extension||file.name!==`ort-wasm-simd-threaded.${manifest.wasmFamily}.${extension}`||!Number.isSafeInteger(file.bytes)||file.bytes<1||!/^[a-f0-9]{64}$/.test(file.sha256)||(file.hosting==='pages'&&file.bytes>manifest.pagesAssetLimitBytes))throw Error('invalid-runtime-manifest');
  await verifyArtifact(path.join(packageRoot,'dist',file.name),file);
  if(extension==='mjs'&&!(await readFile(path.join(packageRoot,'dist',file.name),'utf8')).includes(manifest.requiredModuleExport))throw Error('runtime-module-abi-mismatch');
 }
 const noticeRoot=path.join(repo,'docs/browser/runtime-notices'),notices=JSON.parse(await readFile(path.join(noticeRoot,'sources.json'),'utf8'));
 for(const notice of notices.sources){if(!['LICENSE.txt','ThirdPartyNotices.txt'].includes(notice.file))throw Error('invalid-runtime-notice');await verifyArtifact(path.join(noticeRoot,notice.file),notice);}
 // Existing output is never overwritten. A failed partial output has no complete manifest.
 await mkdir(output,{mode:0o700});const staged=[];
 for(const file of manifest.files){
  const key=`runtime/ort/${manifest.version}/${file.sha256}/${file.name}`,destination=path.join(output,file.hosting,key);
  await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await copyFile(path.join(packageRoot,'dist',file.name),destination,constants.COPYFILE_EXCL);await verifyArtifact(destination,file);
  staged.push({...file,key,url:undefined});
 }
 for(const notice of notices.sources){const destination=path.join(output,'pages','runtime','ort',manifest.version,notice.file);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await copyFile(path.join(noticeRoot,notice.file),destination,constants.COPYFILE_EXCL);await verifyArtifact(destination,notice);}
 const report={status:'staged-not-deployed',runtimeFamily,entrypoint:manifest.entrypoint,wasmFamily:manifest.wasmFamily,runtime:manifest.runtime,version:manifest.version,files:staged,notices:notices.sources.map(({file,bytes,sha256})=>({file,bytes,sha256})),urlConfiguration:{appOrigin:null,wasmOrigin:null,mjsPath:'/'+staged.find(file=>file.hosting==='pages').key,wasmPath:'/'+staged.find(file=>file.hosting==='r2').key},deploymentPerformed:false,limits:['Pages directory is an overlay, not a complete application','R2 origin/CORS and app CSP are not configured or accepted','Upstream complete notices retained; binary-specific legal and runtime acceptance remain']};
 await writeFile(path.join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--verify'){
  if(!process.argv[3]||process.argv.length>5)throw Error('Need --verify PRIVATE_STAGE [native|jsep]');
  console.log(JSON.stringify(await verifyRuntimeStage(path.resolve(process.argv[3]),process.argv[4])));
 }else{
 const [packageRoot,output,runtimeFamily]=process.argv.slice(2);if(!packageRoot||!output)throw Error('Need ORT_PACKAGE NEW_PRIVATE_OUTPUT');
 const report=await stageRuntime(path.resolve(packageRoot),path.resolve(output),runtimeFamily);console.log(JSON.stringify({status:report.status,files:report.files.map(file=>({hosting:file.hosting,bytes:file.bytes})),deploymentPerformed:false}));
 }
}
