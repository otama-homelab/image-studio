import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function deploymentBranch(ref,version){
 if(ref==='refs/heads/main')return 'preview';
 if(!/^refs\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(ref)||ref!==`refs/tags/v${version}`)throw Error('A stable release tag matching VERSION is required');
 return 'production';
}

export async function verifyPagesProject({accountId,token,fetchImpl=fetch}){
 if(!/^[a-f0-9]{32}$/.test(accountId??'')||!token)throw Error('Cloudflare account ID and API token are required');
 let response,data;
 try{
  response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/image-studio`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||response.redirected)throw Error();
  data=await response.json();
 }catch{throw Error('Cloudflare Pages project lookup failed; check credentials and project setup');}
 if(data?.success!==true||data.result?.name!=='image-studio'||data.result?.production_branch!=='production')throw Error('Pages project image-studio must use production_branch=production');
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [command,...args]=process.argv.slice(2);
 if(command==='branch'&&args.length===2)console.log(deploymentBranch(args[0],readFileSync(args[1],'utf8').trim()));
 else if(command==='verify-project'&&args.length===0)await verifyPagesProject({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
 else throw Error('Use branch REF VERSION_FILE or verify-project');
}
