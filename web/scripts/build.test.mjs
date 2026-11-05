import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildBrowserApp} from './build.mjs';

test('relative output is resolved from the caller consistently with asset placement',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'studio-build-path-'));
 try{
  const output=path.relative(process.cwd(),path.join(root,'app'));
  assert.deepEqual(await buildBrowserApp(path.join(root,'absent'),output),{background:false});
  assert.equal(JSON.parse(await readFile(path.join(root,'app/build-info.json'),'utf8')).schemaVersion,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('present but invalid release input fails before replacing an existing artifact',async()=>{
 const {mkdir,writeFile}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(tmpdir(),'studio-build-invalid-'));
 try{
  const release=path.join(root,'release'),output=path.join(root,'app');
  await mkdir(output);await writeFile(path.join(output,'keep.txt'),'reviewed artifact');
  await writeFile(release,'invalid release directory');
  await assert.rejects(buildBrowserApp(release,output));
  await rm(release);await mkdir(release);await writeFile(path.join(release,'release.json'),'{}');
  await assert.rejects(buildBrowserApp(release,output));
  assert.equal(await readFile(path.join(output,'keep.txt'),'utf8'),'reviewed artifact');
 }finally{await rm(root,{recursive:true,force:true});}
});
