import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveBrowserBuildDependencies} from '../tools/browser-build-dependencies.mjs';

function write(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;}
function installed(root){
 write(root,'package.json',{name:'image-studio-browser-build',private:true});
 for(const [name,version,main,browser] of [['@huggingface/transformers','4.3.2','dist/transformers.node.cjs','dist/transformers.web.js'],['onnxruntime-web','1.31.1','dist/ort.node.min.js','dist/ort.webgpu.bundle.min.mjs'],['hash-wasm','4.12.0','dist/index.umd.js','dist/sha256.umd.min.js']]){
  write(root,'node_modules/'+name+'/package.json',{name,version,main});write(root,'node_modules/'+name+'/'+main,'module.exports={}');write(root,'node_modules/'+name+'/'+browser,'fixture');
 }
 write(root,'node_modules/esbuild/package.json',{name:'esbuild',version:'0.25.12',main:'lib/main.js'});write(root,'node_modules/esbuild/lib/main.js','module.exports={version:"0.25.12"}');
}
test('standard npm build project resolves pinned browser bundles without executing Node ML entrypoints',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-build-deps-'));
 try{
  installed(root);write(root,'node_modules/@huggingface/transformers/dist/transformers.node.cjs','throw Error("Node ML entrypoint must not run")');
  const deps=resolveBrowserBuildDependencies(root);
  assert.equal(deps.transformer,path.join(root,'node_modules/@huggingface/transformers/dist/transformers.web.js'));
  assert.equal(deps.ort,path.join(root,'node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'));
  assert.equal(deps.hash,path.join(root,'node_modules/hash-wasm/dist/sha256.umd.min.js'));
  assert.equal(deps.esbuild.version,'0.25.12');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('installed build dependencies reject wrong versions, foreign project roots and dependencies outside the supplied project',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-build-deps-'));
 try{
  installed(root);write(root,'node_modules/hash-wasm/package.json',{name:'hash-wasm',version:'4.13.0',main:'dist/index.umd.js'});assert.throws(()=>resolveBrowserBuildDependencies(root));
  installed(root);fs.unlinkSync(path.join(root,'node_modules/hash-wasm/dist/sha256.umd.min.js'));assert.throws(()=>resolveBrowserBuildDependencies(root));
  installed(root);write(root,'package.json',{name:'another-project'});assert.throws(()=>resolveBrowserBuildDependencies(root));
  installed(root);const child=path.join(root,'child');write(child,'package.json',{name:'image-studio-browser-build'});assert.throws(()=>resolveBrowserBuildDependencies(child));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('captured dependency layout remains usable with its verified hash evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-build-deps-'));
 try{
  write(root,'transformersjs-reuse-review-01/npm-4.3.2/package/dist/transformers.web.js','fixture');write(root,'runtime-packages/ort-web-1.31.1/package/dist/ort.webgpu.bundle.min.mjs','fixture');
  const hash='captured SHA256 fixture',digest=createHash('sha256').update(hash).digest('hex');
  write(root,'hash-wasm-reuse-01/package/dist/sha256.umd.min.js',hash);write(root,'hash-wasm-reuse-01/package-evidence.json',{integrity_verified:true,files:[{path:'package/dist/sha256.umd.min.js',sha256:digest}]});
  write(root,'png-export-01/node_modules/esbuild/lib/main.js','module.exports={version:"0.25.12"}');
  const deps=resolveBrowserBuildDependencies(root);assert.equal(deps.esbuild.version,'0.25.12');assert.equal(deps.hash,path.join(root,'hash-wasm-reuse-01/package/dist/sha256.umd.min.js'));
  write(root,'hash-wasm-reuse-01/package/dist/sha256.umd.min.js','changed');assert.throws(()=>resolveBrowserBuildDependencies(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
