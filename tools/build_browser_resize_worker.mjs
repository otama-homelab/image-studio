/** Private diagnostic build, no network/npm install/browser. esbuild supplies binary encoding. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [root,artifact,output,budgetText,kind='resize']=process.argv.slice(2),maxMemoryBytes=Number(budgetText);
if(!['resize','foreground','thumbnail'].includes(kind)||!root||!artifact||!output||fs.existsSync(output)||!Number.isSafeInteger(maxMemoryBytes)||maxMemoryBytes<131072||maxMemoryBytes>2147483648||maxMemoryBytes%65536!==0)throw Error('Need private dependencies, artifact, new output and page-aligned memory budget >=128KiB');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bytes=fs.readFileSync(artifact),sha=b=>createHash('sha256').update(b).digest('hex');
const foreground=kind==='foreground';
const reference=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/validation/'+(foreground?'2026-11-01-foreground-release-rebuild.json':kind==='thumbnail'?'2026-11-01-pillow-thumbnail-wasm.json':'2026-11-01-pillow-bounded-memory.json'))));
const acceptedHashes=[reference.wasmSha256];
if(kind==='thumbnail'){
 const canonical=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/validation/2026-11-03-canonical-thumbnail-wasm.json')));
 if(canonical.status!=='passed'||!canonical.cases?.length||!canonical.cases.every(item=>item.sha256Exact===true))throw Error('Missing canonical thumbnail parity');
 acceptedHashes.push(canonical.wasmSha256);
}
if(!acceptedHashes.includes(sha(bytes)))throw Error('Unverified WASM artifact');
fs.mkdirSync(output,{mode:0o700});
const esbuild=createRequire(import.meta.url)(path.join(root,'node_modules/esbuild/lib/main.js')),entry=path.join(repo,'tools/browser-library-adapter/browser-'+kind+'-worker.mjs'),outfile=path.join(output,kind+'-worker.js');
try{
 const result=await esbuild.build({entryPoints:[entry],outfile,bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,sourcemap:false,metafile:true,legalComments:'none',logLevel:'silent',define:{[foreground?'__FOREGROUND_MEMORY_BUDGET__':'__PILLOW_MEMORY_BUDGET__']:String(maxMemoryBytes)},plugins:[{name:'verified-pillow-artifact',setup(build){build.onResolve({filter:foreground?/^foreground-artifact$/:/^pillow-artifact$/},()=>({path:'verified-pillow',namespace:'embedded'}));build.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:bytes,loader:'binary'}));}}]});
 const external=Object.values(result.metafile.outputs).flatMap(o=>o.imports).filter(i=>i.external);if(external.length)throw Error('External import in worker');
 const notice=[foreground?'PyMatting 1.1.16 (diagnostic C translation):':'Pillow 12.3.0 (unmodified resampler):','',fs.readFileSync(path.join(repo,'tools/fixtures/licenses/'+(foreground?'PyMatting-MIT.txt':'Pillow-MIT-CMU.txt')),'utf8'),...(foreground?['','rembg 2.0.85 (foreground conversion reference):','',fs.readFileSync(path.join(repo,'tools/fixtures/licenses/rembg-MIT.txt'),'utf8')]:[]),'','xcc pinned runtime sources (brk change):','',fs.readFileSync(path.join(repo,'tools/fixtures/licenses/xcc-MIT.txt'),'utf8')].join('\n');
 fs.writeFileSync(path.join(output,'NOTICE.txt'),notice,{mode:0o600});
 const report={...(foreground?{cancellationProtocol:'cooperative-foreground-cancel-v1'}:{}),kind,noticeBytes:Buffer.byteLength(notice),noticeSha256:sha(Buffer.from(notice)),status:'built',esbuild:esbuild.version,bundleBytes:fs.statSync(outfile).size,bundleSha256:sha(fs.readFileSync(outfile)),wasmBytes:bytes.length,wasmSha256:sha(bytes),maxMemoryBytes,externalImports:external,limits:['Diagnostic artifact only; no deployment or browser/CSP acceptance','Budget applies to allocator growth, not total process memory or module maximum',(foreground?'PyMatting derivative and fork runtime':'Upstream Pillow and runtime')+' license/NOTICE distribution audit still required']};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{esbuild.stop();}
