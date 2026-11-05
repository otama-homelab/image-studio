import {isPrivateValidationOrigin} from './browser-library-adapter/private-validation-origin.mjs';
/** Offline byte inventory for a private candidate. Never approves or deploys it. */
import {constants} from 'node:fs';
import {open,readFile,writeFile,realpath,lstat,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
async function regular(root,filename){
 const requested=path.resolve(filename);if(!(await lstat(requested)).isFile())throw Error('Regular private artifact file required');
 const resolved=await realpath(requested);if(!inside(root,resolved))throw Error('Artifact source outside private root');return resolved;
}
async function digestFile(filename,expected){
 const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.size!==BigInt(expected.bytes))throw Error('Artifact size mismatch');
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:1024*1024})){
   bytes+=chunk.length;if(bytes>expected.bytes)throw Error('Artifact grew during read');digest.update(chunk);
  }
  if(bytes!==expected.bytes||digest.digest('hex')!==expected.sha256)throw Error('Artifact SHA mismatch');
  if(!same(before,await handle.stat({bigint:true}))||!same(before,await stat(filename,{bigint:true})))throw Error('Artifact changed during review');
  return {stamp:before,bytes};
 }finally{await handle.close();}
}
export async function createPrivateArtifactReview(rootText,manifestText){
 const root=await realpath(rootText),manifestFile=await regular(root,manifestText);
 const initial=await stat(manifestFile,{bigint:true});if(initial.size>8n*1024n*1024n)throw Error('Private manifest oversized');
 const manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes);
 if(manifest.status!=='local-app-built-not-started'||manifest.scope!=='local-validation-only-not-approved-for-distribution'||manifest.distributionApproved!==false)throw Error('Private candidate manifest required');
 const origin=new URL(manifest.appOrigin);
 if(!isPrivateValidationOrigin(manifest.appOrigin,manifest.privateLanHttps===true))throw Error('Explicit private validation origin required');
 if(manifest.privateLanHttps===true&&(manifest.backgroundModel!=='modnet'||manifest.runtimeConfig?.executionProvider!=='wasm'||manifest.runtimeConfig.modelVariants?.length))throw Error('Private LAN requires CPU-only MODNet');
 if(!/^[a-f0-9]{64}$/.test(manifest.policySha256??'')||!Array.isArray(manifest.mounts)||!manifest.mounts.length||manifest.mounts.length>16384)throw Error('Invalid private manifest');
 const routes=new Set(),checked=new Map(),files=[];let bytesRead=0,totalBytes=0;
 // Validate every declaration before reading payloads; do not trust builder stat-only checks.
 const plans=[];
 for(const item of manifest.mounts){
  if(typeof item.route!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(item.route)||item.route.includes('//')||item.route.split('/').some(part=>part==='.'||part==='..')||new URL(item.route,origin).pathname!==item.route||routes.has(item.route)
   ||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256??'')||typeof item.source!=='string'||!path.isAbsolute(item.source))throw Error('Invalid or duplicate artifact mount');
  routes.add(item.route);totalBytes+=item.bytes;if(!Number.isSafeInteger(totalBytes))throw Error('Artifact total overflow');
  const source=await regular(root,item.source);plans.push({source,route:item.route,bytes:item.bytes,sha256:item.sha256});
 }
 if(!routes.has(manifest.entry))throw Error('Missing candidate entry');
 for(const {source,route,bytes,sha256} of plans){
  const prior=checked.get(source);
  if(prior){if(prior.bytes!==bytes||prior.sha256!==sha256)throw Error('Conflicting source declarations');}
  else{const result=await digestFile(source,{bytes,sha256});checked.set(source,{...result,sha256});bytesRead+=result.bytes;}
  files.push({route,bytes,sha256});
 }
 // Catch changes after an earlier streamed read, including a later alias declaration.
 for(const [source,record] of checked)if(!same(record.stamp,await stat(source,{bigint:true})))throw Error('Artifact changed during review');
 if(!same(initial,await stat(manifestFile,{bigint:true}))||sha(await readFile(manifestFile))!==sha(manifestBytes))throw Error('Manifest changed during review');
 files.sort((a,b)=>a.route<b.route?-1:a.route>b.route?1:0);
 const content={schemaVersion:1,scope:'private-byte-review-not-distribution-approval',distributionApproved:false,appOrigin:manifest.appOrigin,entry:manifest.entry,policySha256:manifest.policySha256,totalBytes,files};
 return {...content,artifactId:'sha256:'+sha(JSON.stringify(content)),reviewedManifestSha256:sha(manifestBytes),verification:{method:'all-unique-sources-streamed-sha256',uniqueSources:checked.size,bytesRead}};
}
export async function verifyPrivateArtifactReview(root,manifest,inventory){
 const actual=await createPrivateArtifactReview(root,manifest);
 if(!isDeepStrictEqual(actual,inventory))throw Error('Private artifact differs from review');return actual;
}
export async function writePrivateArtifactReview(rootText,manifest,output){
 const root=await realpath(rootText),target=path.join(await realpath(path.dirname(path.resolve(output))),path.basename(output));
 if(!inside(root,target))throw Error('Keep private review output inside private root');
 const review=await createPrivateArtifactReview(root,manifest);
 await writeFile(target,JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});return review;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,root,manifest,output]=process.argv.slice(2);if(!['create','verify'].includes(mode)||!root||!manifest||!output||process.argv.length!==6)throw Error('Use create|verify PRIVATE_ROOT CANDIDATE_MANIFEST REVIEW_JSON');
 const review=mode==='create'?await writePrivateArtifactReview(root,manifest,output):await verifyPrivateArtifactReview(root,manifest,JSON.parse(await readFile(output,'utf8')));
 console.log(JSON.stringify({status:mode==='create'?'private-byte-review-created-no-approval':'private-bytes-match-review',artifactId:review.artifactId,files:review.files.length,bytes:review.totalBytes,...review.verification,distributionApproved:false}));
}
