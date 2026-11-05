import {lstat,mkdtemp,rm,mkdir,copyFile,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {createBuildInfo} from './build-info.mjs';
import {compileBackgroundRelease} from '../../tools/build_browser_release.mjs';
import {verifyReleaseAssets,verifyReleaseFilesUnchanged} from '../../tools/verify_browser_release_bindings.mjs';

const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildBrowserApp(releaseDirectory=path.join(web,'background-release'),outputDirectory=path.join(web,'dist')){
 releaseDirectory=path.resolve(releaseDirectory);outputDirectory=path.resolve(outputDirectory);
 let configured=false;
 try{await lstat(releaseDirectory);configured=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!configured){await build({root:web,build:{outDir:outputDirectory}});return {background:false};}
 const before=createBuildInfo(web),temporary=await mkdtemp(path.join(tmpdir(),'image-studio-background-'));
 try{
  const release=await compileBackgroundRelease(releaseDirectory,path.join(temporary,'compiled'));
  if(createBuildInfo(web).sourceId!==before.sourceId)throw Error('Build inputs changed while compiling model Workers');
  await build({root:web,define:{__BACKGROUND_RELEASE__:JSON.stringify(release.config)},plugins:release.privateMarker===null?[]:[{name:'image-studio-private-build',generateBundle(){this.emitFile({type:'asset',fileName:'LOCAL_VALIDATION_ONLY.json',source:release.privateMarker});}}],build:{outDir:outputDirectory}});
  for(const asset of release.assets){const target=path.join(outputDirectory,asset.path.slice(1));await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(release.staticRoot,asset.path.slice(1)),target,constants.COPYFILE_EXCL);}
  await verifyReleaseAssets(outputDirectory,release.assets);await verifyReleaseFilesUnchanged(release.records);
  const metadata=JSON.parse(await readFile(path.join(outputDirectory,'background-release.json'),'utf8'));
  if(metadata.schemaVersion!==1||metadata.configSha256!==createHash('sha256').update(JSON.stringify(release.config)).digest('hex')||createBuildInfo(web).sourceId!==before.sourceId)throw Error('Built background release changed');
  return {background:true,privateMarker:release.privateMarker!==null,...release.bound,sourceId:before.sourceId,assets:release.assets.length};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildBrowserApp()));
