/** Offline preparation for Wrangler's documented R2 CORS JSON format. */
import {pathToFileURL} from 'node:url';

export function prepareR2Cors(origins){
 if(!Array.isArray(origins)||!origins.length||origins.length>32)throw Error('Explicit HTTPS app origins required');
 for(const value of origins){
  if(typeof value!=='string'||value.includes('*'))throw Error('Exact app origin required');
  let url;try{url=new URL(value);}catch{throw Error('Invalid app origin');}
  if(url.protocol!=='https:'||url.username||url.password||url.origin!==value)throw Error('Exact HTTPS app origin required');
 }
 return {rules:[{allowed:{origins:[...new Set(origins)].sort(),methods:['GET']}}]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.stdout.write(JSON.stringify(prepareR2Cors(process.argv.slice(2)),null,2)+'\n');}
 catch{process.stderr.write('Usage: node tools/prepare_browser_r2_cors.mjs HTTPS_APP_ORIGIN [HTTPS_PREVIEW_ORIGIN ...]\n');process.exitCode=1;}
}
