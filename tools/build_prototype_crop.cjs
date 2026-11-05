/** Build the tiny local prototype bridge; no npm install/network/browser. */
const path=require('node:path');
async function main(){
 const root=process.argv[2];if(!root)throw Error('Need private dependency root containing esbuild');
 const esbuild=require(path.resolve(root,'node_modules/esbuild/lib/main.js'));
 try{await esbuild.build({entryPoints:[path.resolve(__dirname,'../docs/browser/prototype/crop-controls.mjs')],outfile:path.resolve(__dirname,'../docs/browser/prototype/crop-controls.js'),bundle:true,format:'iife',globalName:'PrototypeCropControls',platform:'browser',target:'es2022',minify:true,legalComments:'none'});}finally{esbuild.stop();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
