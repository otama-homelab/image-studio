import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const invalid=()=>{throw Error('Invalid pinned browser build dependencies');};
export function resolveBrowserBuildDependencies(directory){
 const root=fs.realpathSync(directory),require=createRequire(path.join(root,'package.json'));
 let transformer,ort,hash,esbuild;
 if(fs.existsSync(path.join(root,'package.json'))){
  if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name!=='image-studio-browser-build')invalid();
  const installed=(name,version,file)=>{
   const entry=fs.realpathSync(require.resolve(name)),modules=path.join(root,'node_modules'),relative=path.relative(modules,entry);
   if(relative.startsWith('..')||path.isAbsolute(relative))invalid();
   const pkgRoot=path.dirname(path.dirname(entry)),pkg=JSON.parse(fs.readFileSync(path.join(pkgRoot,'package.json'),'utf8'));
   if(pkg.name!==name||pkg.version!==version)invalid();
   return path.join(pkgRoot,'dist',file);
  };
  transformer=installed('@huggingface/transformers','4.3.2','transformers.web.js');
  ort=installed('onnxruntime-web','1.31.1','ort.webgpu.bundle.min.mjs');
  hash=installed('hash-wasm','4.12.0','sha256.umd.min.js');
  const entry=fs.realpathSync(require.resolve('esbuild')),relative=path.relative(path.join(root,'node_modules'),entry);
  if(relative.startsWith('..')||path.isAbsolute(relative))invalid();
  esbuild=require('esbuild');
 }else{
  transformer=path.join(root,'transformersjs-reuse-review-01/npm-4.3.2/package/dist/transformers.web.js');
  ort=path.join(root,'runtime-packages/ort-web-1.31.1/package/dist/ort.webgpu.bundle.min.mjs');
  hash=path.join(root,'hash-wasm-reuse-01/package/dist/sha256.umd.min.js');
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'hash-wasm-reuse-01/package-evidence.json'),'utf8'));
  const record=evidence.files?.find(file=>file.path==='package/dist/sha256.umd.min.js');
  if(evidence.integrity_verified!==true||!record||createHash('sha256').update(fs.readFileSync(hash)).digest('hex')!==record.sha256)invalid();
  esbuild=require(path.join(root,'png-export-01/node_modules/esbuild/lib/main.js'));
 }
 if(esbuild.version!=='0.25.12')invalid();
 for(const file of [transformer,ort,hash])if(!fs.lstatSync(file).isFile())invalid();
 return {transformer,ort,hash,esbuild};
}
