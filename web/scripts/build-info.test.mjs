import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createBuildInfo} from './build-info.mjs';

function fixture(){
 const repo=mkdtempSync(join(tmpdir(),'image-studio-build-')),web=join(repo,'web');
 for(const name of ['web/src/main.ts','web/public/THIRD_PARTY_NOTICES.txt','web/scripts/build.mjs','tools/browser-library-adapter/input.mjs','web/index.html','web/package-lock.json','web/tsconfig.json','web/vite.config.ts','web/.node-version','web/.npmrc','.github/workflows/web-check.yaml','LICENSE','docs/browser/design-tokens.css','tools/build_browser_release.mjs','tools/build_browser_model_prepare.mjs','tools/build_browser_public_stage_worker.mjs','tools/browser-build-dependencies.mjs','tools/verify_browser_release_bindings.mjs','tools/browser-build/package.json','tools/browser-build/package-lock.json','tools/browser-build/.npmrc']){
  mkdirSync(dirname(join(repo,name)),{recursive:true});writeFileSync(join(repo,name),'fixture');
 }
 writeFileSync(join(web,'package.json'),JSON.stringify({version:'0.1.0'}));writeFileSync(join(repo,'VERSION'),'0.1.0\n');
 return {repo,web,close:()=>rmSync(repo,{recursive:true,force:true})};
}
test('source identity is stable across checkout locations and mtimes, but tracks app, lock, adapter and notices',()=>{
 const first=fixture(),second=fixture();
 try{
  const info=createBuildInfo(first.web);assert.match(info.sourceId,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(createBuildInfo(second.web),info);
  utimesSync(join(first.web,'src/main.ts'),new Date(0),new Date(0));assert.deepEqual(createBuildInfo(first.web),info);
  writeFileSync(join(first.repo,'.env'),'private-secret-sentinel');mkdirSync(join(first.web,'tests'));writeFileSync(join(first.web,'tests/private.jpg'),'private-photo-sentinel');assert.deepEqual(createBuildInfo(first.web),info);
  for(const name of ['src/main.ts','package-lock.json','../tools/browser-library-adapter/input.mjs','public/THIRD_PARTY_NOTICES.txt','.node-version','.npmrc','../.github/workflows/web-check.yaml','../docs/browser/design-tokens.css','../tools/build_browser_release.mjs','../tools/browser-build/package-lock.json']){
   writeFileSync(join(first.web,name),'changed');assert.notEqual(createBuildInfo(first.web).sourceId,info.sourceId);writeFileSync(join(first.web,name),'fixture');assert.deepEqual(createBuildInfo(first.web),info);
  }
  assert.deepEqual(Object.keys(info).sort(),['appVersion','schemaVersion','sourceId']);assert.ok(!JSON.stringify(info).includes(first.repo));assert.ok(!JSON.stringify(info).includes('private-'));
 }finally{first.close();second.close();}
});
test('reserved public metadata and symlink inputs fail instead of identifying unrelated files',()=>{
 const item=fixture();try{
  writeFileSync(join(item.web,'public/build-info.json'),'stale');assert.throws(()=>createBuildInfo(item.web),/Reserved build metadata/);rmSync(join(item.web,'public/build-info.json'));
  writeFileSync(join(item.web,'public/background-release.json'),'stale');assert.throws(()=>createBuildInfo(item.web),/Reserved build metadata/);rmSync(join(item.web,'public/background-release.json'));
  symlinkSync(join(item.web,'package.json'),join(item.web,'src/linked.json'));assert.throws(()=>createBuildInfo(item.web),/Build input symlink/);
 }finally{item.close();}
});

test('configured release inputs contribute to source identity and cannot be symlinked',()=>{
 const item=fixture();try{
  const original=createBuildInfo(item.web).sourceId;mkdirSync(join(item.web,'background-release'));writeFileSync(join(item.web,'background-release/release.json'),'first');
  const first=createBuildInfo(item.web).sourceId;assert.notEqual(first,original);writeFileSync(join(item.web,'background-release/release.json'),'second');assert.notEqual(createBuildInfo(item.web).sourceId,first);
  symlinkSync(join(item.web,'package.json'),join(item.web,'background-release/linked.json'));assert.throws(()=>createBuildInfo(item.web),/Build input symlink/);
 }finally{item.close();}
});

test('staged release has exactly the installed identity before publication',()=>{
 const item=fixture();try{
  const staged=join(item.repo,'staged');mkdirSync(staged);writeFileSync(join(staged,'release.json'),'candidate');
  const before=createBuildInfo(item.web),preview=createBuildInfo(item.web,staged);
  assert.notEqual(preview.sourceId,before.sourceId);
  mkdirSync(join(item.web,'background-release'));writeFileSync(join(item.web,'background-release/release.json'),'candidate');
  assert.deepEqual(preview,createBuildInfo(item.web));
  symlinkSync(join(item.web,'package.json'),join(staged,'linked'));assert.throws(()=>createBuildInfo(item.web,staged),/Build input symlink/);
 }finally{item.close();}
});

test('browser metadata must match the canonical release VERSION',()=>{
 const item=fixture();try{
  assert.equal(createBuildInfo(item.web).appVersion,'0.1.0');
  writeFileSync(join(item.repo,'VERSION'),'1.1.2\n');
  assert.throws(()=>createBuildInfo(item.web),/VERSION/);
  writeFileSync(join(item.web,'package.json'),JSON.stringify({version:'1.1.2'}));
  assert.equal(createBuildInfo(item.web).appVersion,'1.1.2');
 }finally{item.close();}
});
