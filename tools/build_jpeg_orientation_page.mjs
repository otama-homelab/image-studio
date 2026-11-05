/** Build an offline, explicit-start diagnostic page. Never launch a browser here. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [dependencies,dimensions,workerDirectory,fixtureDirectory,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need dependency root, dimensions package, Worker directory, fixtures, new output directory');
const reference=JSON.parse(fs.readFileSync(path.join(fixtureDirectory,'report.json'),'utf8'));
if(reference.status!=='reference-captured'||reference.pillow!=='12.3.0'||JSON.stringify(reference.cases.map(c=>c.orientation))!=='[1,2,3,4,5,6,7,8]')throw Error('Unexpected reference');
const sha=data=>createHash('sha256').update(data).digest('hex');
const fixtures=reference.cases.map(row=>{
 const jpeg=fs.readFileSync(path.join(fixtureDirectory,row.filename)),rgb=fs.readFileSync(path.join(fixtureDirectory,row.referenceFilename));
 if(sha(jpeg)!==row.fileSha256||sha(rgb)!==row.referenceRgbSha256||rgb.length!==row.expectedSize[0]*row.expectedSize[1]*3)throw Error('Fixture SHA mismatch');
 return {orientation:row.orientation,width:row.expectedSize[0],height:row.expectedSize[1],jpeg:jpeg.toString('base64'),rgb:rgb.toString('base64')};
});
const worker=fs.readFileSync(path.join(workerDirectory,'jpeg-input-worker.js'),'utf8'),workerReport=JSON.parse(fs.readFileSync(path.join(workerDirectory,'report.json'),'utf8'));
if(workerReport.kind!=='jpeg-input'||sha(worker)!==workerReport.bundleSha256)throw Error('Worker SHA mismatch');
const require=createRequire(import.meta.url),esbuild=require(path.resolve(dependencies,'node_modules/esbuild/lib/main.js'));
fs.mkdirSync(output,{mode:0o700});
try{
 const built=await esbuild.build({entryPoints:[new URL('./browser-library-adapter/browser-jpeg-orientation-check.mjs',import.meta.url).pathname],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true,metafile:true,logLevel:'silent',alias:{'image-dimensions':path.resolve(dimensions,'index.js')},define:{__JPEG_FIXTURES__:JSON.stringify(fixtures),__JPEG_WORKER__:JSON.stringify(worker)}});
 const external=Object.values(built.metafile.outputs).flatMap(o=>o.imports).filter(i=>i.external);if(external.length)throw Error('Unexpected external import');
 const script=built.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
 const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'"><title>JPEG方向確認</title><style>body{font:16px sans-serif;max-width:900px;margin:32px auto;padding:16px}button,a{margin:8px}pre{white-space:pre-wrap}</style><h1>JPEG方向確認</h1><p>人工画像17×11pxの8枚を1件ずつ読みます。開始するまで実行しません。外部送信はありません。色差は測定値で、画質の合否判定は含みません。</p><button id="start">確認を開始</button><button id="cancel" disabled>中止</button><a id="download">結果JSONを保存</a><pre id="output">未実行</pre><script>${script}</script></html>`;
 fs.writeFileSync(path.join(output,'index.html'),html,{mode:0o600});fs.copyFileSync(path.join(workerDirectory,'NOTICE.txt'),path.join(output,'NOTICE.txt'));
 const report={status:'built-not-executed',htmlBytes:Buffer.byteLength(html),htmlSha256:sha(html),fixtureCount:fixtures.length,workerSha256:workerReport.bundleSha256,externalImports:external,explicitStart:true,networkCsp:'connect-src none',limits:['Build and fixture integrity only; no real browser execution','Inline/blob policy is for this private diagnostic, not production CSP','Native decode may use browser resources; only run when workstation load permits']};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{esbuild.stop();}
