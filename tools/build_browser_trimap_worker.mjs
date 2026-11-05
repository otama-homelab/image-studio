/** Offline packaging of the already captured OpenCV distribution; never initializes WASM. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [evaluationRoot,output,compiledDescriptor]=process.argv.slice(2);
if(!evaluationRoot||!output||fs.existsSync(output))throw Error('Need PRIVATE_EVALUATION_ROOT NEW_PRIVATE_OUTPUT');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(evaluationRoot);
const sha=data=>createHash('sha256').update(data).digest('hex');
const captured=relative=>{const file=fs.realpathSync(path.resolve(root,relative));if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('Captured private file required');return file;};
let version,scriptFile,sourceSha,licenses,compiledSource=null;
if(compiledDescriptor){
 const descriptor=JSON.parse(fs.readFileSync(captured(compiledDescriptor)));
 if(descriptor.scope!=='local-validation-only-not-approved-for-distribution'||descriptor.distributionApproved!==false||descriptor.opencvVersion!=='4.11.0')throw Error('Private OpenCV4.11 candidate required');
 scriptFile=captured(descriptor.script);sourceSha=descriptor.scriptSha256;version='4.11.0-no-eval';
 const bytes=fs.readFileSync(scriptFile);
 if(bytes.length>25*1024**2||sha(bytes)!==sourceSha||bytes.includes(Buffer.from('/home/yamato/')))throw Error('Invalid compiled OpenCV artifact');
 const embedded=[...bytes.toString('utf8').matchAll(/data:application\/(?:octet-stream|wasm);base64,([A-Za-z0-9+/=]+)/g)];
 if(embedded.length!==1)throw Error('Expected single embedded WASM artifact');
 const wasm=Buffer.from(embedded[0][1],'base64');if(wasm.subarray(0,4).toString('hex')!=='0061736d'||wasm.includes(Buffer.from('/home/yamato/')))throw Error('Invalid/private embedded WASM');
 const proof=JSON.parse(fs.readFileSync(captured(descriptor.nativeComparison)));
 if(proof.status!=='no-dynamic-js-runtime-and-native-trimap-fixtures-passed'||proof.scriptSha256!==sourceSha||proof.networkAttempts!==0||proof.cases?.length!==8||!proof.cases.every(row=>row.kernelMatches===true))throw Error('Matching no-eval/native comparison required');
 if(!Array.isArray(descriptor.licenses)||!descriptor.licenses.length)throw Error('Captured licenses required');
 licenses=descriptor.licenses.map(file=>{if(!/^[A-Za-z0-9-]+-LICENSE\.txt$/.test(file.name))throw Error('Invalid notice filename');const source=captured(file.source),bytes=fs.readFileSync(source);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('License mismatch');return {name:file.name,source};});
 if(new Set(licenses.map(file=>file.name)).size!==licenses.length)throw Error('Duplicate notices');
 compiledSource={descriptorSha256:sha(fs.readFileSync(captured(compiledDescriptor))),nativeComparisonSha256:sha(fs.readFileSync(captured(descriptor.nativeComparison))),source:descriptor.source};
}else{
 const reference=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/validation/2026-11-01-opencv-trimap-adapter.json')));
 if(reference.package.integrityVerified!==true||reference.package.version!=='4.11.0-release.1')throw Error('Unverified OpenCV package');
 const packageRoot=path.join(root,'opencv-trimap-01');
 for(const file of reference.package.files){const bytes=fs.readFileSync(path.join(packageRoot,file.path));if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Captured OpenCV file mismatch');}
 version=reference.package.version;sourceSha=reference.package.files.find(file=>file.path==='package/dist/opencv.js').sha256;
 scriptFile=path.join(packageRoot,'package/dist/opencv.js');licenses=[{name:'OpenCV-LICENSE.txt',source:path.join(packageRoot,'package/LICENSE')}];
}
const esbuild=createRequire(import.meta.url)(path.join(root,'png-export-01/node_modules/esbuild/lib/main.js'));
fs.mkdirSync(output,{mode:0o700});const outfile=path.join(output,'trimap-worker.js');
const scriptPath=`/runtime/opencv/${version}/${sourceSha}/opencv.js`;
try{
 const result=await esbuild.build({entryPoints:[path.join(repo,'tools/browser-library-adapter/browser-trimap-worker.mjs')],outfile,bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022',legalComments:'linked',metafile:true,logLevel:'silent',define:{__OPENCV_SCRIPT_PATH__:JSON.stringify(scriptPath)}});
 const external=Object.values(result.metafile.outputs).flatMap(item=>item.imports).filter(item=>item.external);if(external.length)throw Error('External trimap Worker import');
 for(const file of licenses)fs.copyFileSync(file.source,path.join(output,file.name),fs.constants.COPYFILE_EXCL);
 const destination=path.join(output,scriptPath.slice(1));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(scriptFile,destination,fs.constants.COPYFILE_EXCL);
 const report={cancellationProtocol:'cooperative-trimap-cancel-v1',status:'built-not-initialized',opencvVersion:version,compiledSource,sourceSha256:sourceSha,classicWorker:true,
  scriptAsset:{path:scriptPath,bytes:fs.statSync(destination).size,sha256:sha(fs.readFileSync(destination))},
  bundleBytes:fs.statSync(outfile).size,bundleSha256:sha(fs.readFileSync(outfile)),externalImports:external,
  limits:['OpenCV/WASM initialization, real morphology and resource use through this bundle remain untested','Packaging existing distribution is not a complete third-party license audit','No models/GPU/browser/server started; no deployment']};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,bundleBytes:report.bundleBytes}));
}finally{esbuild.stop();}
