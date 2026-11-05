// Review/verify one static artifact using existing deployment guards. Never uploads.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {checkDist} from './check-dist.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function createReleaseInventory(root){
 const checked=await checkDist(root),files=[];let build;
 for(const entry of checked.files){
  const bytes=await readFile(join(root,entry.path));
  if(bytes.length!==entry.bytes)throw Error('Artifact changed while inventory was created');
  files.push({...entry,sha256:sha(bytes)});
  if(entry.path==='build-info.json')build=JSON.parse(bytes.toString('utf8'));
 }
 const content={schemaVersion:1,build,totalBytes:checked.totalBytes,files};
 return {...content,artifactId:'sha256:'+sha(JSON.stringify(content))};
}
export async function verifyReleaseInventory(root,inventory){
 const actual=await createReleaseInventory(root);
 if(!isDeepStrictEqual(actual,inventory))throw Error('Artifact differs from the recorded release inventory');
 return actual;
}
export async function writeReleaseInventory(root,target){
 const directory=await realpath(resolve(root)),output=join(await realpath(dirname(resolve(target))),basename(target)),fromRoot=relative(directory,output);
 if(!(isAbsolute(fromRoot)||fromRoot==='..'||fromRoot.startsWith('..'+sep)))throw Error('Keep release inventory outside deploy directory');
 const inventory=await createReleaseInventory(directory);
 await writeFile(output,JSON.stringify(inventory,null,2)+'\n',{flag:'wx',mode:0o600});
 return inventory;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [mode,root,file]=process.argv.slice(2);
 if(!['create','verify'].includes(mode)||!root||!file||process.argv.length!==5)throw Error('Use create|verify DIST_DIRECTORY INVENTORY_JSON');
 const result=mode==='create'?await writeReleaseInventory(root,file):await verifyReleaseInventory(root,JSON.parse(await readFile(file,'utf8')));
 console.log(JSON.stringify({status:mode==='create'?'inventory-created-no-upload':'artifact-matches-inventory',artifactId:result.artifactId,sourceId:result.build.sourceId,files:result.files.length,bytes:result.totalBytes}));
}
