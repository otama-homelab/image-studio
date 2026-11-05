// Check the actual deploy directory, without loading images, models or a browser.
import {readdir,lstat,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
export async function checkDist(root){
 try{await lstat(join(root,'LOCAL_VALIDATION_ONLY.json'));throw Error('Local validation artifact must not be deployed to Pages');}
 catch(error){if(error?.code!=='ENOENT')throw error;}
 const files=[];
 async function visit(directory){
  for(const name of await readdir(directory)){
   const path=join(directory,name),stat=await lstat(path),key=relative(root,path).replaceAll('\\','/');
   if(['local-validation.html','validation-workers','validation-notices'].includes(key))throw Error(`Private validation entry must not be deployed to Pages: ${key}`);
   if(stat.isSymbolicLink())throw Error(`Deployment symlink: ${key}`);
   if(key==='_worker.js'||key==='_routes.json'||key==='functions')throw Error(`Server execution is not approved for this static deployment: ${key}`);
   if(stat.isDirectory()){if(/^(node_modules|\.git|\.cache|__pycache__)$/.test(name))throw Error(`Private directory: ${key}`);await visit(path);continue;}
   if(!stat.isFile())throw Error(`Unsupported deployment entry: ${key}`);
   if(stat.size>25*1024*1024)throw Error(`Pages asset exceeds 25 MiB: ${key}`);
   if(/(^|\/)\./.test(key)||/\.(onnx|bin|data|gguf|tflite|safetensors|pt|pth|ckpt|py|pyc|pem|key|map)$/i.test(name))throw Error(`Unapproved deployment file: ${key}`);
   files.push({path:key,bytes:stat.size});
  }
 }
 await visit(root);
 if(files.length>20_000)throw Error('Pages Free file count exceeded');
 for(const required of ['index.html','_headers','LICENSE.txt','THIRD_PARTY_NOTICES.txt','logo.svg','examples/fictional-portrait-v1.png','examples/fictional-portrait-v1.webp','examples/fictional-portrait-modnet-cpu-v1.webp','build-info.json'])if(!files.some(file=>file.path===required))throw Error(`Missing deployment file: ${required}`);
 const info=JSON.parse(await readFile(join(root,'build-info.json'),'utf8'));
 if(!info||Object.keys(info).sort().join(',')!=='appVersion,schemaVersion,sourceId'||info.schemaVersion!==1||typeof info.appVersion!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(info.appVersion)||typeof info.sourceId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(info.sourceId))throw Error('Invalid deployment build metadata');
 if(files.some(file=>file.path==='background-release.json')){
  const release=JSON.parse(await readFile(join(root,'background-release.json'),'utf8'));
  if(!release||Object.keys(release).sort().join(',')!=='configSha256,schemaVersion'||release.schemaVersion!==1||typeof release.configSha256!=='string'||!/^[a-f0-9]{64}$/.test(release.configSha256??''))throw Error('Invalid background release metadata');
 }
 const headers=await readFile(join(root,'_headers'),'utf8');
 if(headers.split(/\r?\n/).some(line=>line.length>2000))throw Error('Pages header line exceeds limit');
 return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const result=await checkDist(fileURLToPath(new URL('../dist/',import.meta.url)));
 console.log(`Pages artifact check: ${result.files.length} files, ${result.totalBytes} bytes; no deployment performed`);
}
