import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadBackgroundBuildInput,compileBackgroundRelease} from '../tools/build_browser_release.mjs';
import {verifyReleaseFilesUnchanged} from '../tools/verify_browser_release_bindings.mjs';
import {browserReleaseFixture,addRvmChoice} from './fixtures/browser-release.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-release-input-'));
 const write=(name,value)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof value==='string'?value:JSON.stringify(value));return p;};
 const asset='fixture asset',route='/assets/'+'b'.repeat(64)+'/NOTICE.txt';write('static'+route,asset);
 const manifest={config:'config.json',catalog:'catalog.json',parents:Object.fromEntries(['modnet-cpu','modnet-gpu','hr-gpu','hr-cpu'].map(name=>[name,name+'.json'])),stages:{gpu:'gpu-stage.json',cpu:'cpu-stage.json'},resize:'resize.wasm',assets:[{path:route,bytes:asset.length,sha256:createHash('sha256').update(asset).digest('hex')}]};
 write('config.json',browserReleaseFixture());write('catalog.json',{format:'zip-stored-v1',models:[]});
 for(const name of [...Object.values(manifest.parents),...Object.values(manifest.stages)])write(name,{});
 write('resize.wasm','resize fixture');write('release.json',manifest);
 return {root,manifest,write,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('build input loads fixed four parent/two child policies and preserves the private marker',async()=>{
 const f=fixture();try{
  f.write('LOCAL_VALIDATION_ONLY.json',{distributionApproved:false});
  const input=await loadBackgroundBuildInput(f.root);assert.equal(input.config.modelVariants.length,3);assert.equal(Object.keys(input.parents).length,4);assert.equal(Object.keys(input.stages).length,2);assert.equal(input.assets.length,1);assert.equal(input.privateMarker,'{"distributionApproved":false}');
  await verifyReleaseFilesUnchanged(input.records);
  f.write('config.json',{});await assert.rejects(verifyReleaseFilesUnchanged(input.records));
 }finally{f.close();}
});
test('release compilation never removes an existing output directory',async()=>{
 const f=fixture();try{
  const output=path.join(f.root,'keep');fs.mkdirSync(output);fs.writeFileSync(path.join(output,'keep.txt'),'keep');
  await assert.rejects(compileBackgroundRelease(f.root,output),{code:'EEXIST'});assert.equal(fs.readFileSync(path.join(output,'keep.txt'),'utf8'),'keep');
 }finally{f.close();}
});
test('build input rejects unknown fields, missing roles, traversal, symlinks and changed assets before output',async()=>{
 for(const mutate of [
  f=>{f.manifest.callback='untrusted';f.write('release.json',f.manifest);},
  f=>{delete f.manifest.parents['hr-cpu'];f.write('release.json',f.manifest);},
  f=>{f.manifest.config='../outside.json';f.write('release.json',f.manifest);},
  f=>{fs.unlinkSync(path.join(f.root,'config.json'));fs.symlinkSync(path.join(f.root,'catalog.json'),path.join(f.root,'config.json'));},
  f=>{f.write('static/assets/'+'b'.repeat(64)+'/NOTICE.txt','changed asset');},
  f=>{f.write('config.json',{...browserReleaseFixture(),trace:true});},
 ]){const f=fixture();try{mutate(f);await assert.rejects(loadBackgroundBuildInput(f.root));assert.equal(fs.existsSync(path.join(f.root,'dist')),false);}finally{f.close();}}
});

test('build input accepts exactly the fifth RVM parent when its CPU choice exists',async()=>{
 const f=fixture();try{f.write('config.json',addRvmChoice(browserReleaseFixture()));f.manifest.parents['rvm-cpu']='rvm-cpu.json';f.write('rvm-cpu.json',{});f.write('release.json',f.manifest);assert.equal(Object.keys((await loadBackgroundBuildInput(f.root)).parents).length,5);delete f.manifest.parents['rvm-cpu'];f.write('release.json',f.manifest);await assert.rejects(loadBackgroundBuildInput(f.root));}finally{f.close();}
});
