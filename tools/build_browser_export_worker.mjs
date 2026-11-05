/** Diagnostic build only. Dependencies/outputs remain private until production E01 integration. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [root,output,kind='export',dimensionsRoot]=process.argv.slice(2);
if(!['export','paper','png-input','jpeg-input'].includes(kind)||!output||fs.existsSync(output))throw Error('Need private dependency root and new output directory');
if(['png-input','jpeg-input'].includes(kind)&&!dimensionsRoot)throw Error('Image input build requires private dimensions package directory');
fs.mkdirSync(output,{mode:0o700});
const require=createRequire(import.meta.url),esbuild=require(path.join(root,'node_modules/esbuild/lib/main.js'));
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),entry=path.join(repo,`tools/browser-library-adapter/browser-${kind}-worker.mjs`),outfile=path.join(output,`${kind}-worker.js`);
try{
const inputAliases=['png-input','jpeg-input'].includes(kind)?{'image-dimensions':path.resolve(dimensionsRoot,'index.js')}:{};
const internalSourceHashes={};
if(kind==='png-input'){
 for(const [alias,file,expected] of [['fast-png-decoder','lib/png_decoder.js','14453916f2b5cdfaae36bdd511e77a13930ae7eb0d542f21cc59c1c9e69c2166'],['fast-png-keyword','lib/helpers/text.js','3af1b5d0fb66ff7d5ea81683c70f7e5a0a76959f1e44a99a699fd5b9f730a589']]){
  const source=path.resolve(root,'node_modules/fast-png',file),hash=createHash('sha256').update(fs.readFileSync(source)).digest('hex');if(hash!==expected)throw Error('Pinned fast-png internal source mismatch');inputAliases[alias]=source;internalSourceHashes[file]=hash;
 }
}
if(kind==='png-input'){const source=path.resolve(root,'node_modules/pako/lib/zlib/adler32.js'),hash=createHash('sha256').update(fs.readFileSync(source)).digest('hex');if(hash!=='99618eb68a96858148e2dd56f478aa7e4321c434f5f2ee6c57f59c0c568f0596')throw Error('Pinned pako Adler source mismatch');inputAliases['pako-adler32']=source;internalSourceHashes['pako/adler32.js']=hash;}
const result=await esbuild.build({entryPoints:[entry],outfile,bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,sourcemap:false,legalComments:'linked',metafile:true,logLevel:'silent',nodePaths:[path.join(root,'node_modules')],alias:inputAliases});
const external=Object.values(result.metafile.outputs).flatMap(o=>o.imports).filter(i=>i.external);
if(external.length)throw Error('Unexpected external browser import');
const data=fs.readFileSync(outfile),legal=fs.existsSync(outfile+'.LEGAL.txt')?fs.readFileSync(outfile+'.LEGAL.txt'):new Uint8Array();
let notice=null;
if(['png-input','jpeg-input'].includes(kind)){
 const packages=[...(kind==='png-input'?['fast-png','iobuffer','fflate','pako']:[]).map(name=>[path.join(root,'node_modules',name),'LICENSE']),[dimensionsRoot,'license']];
 const parts=packages.map(([directory,license])=>{const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));return `${pkg.name} ${pkg.version} (${pkg.license})\n${fs.readFileSync(path.join(directory,license),'utf8')}`;});
 if(kind==='png-input'){const helper=fs.readFileSync(path.join(root,'node_modules/pako/lib/zlib/adler32.js'),'utf8');parts.push('pako Adler-32 original source notice\n'+helper.slice(0,helper.indexOf('function adler32(')));}
 const bytes=Buffer.from(parts.join('\n\n'));fs.writeFileSync(path.join(output,'NOTICE.txt'),bytes,{mode:0o600});notice={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const report={kind,notice,internalSourceHashes,status:'built',esbuild:esbuild.version,format:'standalone IIFE suitable for a Worker script',target:'es2022',bundleBytes:data.length,bundleSha256:createHash('sha256').update(data).digest('hex'),legalBytes:legal.length,legalSha256:createHash('sha256').update(legal).digest('hex'),externalImports:external,inputCount:Object.keys(result.metafile.inputs).length,entrySha256:createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),limitations:['Diagnostic artifact, not deployed or integrated with web/ application.','Compilation alone does not establish browser runtime/CSP/save behavior.','Linked legal comments are not a completed full NOTICE/license audit.']};
fs.writeFileSync(path.join(output,'metafile.json'),JSON.stringify(result.metafile,null,2)+'\n',{mode:0o600});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));

}finally{esbuild.stop();}
