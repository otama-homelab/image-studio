import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';

// Build-time only. Hash explicit app inputs, never Git state, environment or user files.
// This identifies the source set; it is not a signature or a digest of the final dist.
export function createBuildInfo(webRoot,releaseDirectory=join(webRoot,'background-release')){
 for(const name of ['build-info.json','background-release.json'])if(existsSync(join(webRoot,'public',name)))throw Error('Reserved build metadata asset');
 const files=[];
 function visit(path,logical=path){
  const stat=lstatSync(path);
  if(stat.isSymbolicLink())throw Error('Build input symlink');
  if(stat.isDirectory()){for(const name of readdirSync(path))visit(join(path,name),join(logical,name));return;}
  if(!stat.isFile()||stat.size>25*1024*1024)throw Error('Unsupported build input');
  files.push({path,name:relative(webRoot,logical).replaceAll('\\','/')});
 }
 for(const name of ['src','public','scripts','../tools/browser-library-adapter','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','.node-version','.npmrc','../.github/workflows/web-check.yaml','../LICENSE','../VERSION','../docs/browser/design-tokens.css','../tools/build_browser_release.mjs','../tools/build_browser_model_prepare.mjs','../tools/build_browser_public_stage_worker.mjs','../tools/browser-build-dependencies.mjs','../tools/verify_browser_release_bindings.mjs','../tools/browser-build/package.json','../tools/browser-build/package-lock.json','../tools/browser-build/.npmrc'])visit(join(webRoot,name));
 let hasRelease=false;try{lstatSync(releaseDirectory);hasRelease=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(hasRelease)visit(releaseDirectory,join(webRoot,'background-release'));
 const hash=createHash('sha256');
 for(const {path,name} of files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  const bytes=readFileSync(path);
  hash.update(name+'\0'+bytes.length+'\0').update(bytes);
 }
 const version=readFileSync(join(webRoot,'../VERSION'),'utf8').trim();
 const packageVersion=JSON.parse(readFileSync(join(webRoot,'package.json'),'utf8')).version;
 const lock=JSON.parse(readFileSync(join(webRoot,'package-lock.json'),'utf8'));
 if(packageVersion!==version||lock.version!==version||lock.packages?.['']?.version!==version)throw Error('Web package and lock versions must match VERSION');
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))throw Error('Invalid application version');
 return Object.freeze({schemaVersion:1,appVersion:version,sourceId:'sha256:'+hash.digest('hex')});
}
