import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBackgroundRelease} from './background-release.mjs';
import {browserReleaseFixture as fixture} from '../../tests/fixtures/browser-release.mjs';
test('build accepts null or four explicit archive-backed choices at one immutable Hub revision without mutation',()=>{
 for(const value of [undefined,null,'null'])assert.equal(parseBackgroundRelease(value),null);
 const config=fixture(),before=JSON.stringify(config);assert.equal(parseBackgroundRelease(config),config);assert.deepEqual(parseBackgroundRelease(before),config);assert.equal(JSON.stringify(config),before);
});
test('build rejects private fields, mutable or mixed revisions, missing CPU/refinement, invalid resources and asset paths',()=>{
 const mutations=[p=>{p.scope='private';},p=>{p.workers.model='https://outside.invalid/worker.js';},p=>{p.modelNoticesHref='/notices.txt';},p=>{p.prepareBackground.source.token='secret-sentinel';},p=>{p.prepareBackground.source.archive.url=p.prepareBackground.source.archive.url.replace('a'.repeat(40),'main');},p=>{p.modelVariants[0].prepareBackground.source.resources[0].url=p.modelVariants[0].prepareBackground.source.resources[0].url.replace('a'.repeat(40),'e'.repeat(40));},p=>{p.modelVariants.pop();},p=>{p.modelVariants[2].executionProvider='webgpu';},p=>{delete p.modelVariants[2].prepareMatte;},p=>{p.modelVariants[2].defaultRefine=false;},p=>{p.prepareBackground.source.resources[0].sha256='wrong';},p=>{p.prepareBackground.source.resources[0].name='../config.json';},p=>{p.prepareBackground.source.resources.push({...p.prepareBackground.source.resources[0]});},p=>{p.modelVariants[0].prepareBackground.source.archive.bytes++;},p=>{p.modelVariants[0].prepareBackground.source.cacheNamespace='image-studio-another';},p=>{p.modelVariants[0].modelCancellation=undefined;},p=>{p.workers.trimap='/validation-workers/private.js';}];
 for(const mutate of mutations){const config=fixture();mutate(config);assert.throws(()=>parseBackgroundRelease(config),error=>error.message==='invalid-background-release');}
 for(const value of ['false','true','[]','"secret-sentinel"','{secret-sentinel',1,false,[]])assert.throws(()=>parseBackgroundRelease(value),error=>error.message==='invalid-background-release');
});

test('archive metadata cannot undercount stored members or overflow byte totals',()=>{
 for(const change of [source=>{source.archive.bytes=1;},source=>{source.resources[0].bytes=Number.MAX_SAFE_INTEGER;},source=>{source.archive.bytes=Number.MAX_SAFE_INTEGER;}]){
  const config=fixture();change(config.modelVariants[2].prepareBackground.source);
  assert.throws(()=>parseBackgroundRelease(config),error=>error.message==='invalid-background-release');
 }
});
